import {
  type AIProvider,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ProviderConfig,
  createProvider,
  extractJSON,
} from '@/infrastructure/ai'
import { InvalidJSONError, OutputTruncatedError } from '@/infrastructure/ai/errors'
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
 * A model that stopped because it hit the output cap returns incomplete JSON.
 * Parsing it would produce a misleading "malformed JSON" error, so callers are
 * told what actually happened instead.
 */
function assertNotTruncated(res: ChatResponse, maxTokens: number): void {
  if (res.finishReason === 'length') throw new OutputTruncatedError(maxTokens)
}

export interface AIServiceOptions {
  config: ProviderConfig
  /** Request kind recorded in local usage statistics (default `other`). */
  usageKind?: AIUsageKind
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
  private provider: AIProvider
  private config: ProviderConfig
  private usageKind: AIUsageKind

  constructor(opts: AIServiceOptions) {
    this.config = opts.config
    this.provider = createProvider(opts.config)
    this.usageKind = opts.usageKind ?? 'other'
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

  /** Replace the provider when the user updates their settings. */
  reset(config: ProviderConfig): void {
    this.config = config
    this.provider = createProvider(config)
  }

  get currentProvider(): AIProvider {
    return this.provider
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      model?: string
      temperature?: number
      maxTokens?: number
      signal?: AbortSignal
    } & UsageTag,
  ): Promise<ChatResponse> {
    const req: ChatRequest = {
      messages,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    }
    // Hidden reasoning never reaches a caller, so no renderer can show it.
    const res = await this.provider.chat(req)
    this.track(res, options?.usageKind)
    return { ...res, content: stripThinkBlocks(res.content) }
  }

  /**
   * Chat and parse the response as JSON. Tries the native `json_object` mode
   * when the provider supports it, otherwise extracts JSON defensively from
   * the prose response.
   */
  async chatJSON<T>(
    messages: ChatMessage[],
    options?: { model?: string; maxTokens?: number; signal?: AbortSignal } & UsageTag,
  ): Promise<{ data: T; raw: ChatResponse }> {
    const useNativeJson = this.provider.capabilities.jsonMode
    const maxTokens = options?.maxTokens ?? this.config.maxTokens
    const req: ChatRequest = {
      messages,
      maxTokens,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(useNativeJson ? { responseFormat: { type: 'json_object' } } : {}),
      temperature: this.config.temperature,
    }

    const res = await this.provider.chat(req)
    this.track(res, options?.usageKind)
    assertNotTruncated(res, maxTokens)
    const content = stripThinkBlocks(res.content)
    try {
      const data = extractJSON<T>(content)
      return { data, raw: { ...res, content } }
    } catch (err) {
      if (err instanceof InvalidJSONError) {
        logger.warn('AI returned non-JSON despite json mode; falling back to plain text retry', {
          provider: this.provider.id,
          length: content.length,
        })
        // One retry without json mode to coax a parsable result.
        const retry = await this.provider.chat({ ...req, responseFormat: { type: 'text' } })
        this.track(retry, options?.usageKind)
        assertNotTruncated(retry, maxTokens)
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
    options?: { model?: string; maxTokens?: number; signal?: AbortSignal } & UsageTag,
  ): Promise<{ data: T; raw: ChatResponse }> {
    if (!this.provider.capabilities.streaming) {
      return this.chatJSON<T>(messages, options)
    }

    const maxTokens = options?.maxTokens ?? this.config.maxTokens
    const useNativeJson = this.provider.capabilities.jsonMode
    const req: ChatRequest = {
      messages,
      maxTokens,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(useNativeJson ? { responseFormat: { type: 'json_object' } } : {}),
      temperature: this.config.temperature,
    }

    const filter = onDelta ? new ThinkStreamFilter(onDelta) : null
    const res = await this.provider.streamChat(req, (chunk) => {
      if (chunk.delta && filter) filter.push(chunk.delta)
    })
    filter?.flush()
    this.track(res, options?.usageKind)
    assertNotTruncated(res, maxTokens)
    const content = stripThinkBlocks(res.content)
    const data = extractJSON<T>(content)
    return { data, raw: { ...res, content } }
  }

  /** The output token cap currently configured by the user. */
  get maxOutputTokens(): number {
    return this.config.maxTokens
  }

  async streamChat(
    messages: ChatMessage[],
    onDelta: (delta: string) => void,
    options?: { model?: string; signal?: AbortSignal } & UsageTag,
  ): Promise<ChatResponse> {
    const req: ChatRequest = {
      messages,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    }
    // Deltas are filtered as they arrive so hidden reasoning can never flash
    // in the UI, even when a tag is split across chunks.
    const filter = new ThinkStreamFilter(onDelta)
    const res = await this.provider.streamChat(req, (chunk) => {
      if (chunk.delta) filter.push(chunk.delta)
    })
    filter.flush()
    this.track(res, options?.usageKind)
    return { ...res, content: stripThinkBlocks(res.content) }
  }

  async testConnection(): Promise<{
    ok: boolean
    latencyMs: number
    model: string
    error?: string
  }> {
    return this.provider.testConnection()
  }
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
