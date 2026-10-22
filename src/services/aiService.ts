import {
  type AIProvider,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ProviderConfig,
  createProvider,
  extractJSON,
} from '@/infrastructure/ai'
import {
  InvalidJSONError,
  OutputTruncatedError,
  ReasoningExhaustedError,
  type OutputCap,
} from '@/infrastructure/ai/errors'
import {
  FALLBACK_OUTPUT_TOKENS,
  PROBE_MIN_OUTPUT_TOKENS,
  parseOutputLimitFromText,
  rememberLearnedOutputLimit,
  resolveProviderConfig,
  type ResolvedOutputLimit,
} from '@/infrastructure/ai/outputLimit'
import { clampConcurrency, DEFAULT_AI_CONCURRENCY } from '@/shared/lib/concurrency'
import { ThinkStreamFilter, stripThinkBlocks } from '@/infrastructure/ai/responseText'
import { logger } from '@/infrastructure/logger/logger'
import type { TokenUsage } from '@/infrastructure/ai/types'
import type { AIUsageKind } from '@/entities/aiUsage/types'

/**
 * Receives every AI response's usage block (or `undefined` when the provider
 * sent none). Installed once at app start by `installAIUsageRecording()`;
 * unset (no-op) in tests unless a test installs one.
 */
export type AIUsageSink = (kind: AIUsageKind, usage: TokenUsage | undefined) => void

let usageSink: AIUsageSink | null = null

export function setAIUsageSink(sink: AIUsageSink | null): void {
  usageSink = sink
}

/**
 * Share of the completion tokens spent on reasoning from which a cut-off reply
 * counts as "the thinking used up the budget" rather than "the answer is too
 * long".
 */
export const REASONING_EXHAUSTED_SHARE = 0.8

/** An opening `<think>` with no closing tag after it. */
const UNTERMINATED_THINK = /<\s*think(?:ing)?\b[^>]*>(?![\s\S]*<\s*\/\s*think(?:ing)?\s*>)/i

/**
 * The reply stopped at the output cap (`finish_reason: length`) while the
 * model was still thinking: no visible answer, an unterminated `<think>`
 * block, or reasoning tokens ≥ 80 % of the completion. Splitting such a task
 * into smaller requests does not help (each part thinks as much); a larger
 * budget or less thinking does.
 */
export function isReasoningExhausted(res: ChatResponse): boolean {
  if (res.finishReason !== 'length') return false
  // Only a model that actually thought: a plain model cut off is plain truncation.
  const thought =
    (res.reasoningChars ?? 0) > 0 ||
    (res.usage?.reasoningTokens ?? 0) > 0 ||
    /<\s*think(?:ing)?\b/i.test(res.content)
  if (!thought) return false
  if (!stripThinkBlocks(res.content).trim()) return true
  if (UNTERMINATED_THINK.test(res.content)) return true
  const reasoning = res.usage?.reasoningTokens
  const completion = res.usage?.completionTokens
  return (
    reasoning !== undefined &&
    completion !== undefined &&
    completion > 0 &&
    reasoning >= REASONING_EXHAUSTED_SHARE * completion
  )
}

/** Per-call options every request method takes. */
interface RequestTags {
  /**
   * `low`: a formatting-only task (import, translation, glossing…). Models
   * that can think less are asked to; other providers ignore it.
   */
  reasoning?: 'low'
}

export interface AIServiceOptions {
  config: ProviderConfig
  /** Request kind recorded in local usage statistics (default `other`). */
  usageKind?: AIUsageKind
}

/** Rejections of `max_tokens` answered with a smaller budget, per request. */
const MAX_OUTPUT_PROBES = 6

interface AIServiceState {
  /** The configuration as given (before the output cap is resolved). */
  raw: ProviderConfig
  config: ProviderConfig
  limit: ResolvedOutputLimit
  provider: AIProvider
}

function buildState(raw: ProviderConfig): AIServiceState {
  const { outputLimit, ...config } = resolveProviderConfig(raw)
  return { raw, config, limit: outputLimit, provider: createProvider(config) }
}

