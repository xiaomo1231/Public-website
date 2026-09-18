import {
  type AIProvider,
  type ChatChunk,
  type ChatRequest,
  type ChatResponse,
  type ProviderCapabilities,
  type ProviderConfig,
  ensureConfig,
} from './types'
import {
  AbortedError,
  AIProviderError,
  InvalidJSONError,
  ProviderUnavailableError,
  TimeoutError,
  errorFromStatus,
} from './errors'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

interface RequestBudget {
  signal: AbortSignal
  /**
   * Restart the inactivity window. Called whenever the provider sends data, so
   * a long but healthy stream is not killed merely for taking a long time
   * overall.
   */
  touch: () => void
  dispose: () => void
}

export interface OpenAICompatibleOptions {
  /** Default model when caller doesn't specify one. */
  defaultModel: string
  /** When true, requests `response_format: { type: 'json_object' }`. */
  supportsJsonMode: boolean
  /** Connect timeout in ms (default 10 s). */
  connectTimeoutMs?: number
  /** Read timeout in ms (default 60 s). */
  readTimeoutMs?: number
}

/**
 * Concrete provider that talks to any OpenAI-compatible `/chat/completions`
 * endpoint. All five presets (OpenAI / Qwen / DeepSeek / MiniMax / MiMo / Custom)
 * reuse this implementation; only `defaultModel` and `supportsJsonMode` differ.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string
  readonly label: string
  readonly capabilities: ProviderCapabilities
  private readonly config: ProviderConfig
  private readonly options: OpenAICompatibleOptions

  constructor(id: string, label: string, config: ProviderConfig, options: OpenAICompatibleOptions) {
    this.id = id
    this.label = label
    this.config = ensureConfig(config)
    this.options = options
    this.capabilities = {
      jsonMode: options.supportsJsonMode,
      streaming: true,
      tools: false,
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const url = this.endpoint()
    const body = this.buildChatBody(req, false)
    const budget = this.budgetSignal(req.signal)
    const startedAt = this.logRequestStart('chat', req)
    try {
      const res = await this.fetchWithBudget(url, budget.signal, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const message = await safeReadError(res)
        throw errorFromStatus(res.status, message)
      }
      const json = await res.json().catch(() => null)
      if (!json) throw new AIProviderError(t('errors.aiNonJson'), 'INVALID_RESPONSE', res.status)
      const choice = json.choices?.[0]
      const content = choice?.message?.content ?? choice?.delta?.content ?? ''
      const u = json.usage
      const usage = u
        ? { promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 }
        : undefined
      const model = json.model ?? req.model ?? this.config.model
      const finishReason =
        typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined
      const response: ChatResponse = {
        content,
        usage,
        model,
        ...(finishReason ? { finishReason } : {}),
      }
      this.logRequestEnd('chat', startedAt, response)
      return response
    } catch (err) {
      this.logRequestError('chat', startedAt, err, budget.signal)
      throw err
    } finally {
      budget.dispose()
    }
  }

  async streamChat(req: ChatRequest, onChunk: (chunk: ChatChunk) => void): Promise<ChatResponse> {
    const url = this.endpoint()
    const body = this.buildChatBody(req, true)
    const budget = this.budgetSignal(req.signal)
    const startedAt = this.logRequestStart('stream', req)
    try {
      const res = await this.fetchWithBudget(url, budget.signal, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) {
        const message = await safeReadError(res)
        throw errorFromStatus(res.status, message)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let content = ''
      let usage: ChatResponse['usage'] | undefined
      let finalModel = ''
      let finalFinishReason: string | undefined
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          // Receiving data resets the inactivity window, so a long generation
          // is bounded by silence rather than by total elapsed time.
          budget.touch()
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split(/\r?\n\r?\n/)
          buffer = events.pop() ?? ''
          for (const block of events) {
            const ev = parseBlock(block)
            if (!ev) continue
            if (ev.data === '[DONE]') {
              onChunk({ delta: '', done: true, usage })
              const response: ChatResponse = {
                content,
                usage,
                model: finalModel || req.model || this.config.model,
                ...(finalFinishReason ? { finishReason: finalFinishReason } : {}),
              }
              this.logRequestEnd('stream', startedAt, response)
              return response
            }
            const parsed = safeJSON(ev.data)
            if (!parsed) continue
            const choice = parsed.choices?.[0]
            const delta = choice?.delta?.content ?? choice?.message?.content ?? ''
            if (delta) {
              content += delta
              onChunk({ delta, done: false })
            }
            const u = parsed.usage
            if (u) {
              usage = {
                promptTokens: u.prompt_tokens ?? 0,
                completionTokens: u.completion_tokens ?? 0,
                totalTokens: u.total_tokens ?? 0,
              }
            }
            if (parsed.model) finalModel = parsed.model
            if (typeof choice?.finish_reason === 'string') {
              finalFinishReason = choice.finish_reason
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string } | undefined)?.name === 'AbortError') {
          // Preserve why we aborted: our own inactivity timeout, or the caller.
          const reason: unknown = budget.signal.reason
          if (reason instanceof AIProviderError) throw reason
          throw new AbortedError()
        }
        throw err
      } finally {
        try {
          reader.releaseLock()
        } catch {
          /* ignore */
        }
      }
      onChunk({ delta: '', done: true, usage })
      const response: ChatResponse = {
        content,
        usage,
        model: finalModel || req.model || this.config.model,
        ...(finalFinishReason ? { finishReason: finalFinishReason } : {}),
      }
      this.logRequestEnd('stream', startedAt, response)
      return response
    } catch (err) {
      this.logRequestError('stream', startedAt, err, budget.signal)
      throw err
    } finally {
      budget.dispose()
    }
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; model: string; error?: string }> {
    const start = Date.now()
    const budget = this.budgetSignal()
    try {
      const url = this.endpoint()
      const res = await this.fetchWithBudget(url, budget.signal, {
        method: 'POST',
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
          stream: false,
          temperature: 0,
        }),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        const message = await safeReadError(res)
        return {
          ok: false,
          latencyMs,
          model: this.config.model,
          error: errorFromStatus(res.status, message).message,
        }
      }
      return { ok: true, latencyMs, model: this.config.model }
    } catch (err) {
      const latencyMs = Date.now() - start
      const message = err instanceof Error ? err.message : t('errors.aiConnectionFailed')
      return { ok: false, latencyMs, model: this.config.model, error: message }
    } finally {
      budget.dispose()
    }
  }

  /**
   * Structured lifecycle logging. Never logs the API key, the Authorization
   * header, or any message content — only sizes and timing.
   */
  private logRequestStart(mode: 'chat' | 'stream', req: ChatRequest): number {
    const inputChars = req.messages.reduce((total, m) => total + m.content.length, 0)
    logger.debug('AI request start', {
      provider: this.id,
      model: req.model ?? this.config.model,
      url: this.endpoint(),
      streaming: mode === 'stream',
      inputChars,
      estimatedInputTokens: Math.round(inputChars / 3),
      maxOutputTokens: req.maxTokens ?? this.config.maxTokens,
      timeoutMs: this.totalBudgetMs(),
    })
    return Date.now()
  }

  private logRequestEnd(mode: 'chat' | 'stream', startedAt: number, res: ChatResponse): void {
    logger.debug('AI request end', {
      provider: this.id,
      model: res.model,
      streaming: mode === 'stream',
      durationMs: Date.now() - startedAt,
      finishReason: res.finishReason,
      responseChars: res.content.length,
      estimatedOutputTokens: Math.round(res.content.length / 4),
      promptTokens: res.usage?.promptTokens,
      completionTokens: res.usage?.completionTokens,
    })
  }

  private logRequestError(
    mode: 'chat' | 'stream',
    startedAt: number,
    err: unknown,
    signal: AbortSignal,
  ): void {
    logger.warn('AI request error', {
      provider: this.id,
      model: this.config.model,
      streaming: mode === 'stream',
      durationMs: Date.now() - startedAt,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      code: err instanceof AIProviderError ? err.code : undefined,
      httpStatus: err instanceof AIProviderError ? err.status : undefined,
      aborted: signal.aborted,
      timeoutMs: this.totalBudgetMs(),
    })
  }

  private endpoint(): string {
    const base = this.config.baseURL.replace(/\/$/, '')
    if (base.endsWith('/chat/completions')) return base
    return `${base}/chat/completions`
  }

  private buildChatBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const model = req.model ?? this.config.model
    const body: Record<string, unknown> = {
      model,
      messages: req.messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content }
        if (m.name) msg.name = m.name
        return msg
      }),
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      stream,
    }
    if (req.responseFormat?.type === 'json_object' && this.options.supportsJsonMode) {
      body.response_format = { type: 'json_object' }
    }
    return body
  }

  /**
   * Build the time budget for one request.
   *
   * `connectTimeoutMs` bounds establishing the connection and
   * `readTimeoutMs` bounds waiting for the response. They are **additive**,
   * because a non-streaming completion only returns its response headers once
   * the model has finished generating. Applying the (much shorter) connect
   * timeout to that wait would abort healthy long requests — a large analysis
   * prompt takes far longer than 10 s to answer.
   */
  private totalBudgetMs(): number {
    const readMs = this.options.readTimeoutMs ?? 60_000
    const connectMs = this.options.connectTimeoutMs ?? 10_000
    return connectMs + readMs
  }

  private budgetSignal(extra?: AbortSignal): RequestBudget {
    const totalMs = this.totalBudgetMs()
    const ctrl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null

    const arm = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => ctrl.abort(new TimeoutError(totalMs)), totalMs)
    }
    arm()

    const onExternalAbort = (): void => {
      if (timer) clearTimeout(timer)
      ctrl.abort(new AbortedError())
    }
    if (extra) {
      if (extra.aborted) onExternalAbort()
      else extra.addEventListener('abort', onExternalAbort)
    }

    return {
      signal: ctrl.signal,
      touch: () => {
        if (!ctrl.signal.aborted) arm()
      },
      dispose: () => {
        if (timer) clearTimeout(timer)
        extra?.removeEventListener('abort', onExternalAbort)
      },
    }
  }

  private async fetchWithBudget(
    url: string,
    signal: AbortSignal,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        method: init?.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(init?.headers as Record<string, string> | undefined),
        },
        signal,
      })
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name
      if (name === 'AbortError') {
        // The budget signal carries the reason: either our own timeout or the
        // caller's cancellation.
        const reason: unknown = signal.reason
        if (reason instanceof AIProviderError) throw reason
        if (signal.aborted) throw new AbortedError()
        // An AbortError we did not raise means the request budget expired
        // somewhere below us (transport-level abort).
        throw new TimeoutError(this.totalBudgetMs())
      }
      if (err instanceof AIProviderError) throw err
      throw new ProviderUnavailableError((err as Error)?.message ?? t('errors.aiNetwork'))
    }
  }
}

