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
    const signal = this.combineSignals(req.signal)
    const res = await this.fetchWithTimeout(url, signal, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) {
      const message = await safeReadError(res)
      throw errorFromStatus(res.status, message)
    }
    const json = await res.json().catch(() => null)
    if (!json) throw new AIProviderError('AI returned a non-JSON response', 'INVALID_RESPONSE', res.status)
    const choice = json.choices?.[0]
    const content = choice?.message?.content ?? choice?.delta?.content ?? ''
    const u = json.usage
    const usage = u
      ? { promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 }
      : undefined
    const model = json.model ?? req.model ?? this.config.model
    return { content, usage, model }
  }

  async streamChat(req: ChatRequest, onChunk: (chunk: ChatChunk) => void): Promise<ChatResponse> {
    const url = this.endpoint()
    const body = this.buildChatBody(req, true)
    const signal = this.combineSignals(req.signal)
    const res = await this.fetchWithTimeout(url, signal, { method: 'POST', body: JSON.stringify(body) })
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
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ''
        for (const block of events) {
          const ev = parseBlock(block)
          if (!ev) continue
          if (ev.data === '[DONE]') {
            onChunk({ delta: '', done: true, usage })
            return { content, usage, model: finalModel || req.model || this.config.model }
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
        }
      }
    } catch (err) {
      if ((err as { name?: string } | undefined)?.name === 'AbortError') throw new AbortedError()
      throw err
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* ignore */
      }
    }
    onChunk({ delta: '', done: true, usage })
    return { content, usage, model: finalModel || req.model || this.config.model }
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; model: string; error?: string }> {
    const start = Date.now()
    try {
      const url = this.endpoint()
      const res = await this.fetchWithTimeout(url, undefined, {
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
      const message = err instanceof Error ? err.message : 'Connection failed'
      return { ok: false, latencyMs, model: this.config.model, error: message }
    }
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

  private combineSignals(extra?: AbortSignal): AbortSignal {
    const ctrl = new AbortController()
    const readMs = this.options.readTimeoutMs ?? 60_000
    const connectMs = this.options.connectTimeoutMs ?? 10_000
    const timeout = setTimeout(() => ctrl.abort(new TimeoutError(readMs)), connectMs + readMs)
    if (extra) {
      extra.addEventListener('abort', () => {
        ctrl.abort(new AbortedError())
        clearTimeout(timeout)
      })
    }
    return ctrl.signal
  }

  private async fetchWithTimeout(
    url: string,
    signal?: AbortSignal,
    init?: RequestInit,
  ): Promise<Response> {
    const connectMs = this.options.connectTimeoutMs ?? 10_000
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new TimeoutError(connectMs)), connectMs)
    if (signal) {
      signal.addEventListener('abort', () => {
        ctrl.abort(signal.reason)
        clearTimeout(timer)
      })
    }
    try {
      return await fetch(url, {
        ...init,
        method: init?.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(init?.headers as Record<string, string> | undefined),
        },
        signal: ctrl.signal,
      })
    } catch (err) {
      const name = (err as { name?: string } | undefined)?.name
      if (name === 'AbortError') {
        // Could be our timeout or the caller's cancellation.
        if (signal?.aborted) throw new AbortedError()
        throw new TimeoutError(connectMs)
      }
      if (err instanceof AIProviderError) throw err
      throw new ProviderUnavailableError((err as Error)?.message ?? 'Network error')
    } finally {
      clearTimeout(timer)
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
 * Parse a JSON object out of an AI response. Handles:
 *  - clean JSON
 *  - JSON wrapped in ```json fences
 *  - JSON embedded in prose
 *  - fallback: throws InvalidJSONError
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

  // Try to find the first JSON object/array in the text.
  const start = trimmed.search(/[[{]/)
  if (start === -1) throw new InvalidJSONError('no JSON token found')
  let end = -1
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]!
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
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new InvalidJSONError('unbalanced braces')
  const candidate = trimmed.slice(start, end + 1)
  return parseStrict(candidate) as T
}

function parseStrict(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new InvalidJSONError((err as Error).message)
  }
}