/** Per-call override of the usage kind. */
interface UsageTag {
  usageKind?: AIUsageKind
}

/**
 * High-level wrapper around an AIProvider. Owns:
 *  - Provider lifecycle
 *  - JSON-mode plumbing (calls `extractJSON` defensively)
 *  - retry policy (single retry on transient failures)
 *  - logging with secret redaction
 *
 * Services depend on AIService, NOT on a specific Provider implementation.
 */
export class AIService {
  /**
   * Shared by every view (`withKind`) of this service, so a `reset` or an
   * output limit learned through one view applies to all of them.
   */
  private s: AIServiceState
  private usageKind: AIUsageKind

  constructor(opts: AIServiceOptions) {
    this.s = buildState(opts.config)
    this.usageKind = opts.usageKind ?? 'other'
  }

  /** 同时进行的 AI 请求数 (1–8, default 4). */
  get concurrency(): number {
    return clampConcurrency(this.s.raw.maxConcurrency)
  }

  /**
   * The error for a reply cut off at the largest budget allowed, naming whose
   * limit it was: the model's (known or learned), the user's manual number,
   * or — model mode with the limit still unknown — the largest budget tried.
   */
  truncatedAtCap(budget: number): OutputTruncatedError {
    const { limit } = this.s
    const by: OutputCap['by'] =
      limit.source === 'probe'
        ? 'unknown'
        : limit.modelMax !== undefined && budget >= limit.modelMax
          ? 'model'
          : 'setting'
    return new OutputTruncatedError(budget, { limit: budget, by })
  }

  /**
   * A model that stopped because it hit the output cap returns incomplete
   * JSON. Parsing it would produce a misleading "malformed JSON" error, so
   * callers are told what actually happened instead. Every request is sent
   * at the cap, so the error is always the at-the-cap one: asking again with
   * the same request cannot help.
   */
  private assertNotTruncated(res: ChatResponse, maxTokens: number): void {
    if (res.finishReason === 'length') throw this.truncatedAtCap(maxTokens)
  }

  /**
   * One provider call with output-limit probing. While the model's own limit
   * is unknown, a rejection of `max_tokens` as too large is retried at once
   * with the limit the provider states (else half the budget), and the limit
   * that works is remembered for this base URL + model. A context-window
   * rejection of a large probing budget is retried with half (not remembered:
   * it depends on the input).
   */
  private async send(
    req: ChatRequest,
    call: (req: ChatRequest) => Promise<ChatResponse>,
  ): Promise<{ res: ChatResponse; maxTokens: number | undefined }> {
    let current = req
    let learnOnSuccess: number | undefined
    for (let probes = 0; ; probes++) {
      try {
        const res = await call(current)
        if (learnOnSuccess !== undefined) this.learn(learnOnSuccess)
        return { res, maxTokens: current.maxTokens }
      } catch (err) {
        const budget = current.maxTokens
        if (budget === undefined || probes >= MAX_OUTPUT_PROBES || req.signal?.aborted) throw err
        const code = (err as { code?: unknown })?.code
        const unknown = this.s.limit.modelMax === undefined
        if (code === 'OUTPUT_LIMIT') {
          const stated = parseOutputLimitFromText((err as Error).message ?? '', budget)
          const next = stated ?? Math.floor(budget / 2)
          if (next < PROBE_MIN_OUTPUT_TOKENS || next >= budget) throw err
          if (stated !== undefined) {
            this.learn(stated)
            learnOnSuccess = undefined
          } else {
            learnOnSuccess = next
          }
          current = { ...current, maxTokens: next }
        } else if (
          code === 'CONTEXT_TOO_LONG' &&
          unknown &&
          this.s.limit.source === 'probe' &&
          budget > FALLBACK_OUTPUT_TOKENS
        ) {
          current = {
            ...current,
            maxTokens: Math.max(FALLBACK_OUTPUT_TOKENS, Math.floor(budget / 2)),
          }
        } else {
          throw err
        }
      }
    }
  }