function parseBlock(block: string): { data: string } | null {
  const trimmed = block.trim()
  if (!trimmed) return null
  let data: string | undefined
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      data = line.slice(5).trim()
    }
  }
  return data ? { data } : null
}

interface SSEChoice {
  delta?: { content?: string }
  message?: { content?: string }
  finish_reason?: string | null
}
interface SSEParsed {
  choices?: SSEChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  model?: string
}

function safeJSON(text: string): SSEParsed | null {
  if (!text || text === '[DONE]') return null
  try {
    return JSON.parse(text) as SSEParsed
  } catch {
    return null
  }
}

async function safeReadError(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      return json.error?.message ?? json.message ?? text
    } catch {
      return text.slice(0, 240)
    }
  } catch {
    return undefined
  }
}

/**
 * Return the balanced JSON slice that starts at `start`, or `null` when its
 * brackets never close. Handles strings, escaped quotes and nesting.
 */
function balancedSlice(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Bounds the scan so pathological prose cannot make parsing quadratic. */
const MAX_JSON_CANDIDATES = 200

/**
 * Parse a JSON value out of an AI response. Handles:
 *  - clean JSON
 *  - JSON wrapped in ```json fences
 *  - JSON embedded in prose
 *  - fallback: throws InvalidJSONError
 *
 * Candidates are validated by actually parsing them. Merely starting at the
 * first `{` or `[` is not enough: the page markers we send to the model
 * (`[p1]`, `[p2]`, …) are echoed back when it cites sources, and `[p1]` would
 * otherwise be mistaken for the JSON document.
 */
export function extractJSON<T = unknown>(content: string): T {
  const trimmed = content.trim()
  if (!trimmed) throw new InvalidJSONError('empty response')

  // Strip ```json fences.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch) {
    return parseStrict(fenceMatch[1]!.trim()) as T
  }

  // Try direct parse.
  try {
    return JSON.parse(trimmed) as T
  } catch {
    /* fall through */
  }

  // Scan each bracket that could start a JSON value; take the first that parses.
  let sawBracket = false
  let lastError: Error | null = null
  let attempts = 0
  for (let start = 0; start < trimmed.length && attempts < MAX_JSON_CANDIDATES; start += 1) {
    const ch = trimmed[start]
    if (ch !== '{' && ch !== '[') continue
    sawBracket = true
    attempts += 1
    const candidate = balancedSlice(trimmed, start)
    if (!candidate) continue
    try {
      return JSON.parse(candidate) as T
    } catch (err) {
      lastError = err as Error
    }
  }

  logger.debug('AI JSON extraction failed', {
    length: trimmed.length,
    prefix: trimmed.slice(0, 160),
    suffix: trimmed.slice(-160),
  })

  if (lastError) throw new InvalidJSONError(lastError.message)
  if (sawBracket) throw new InvalidJSONError('unbalanced braces')
  throw new InvalidJSONError('no JSON token found')
}

function parseStrict(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new InvalidJSONError((err as Error).message)
  }
}