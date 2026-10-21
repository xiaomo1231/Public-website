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
  RateLimitedError,
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
  /** The window (ms) this budget enforces; reported in timeout errors and logs. */
  timeoutMs: number
}

export interface OpenAICompatibleOptions {
  /** Default model when caller doesn't specify one. */
  defaultModel: string
  /** When true, requests `response_format: { type: 'json_object' }`. */
  supportsJsonMode: boolean
  /** Connect timeout in ms (default 10 s). */
  connectTimeoutMs?: number
  /** Read timeout in ms (default 60 s): the inactivity window of a stream. */
  readTimeoutMs?: number
  /**
   * Total wait for a non-streaming completion after connecting (default
   * 5 min). Such a response only arrives once generation has finished, so a
   * slow-but-working request must not be cut off at the streaming idle window.
   */
  nonStreamingTimeoutMs?: number
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
    // A non-streaming completion only answers once the whole generation is
    // done, so there is no data to restart an inactivity window with: give it
    // a long total budget instead of the streaming idle window.
    const budget = this.budgetSignal(req.signal, this.chatBudgetMs())
    const startedAt = this.logRequestStart('chat', req, budget.timeoutMs)
    try {
      const res = await this.fetchWithBudget(url, budget, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const message = await safeReadError(res)
        throw errorFromStatus(res.status, message)
      }
      const json = await res.json().catch(() => null)
      if (!json) throw new AIProviderError(t('errors.aiNonJson'), 'INVALID_RESPONSE', res.status)
      if (hasErrorPayload(json)) throw errorFromPayload(json, res.status)
      const choice = json.choices?.[0]
      const content = choice?.message?.content ?? choice?.delta?.content ?? ''
      const u = json.usage
      const usage = u
        ? {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0,
          }
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
      this.logRequestError('chat', startedAt, err, budget)
      throw err
    } finally {
      budget.dispose()
    }
  }

  async streamChat(req: ChatRequest, onChunk: (chunk: ChatChunk) => void): Promise<ChatResponse> {
    const url = this.endpoint()
    const body = this.buildChatBody(req, true)
    const budget = this.budgetSignal(req.signal)
    const startedAt = this.logRequestStart('stream', req, budget.timeoutMs)
    try {
      const res = await this.fetchWithBudget(url, budget, {
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
      const finish = (): ChatResponse => {
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
      /** Handle one SSE event block; true once the stream says `[DONE]`. */
      // Raw body kept only until the first SSE event: a provider that answers a
      // stream request with a plain JSON body (often an error) sends no events.
      let sawEvent = false
      let raw = ''
      const handleBlock = (block: string): boolean => {
        const ev = parseBlock(block)
        if (!ev) return false
        sawEvent = true
        if (ev.data === '[DONE]') return true
        const parsed = safeJSON(ev.data)
        if (!parsed) return false
        // `data: {"error": …}` — the provider failed mid-stream.
        if (hasErrorPayload(parsed)) throw errorFromPayload(parsed, res.status)
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
        return false
      }
      const read = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
        try {
          return await reader.read()
        } catch (err) {
          if ((err as { name?: string } | undefined)?.name === 'AbortError') {
            // Preserve why we aborted: our own inactivity timeout, or the caller.
            const reason: unknown = budget.signal.reason
            if (reason instanceof AIProviderError) throw reason
            throw new AbortedError()
          }
          if (err instanceof AIProviderError) throw err
          // The connection dropped mid-stream ("network error", "terminated", …).
          throw new ProviderUnavailableError(
            err instanceof Error && err.message ? err.message : t('errors.aiNetwork'),
          )
        }
      }
      try {
        while (true) {
          const { value, done } = await read()
          if (done) break
          // Receiving data resets the inactivity window, so a long generation
          // is bounded by silence rather than by total elapsed time.
          budget.touch()
          const text = decoder.decode(value, { stream: true })
          if (!sawEvent && raw.length < MAX_RAW_BODY_CHARS) raw += text
          buffer += text
          const events = buffer.split(/\r?\n\r?\n/)
          buffer = events.pop() ?? ''
          for (const block of events) {
            if (handleBlock(block)) return finish()
          }
        }
        // The stream ended: flush the decoder (a multi-byte character may be
        // split across the last chunk) and parse an event that was not
        // followed by a blank line.
        const tail = decoder.decode()
        if (!sawEvent) raw += tail
        buffer += tail
        for (const block of buffer.split(/\r?\n\r?\n/)) {
          if (handleBlock(block)) return finish()
        }
        if (!sawEvent && raw.trim()) {
          // Not an event stream: parse the body as one JSON response.
          let json: unknown
          try {
            json = JSON.parse(raw)
          } catch {
            throw new AIProviderError(t('errors.aiNonJson'), 'INVALID_RESPONSE', res.status)
          }
          if (hasErrorPayload(json)) throw errorFromPayload(json, res.status)
          const parsed = json as SSEParsed
          const choice = parsed.choices?.[0]
          const whole = choice?.message?.content ?? choice?.delta?.content ?? ''
          if (whole) {
            content += whole
            onChunk({ delta: whole, done: false })
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
          if (typeof choice?.finish_reason === 'string') finalFinishReason = choice.finish_reason
        }
      } finally {
        try {
          reader.releaseLock()
        } catch {
          /* ignore */
        }
      }
      return finish()
    } catch (err) {
      this.logRequestError('stream', startedAt, err, budget)
      throw err
    } finally {
      budget.dispose()
    }
  }

  async testConnection(): Promise<{
    ok: boolean
    latencyMs: number
    model: string
    error?: string
  }> {
    const start = Date.now()
    const budget = this.budgetSignal()
    try {
      const url = this.endpoint()
      const res = await this.fetchWithBudget(url, budget, {
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
  private logRequestStart(mode: 'chat' | 'stream', req: ChatRequest, timeoutMs: number): number {
    const inputChars = req.messages.reduce((total, m) => total + m.content.length, 0)
    logger.debug('AI request start', {
      provider: this.id,
      model: req.model ?? this.config.model,
      // Origin + path only: a custom base URL may carry a key in its query.
      url: redactUrl(this.endpoint()),
      streaming: mode === 'stream',
      inputChars,
      estimatedInputTokens: Math.round(inputChars / 3),
      maxOutputTokens: req.maxTokens ?? this.config.maxTokens,
      timeoutMs,
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
    budget: RequestBudget,
  ): void {
    logger.warn('AI request error', {
      provider: this.id,
      model: this.config.model,
      streaming: mode === 'stream',
      durationMs: Date.now() - startedAt,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: sanitizeProviderText(err instanceof Error ? err.message : String(err)),
      code: err instanceof AIProviderError ? err.code : undefined,
      httpStatus: err instanceof AIProviderError ? err.status : undefined,
      aborted: budget.signal.aborted,
      timeoutMs: budget.timeoutMs,
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
        const msg: Record<string, unknown> = {
          role: m.role,
          content: m.images?.length
            ? [
                { type: 'text', text: m.content },
                ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
              ]
            : m.content,
        }
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

  /**
   * Total budget of a non-streaming completion: the connect timeout plus
   * `nonStreamingTimeoutMs` (default 5 min). It cannot be an inactivity window
   * because nothing arrives until the model has finished generating.
   */
  private chatBudgetMs(): number {
    const connectMs = this.options.connectTimeoutMs ?? 10_000
    return connectMs + (this.options.nonStreamingTimeoutMs ?? 300_000)
  }

  private budgetSignal(extra?: AbortSignal, totalMs = this.totalBudgetMs()): RequestBudget {
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
      timeoutMs: totalMs,
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
    budget: RequestBudget,
    init?: RequestInit,
  ): Promise<Response> {
    const signal = budget.signal
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
        throw new TimeoutError(budget.timeoutMs)
      }
      if (err instanceof AIProviderError) throw err
      throw new ProviderUnavailableError((err as Error)?.message ?? t('errors.aiNetwork'))
    }
  }
}

/** Origin + path of a URL, never its query or fragment (may hold credentials). */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.replace(/[?#].*$/, '').replace(/\/\/[^/@]*@/, '//')
  }
}

/** Cap on the raw body kept for the non-SSE fallback (a JSON body is small). */
const MAX_RAW_BODY_CHARS = 2_000_000

function parseBlock(block: string): { data: string } | null {
  const trimmed = block.trim()
  if (!trimmed) return null
  // Per the SSE spec, several `data:` lines of one event are joined with "\n".
  const lines: string[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      let value = line.slice(5)
      if (value.startsWith(' ')) value = value.slice(1)
      lines.push(value)
    }
  }
  const data = lines.join('\n').trim()
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

/** Longest provider error text that is ever logged or shown. */
const MAX_PROVIDER_ERROR_CHARS = 240

/**
 * Mask anything credential-like in provider-supplied text and cap its length.
 * Providers sometimes echo the key (or a request header) back in an error, and
 * that text reaches both the log and the UI.
 */
export function sanitizeProviderText(text: string): string {
  const masked = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]')
    .replace(
      /\b(api[_-]?key|access[_-]?key|secret|token|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]{6,}/gi,
      '$1$2[REDACTED]',
    )
    // Long opaque tokens mixing letters and digits (keys, signed ids).
    .replace(/(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])\b[A-Za-z0-9_-]{32,}\b/g, '[REDACTED]')
  return masked.length > MAX_PROVIDER_ERROR_CHARS
    ? `${masked.slice(0, MAX_PROVIDER_ERROR_CHARS)}…`
    : masked
}

/** Pull a human message out of a provider error payload (`{error:{message}}`, …). */
function providerMessage(json: unknown, fallback: string): string {
  const root = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const error = root.error
  const candidate =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>).message
      : (error ?? root.message)
  return typeof candidate === 'string' && candidate.trim() ? candidate : fallback
}

async function safeReadError(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text()
    let message = text
    try {
      message = providerMessage(JSON.parse(text), text)
    } catch {
      /* not JSON — keep the raw text */
    }
    const clean = sanitizeProviderText(message.trim())
    return clean || undefined
  } catch {
    return undefined
  }
}

/**
 * A provider that fails *inside* a 200 response (an SSE `{"error":…}` event, or
 * a JSON error body) — map it to the same typed errors as an HTTP failure.
 */
function errorFromPayload(json: unknown, httpStatus: number): AIProviderError {
  const root = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const error = (root.error && typeof root.error === 'object' ? root.error : root) as Record<
    string,
    unknown
  >
  const message = sanitizeProviderText(providerMessage(json, '').trim()) || undefined
  const numeric = [error.status, error.code, error.http_status, root.status]
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value >= 400 && value < 600)
  if (numeric !== undefined) return errorFromStatus(numeric, message)
  const hint = `${String(error.type ?? '')} ${String(error.code ?? '')}`
  if (/rate.?limit|too.?many/i.test(hint) && !/quota|insufficient|balance/i.test(hint)) {
    return new RateLimitedError(message)
  }
  if (/auth|api.?key|permission/i.test(hint)) return errorFromStatus(401, message)
  if (/server|overload|unavailable/i.test(hint)) return new ProviderUnavailableError(message)
  return errorFromStatus(httpStatus >= 400 ? httpStatus : 400, message)
}

function hasErrorPayload(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false
  const root = json as Record<string, unknown>
  return root.error !== undefined && root.error !== null && !Array.isArray(root.choices)
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

/** The characters that may legally follow a backslash inside a JSON string. */
const VALID_ESCAPE_CHARS = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

/**
 * Repair the most common malformed-JSON defect from a language model: a
 * backslash inside a string that was never escaped. Course analysis is full of
 * LaTeX (`\sqrt`, `\cap`, `\le`, …), and `\s`/`\c`/`\l` are not legal JSON
 * escapes, so a single unescaped command makes the entire document unparseable.
 *
 * Inside strings, a backslash not followed by a legal escape character is
 * doubled (`\sqrt` → `\\sqrt`). Already-valid JSON is returned unchanged, and
 * text outside strings is never touched.
 */
export function repairInvalidEscapes(text: string): string {
  if (!text.includes('\\')) return text
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (ch === '\\') {
      const next = text[i + 1]
      if (next !== undefined && VALID_ESCAPE_CHARS.has(next)) {
        out += ch + next
        i += 1
      } else {
        out += '\\\\'
      }
      continue
    }
    if (ch === '"') inString = false
    out += ch
  }
  return out
}

/**
 * Parse `text`, retrying once after repairing unescaped backslashes. Returns a
 * discriminated result so a legitimate `null` JSON value is never confused with
 * a parse failure.
 */
function parseLenient(text: string): { ok: true; value: unknown } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const repaired = repairInvalidEscapes(text)
    if (repaired !== text) {
      try {
        return { ok: true, value: JSON.parse(repaired) }
      } catch {
        /* keep the original error below */
      }
    }
    return { ok: false, error: error as Error }
  }
}

/**
 * Parse a JSON value out of an AI response. Handles:
 *  - clean JSON
 *  - JSON wrapped in ```json fences
 *  - JSON embedded in prose
 *  - unescaped backslashes inside strings (repaired once)
 *  - fallback: throws InvalidJSONError
 *
 * Candidates are validated by actually parsing them. Merely starting at the
 * first `{` or `[` is not enough: the page markers we send to the model
 * (`[p1]`, `[p2]`, …) are echoed back when it cites sources, and `[p1]` would
 * otherwise be mistaken for the JSON document.
 *
 * Only *top-level* candidates are considered. Once a balanced candidate fails
 * to parse its whole span is skipped, so a fragment nested inside a malformed
 * document (for example one topic object inside a broken course analysis) can
 * never be returned in place of the document.
 */
export function extractJSON<T = unknown>(content: string): T {
  const trimmed = content.trim()
  if (!trimmed) throw new InvalidJSONError('empty response')

  // Fenced JSON. A response may contain several fenced blocks — an
  // illustrative snippet followed by the real payload, say — so the longest is
  // tried first: a small example cannot be mistaken for the document.
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)].map((match) =>
    match[1]!.trim(),
  )
  for (const block of [...fenced].sort((a, b) => b.length - a.length)) {
    const parsed = parseLenient(block)
    if (parsed.ok) return parsed.value as T
  }

  // Try the whole response directly.
  const direct = parseLenient(trimmed)
  if (direct.ok) return direct.value as T

  // Scan each bracket that could start a JSON value, skipping the whole span of
  // a candidate that fails so nested fragments are never accepted.
  let sawBracket = false
  let lastError: Error | null = null
  let attempts = 0
  for (let start = 0; start < trimmed.length && attempts < MAX_JSON_CANDIDATES; start += 1) {
    const ch = trimmed[start]
    if (ch !== '{' && ch !== '[') continue
    sawBracket = true
    attempts += 1
    const candidate = balancedSlice(trimmed, start)
    // An opener that never closes means the payload is truncated; there is no
    // complete value to recover.
    if (!candidate) break
    const parsed = parseLenient(candidate)
    if (parsed.ok) return parsed.value as T
    lastError = parsed.error
    start += candidate.length - 1
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