  /**
   * `send` plus usage tracking and the thinking check. Every request already
   * goes out at the output cap, so a reply cut off while the model was still
   * thinking (`isReasoningExhausted`) fails at once with
   * `ReasoningExhaustedError` (no larger budget exists to retry with), which
   * callers never answer by splitting the task.
   */
  private async run(
    req: ChatRequest,
    call: (req: ChatRequest) => Promise<ChatResponse>,
    kind?: AIUsageKind,
  ): Promise<{ res: ChatResponse; maxTokens: number | undefined }> {
    const sent = await this.send(req, call)
    this.track(sent.res, kind)
    if (isReasoningExhausted(sent.res)) {
      throw new ReasoningExhaustedError(sent.maxTokens ?? this.budget())
    }
    return sent
  }

  /**
   * The output budget every request sends: the resolved cap (the user's
   * number in manual mode; the model's known / learned limit, else the probe
   * value, in model mode). Requests never start small and grow — a retry
   * with a larger budget costs a whole extra generation.
   */
  private budget(): number {
    return this.cap(this.s.config.maxTokens)
  }

  /** Remember the model's output limit (this visit + the settings row) and use it now. */
  private learn(limit: number): void {
    const known = this.s.limit.modelMax
    if (known !== undefined && known <= limit) return
    const { raw } = this.s
    rememberLearnedOutputLimit(raw.baseURL, raw.model, limit)
    const next = {
      ...raw,
      learnedOutputLimits: { ...raw.learnedOutputLimits, [raw.model.trim()]: limit },
    }
    const fresh = buildState(next)
    Object.assign(this.s, fresh)
  }

  /**
   * A view of this service that records usage under `kind`. It shares the
   * provider and configuration (a later `reset` applies to both).
   */
  withKind(kind: AIUsageKind): AIService {
    const view = Object.create(this) as AIService
    view.usageKind = kind
    return view
  }

  /** Hand the response's usage to the sink. Never throws. */
  private track(res: ChatResponse, kind?: AIUsageKind): void {
    if (!usageSink) return
    try {
      usageSink(kind ?? this.usageKind, res.usage)
    } catch (err) {
      logger.debug('AI usage recording failed', { error: (err as Error)?.message })
    }
  }

  /**
   * The 轻量模型 for a simple task (glossing words, checking a blank or a
   * short answer against its points, translating a question, matching exam
   * topics, extracting scoring points): the same provider, key and usage kind
   * with `config.lightModel` as the model, its output cap resolved for that
   * model. Without a light model (or the same one) this service itself.
   */
  light(): AIService {
    const model = this.s.raw.lightModel?.trim()
    if (!model || model === this.s.raw.model.trim()) return this
    return new AIService({
      config: { ...this.s.raw, model, lightModel: '' },
      usageKind: this.usageKind,
    })
  }

  /** Replace the provider when the user updates their settings. */
  reset(config: ProviderConfig): void {
    Object.assign(this.s, buildState(config))
  }

  /** A requested budget, never above the model's own output limit. */
  private cap(maxTokens: number): number {
    const modelMax = this.s.config.modelMaxOutputTokens
    return modelMax !== undefined && maxTokens > modelMax ? modelMax : maxTokens
  }

  get currentProvider(): AIProvider {
    return this.s.provider
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      model?: string
      temperature?: number
      signal?: AbortSignal
    } & UsageTag &
      RequestTags,
  ): Promise<ChatResponse> {
    const req: ChatRequest = {
      messages,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      maxTokens: this.budget(),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
    }
    // Hidden reasoning never reaches a caller, so no renderer can show it.
    const { res } = await this.run(req, (r) => this.s.provider.chat(r), options?.usageKind)
    return { ...res, content: stripThinkBlocks(res.content) }
  }

  /**
   * Chat and parse the response as JSON. Tries the native `json_object` mode
   * when the provider supports it, otherwise extracts JSON defensively from
   * the prose response.
   */
  async chatJSON<T>(
    messages: ChatMessage[],
    options?: { model?: string; signal?: AbortSignal } & UsageTag & RequestTags,
  ): Promise<{ data: T; raw: ChatResponse }> {
    const useNativeJson = this.s.provider.capabilities.jsonMode
    const requested = this.budget()
    const req: ChatRequest = {
      messages,
      maxTokens: requested,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(useNativeJson ? { responseFormat: { type: 'json_object' } } : {}),
      ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
      temperature: this.s.config.temperature,
    }

    const sent = await this.run(req, (r) => this.s.provider.chat(r), options?.usageKind)
    const res = sent.res
    const maxTokens = sent.maxTokens ?? requested
    this.assertNotTruncated(res, maxTokens)
    const content = stripThinkBlocks(res.content)
    try {
      const data = extractJSON<T>(content)
      return { data, raw: { ...res, content } }
    } catch (err) {
      if (err instanceof InvalidJSONError) {
        logger.warn('AI returned non-JSON despite json mode; falling back to plain text retry', {
          provider: this.s.provider.id,
          length: content.length,
        })
        // One retry without json mode to coax a parsable result.
        const retry = await this.s.provider.chat({
          ...req,
          maxTokens,
          responseFormat: { type: 'text' },
        })
        this.track(retry, options?.usageKind)
        this.assertNotTruncated(retry, maxTokens)
        const retryContent = stripThinkBlocks(retry.content)
        try {
          const data = extractJSON<T>(retryContent)
          return { data, raw: { ...retry, content: retryContent } }
        } catch (err2) {
          throw err2 instanceof InvalidJSONError ? err2 : err
        }
      }
      throw err
    }
  }

  /**
   * Stream a JSON response and parse it once the stream completes.
   *
   * Long structured outputs (course analysis, quiz generation) can take
   * minutes to generate. A non-streaming request has to finish entirely inside
   * the request budget, which is impossible for those; streaming keeps data
   * flowing, so the budget only has to cover the gap *between* chunks.
   */
  async streamJSON<T>(
    messages: ChatMessage[],
    onDelta?: (delta: string) => void,
    options?: { model?: string; signal?: AbortSignal } & UsageTag & RequestTags,
  ): Promise<{ data: T; raw: ChatResponse }> {
    if (!this.s.provider.capabilities.streaming) {
      return this.chatJSON<T>(messages, options)
    }

    const requested = this.budget()
    const useNativeJson = this.s.provider.capabilities.jsonMode
    const req: ChatRequest = {
      messages,
      maxTokens: requested,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(useNativeJson ? { responseFormat: { type: 'json_object' } } : {}),
      ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
      temperature: this.s.config.temperature,
    }

    const stream = this.filteredStream(onDelta)
    const { res, maxTokens } = await this.run(req, stream.call, options?.usageKind)
    stream.flush()
    this.assertNotTruncated(res, maxTokens ?? requested)
    const content = stripThinkBlocks(res.content)
    const data = extractJSON<T>(content)
    return { data, raw: { ...res, content } }
  }

  /**
   * The output token cap requests may use: the model's own limit in 「使用模型
   * 允许的最大值」 mode, else the user's number (never above a known model limit).
   */
  get maxOutputTokens(): number {
    return this.s.config.maxTokens
  }

  /** The model's own output limit, when known (`/models` metadata or the documented table). */
  get modelMaxOutputTokens(): number | undefined {
    return this.s.config.modelMaxOutputTokens
  }

  /** How the output cap was resolved. */
  get outputLimit(): ResolvedOutputLimit {
    return this.s.limit
  }

  async streamChat(
    messages: ChatMessage[],
    onDelta: (delta: string) => void,
    options?: { model?: string; signal?: AbortSignal } & UsageTag & RequestTags,
  ): Promise<ChatResponse> {
    const req: ChatRequest = {
      messages,
      maxTokens: this.budget(),
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
    }
    // Deltas are filtered as they arrive so hidden reasoning can never flash
    // in the UI, even when a tag is split across chunks.
    const stream = this.filteredStream(onDelta)
    const { res } = await this.run(req, stream.call, options?.usageKind)
    stream.flush()
    return { ...res, content: stripThinkBlocks(res.content) }
  }

  /**
   * A streaming call whose visible deltas go through a `<think>` filter. Each
   * attempt (a retry after a `max_tokens` probe rejection) gets a fresh filter:
   * one left inside an unterminated `<think>` would hide the next answer.
   */
  private filteredStream(onDelta: ((delta: string) => void) | undefined): {
    call: (req: ChatRequest) => Promise<ChatResponse>
    flush: () => void
  } {
    const state: { filter: ThinkStreamFilter | null } = { filter: null }
    return {
      call: (r) => {
        state.filter?.flush()
        const filter = onDelta ? new ThinkStreamFilter(onDelta) : null
        state.filter = filter
        return this.s.provider.streamChat(r, (chunk) => {
          if (chunk.delta && filter) filter.push(chunk.delta)
        })
      },
      flush: () => state.filter?.flush(),
    }
  }

  async testConnection(): Promise<{
    ok: boolean
    latencyMs: number
    model: string
    error?: string
  }> {
    return this.s.provider.testConnection()
  }
}

/**
 * `ai.light()` (the 轻量模型) when available. Test doubles that only stub the
 * chat methods are returned unchanged.
 */
export function withLightModel<T extends AIService | null | undefined>(ai: T): T {
  if (ai && typeof (ai as Partial<AIService>).light === 'function') return ai.light() as T
  return ai
}

/**
 * `ai.withKind(kind)` when available. Test doubles that only stub the chat
 * methods are returned unchanged.
 */
export function withUsageKind<T extends AIService | null | undefined>(ai: T, kind: AIUsageKind): T {
  if (ai && typeof (ai as Partial<AIService>).withKind === 'function') {
    return ai.withKind(kind) as T
  }
  return ai
}

/**
 * 同时进行的 AI 请求数 for `ai` (test doubles without the setting: the
 * default 4).
 */
export function aiConcurrency(ai: unknown): number {
  const value = (ai as { concurrency?: unknown } | null | undefined)?.concurrency
  return typeof value === 'number' ? clampConcurrency(value) : DEFAULT_AI_CONCURRENCY
}

/**
 * The reply ran out of the whole output cap (cut off, or the thinking used it
 * up). The same request would end the same way, so it is never retried as is.
 */
export function exhaustedOutputCap(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code
  return code === 'OUTPUT_TRUNCATED' || code === 'REASONING_EXHAUSTED'
}

/**
 * `err` (a truncation) as the cut-off-at-the-cap error: kept when it already
 * is one, else rebuilt for `ai`'s cap. Every request is sent at the cap, so a
 * truncation is never answered by the same request with more room.
 */
export function asTruncatedAtCap(ai: unknown, err: unknown): OutputTruncatedError {
  if (err instanceof OutputTruncatedError && err.atCap) return err
  const cap = (ai as { maxOutputTokens?: unknown } | null | undefined)?.maxOutputTokens
  const budget =
    typeof cap === 'number' && Number.isFinite(cap) && cap > 0 ? cap : FALLBACK_OUTPUT_TOKENS
  return truncatedAtCap(ai, budget)
}

/**
 * The cut-off-at-the-cap error for `ai` (test doubles without the method:
 * named after the user's setting, as before).
 */
export function truncatedAtCap(ai: unknown, budget: number): OutputTruncatedError {
  const double = ai as Partial<AIService> | null | undefined
  const fn = double?.truncatedAtCap
  if (typeof fn === 'function') return fn.call(ai, budget)
  const modelMax = double?.modelMaxOutputTokens
  return new OutputTruncatedError(budget, {
    limit: budget,
    by: modelMax !== undefined && budget >= modelMax ? 'model' : 'setting',
  })
}
