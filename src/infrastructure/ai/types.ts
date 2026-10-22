import { AIProviderError, MissingAPIKeyError } from './errors'
import { t } from '@/i18n'

/** Roles accepted by OpenAI-compatible chat APIs. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  /** Optional name for multi-user / function-calling style prompts. */
  name?: string
  /**
   * Images for a vision-capable model, as `data:` URLs. When present the
   * message is sent as an OpenAI content array (text part + image parts).
   */
  images?: string[]
}

export type ResponseFormat = { type: 'text' } | { type: 'json_object' }

export interface ChatRequest {
  messages: ChatMessage[]
  /** Optional override; otherwise the provider's configured model is used. */
  model?: string
  temperature?: number
  maxTokens?: number
  /** Force JSON output where the provider supports it (e.g. OpenAI `json_object`). */
  responseFormat?: ResponseFormat
  /** Per-request cancellation. */
  signal?: AbortSignal
  /**
   * `low`: a formatting-only task that needs little thinking. Presets whose
   * models can think less translate it (MiniMax-M3: thinking off; M3.1-Flash:
   * `reasoning_effort: 'low'`); every other provider ignores it.
   */
  reasoning?: 'low'
}

export interface ChatChunk {
  delta: string
  done: boolean
  /** Usage stats arrive with the final chunk. */
  usage?: TokenUsage
}

/** Token counts reported by the provider for one response. */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Prompt tokens served from the provider's prefix cache, when reported. */
  cachedTokens?: number
  /** Completion tokens spent on hidden reasoning (`completion_tokens_details`). */
  reasoningTokens?: number
}

export interface ChatResponse {
  content: string
  /**
   * Length of the hidden reasoning the provider sent apart from the answer
   * (`reasoning_content` / `reasoning_details`). The text itself is dropped:
   * it is never course content.
   */
  reasoningChars?: number
  usage?: TokenUsage
  model: string
  /**
   * Provider stop reason. `'length'` means the model hit the output token cap
   * and `content` is cut off — for a JSON request that guarantees a parse
   * failure, so callers must report it as truncation rather than "bad JSON".
   */
  finishReason?: string
}

export interface ProviderCapabilities {
  jsonMode: boolean
  streaming: boolean
  tools: boolean
}

export interface AIProvider {
  readonly id: string
  readonly label: string
  readonly capabilities: ProviderCapabilities

  /**
   * Send a chat completion request and await the full response.
   * For long responses, prefer `streamChat`.
   */
  chat(req: ChatRequest): Promise<ChatResponse>

  /**
   * Stream a chat completion, invoking `onChunk` for each delta. Resolves
   * with the final accumulated response once the stream completes.
   */
  streamChat(req: ChatRequest, onChunk: (chunk: ChatChunk) => void): Promise<ChatResponse>

  /** Lightweight ping to verify credentials + network. */
  testConnection(): Promise<{ ok: boolean; latencyMs: number; model: string; error?: string }>
}

export interface ProviderConfig {
  provider: 'openai' | 'qwen' | 'deepseek' | 'MiniMax' | 'mimo' | 'custom'
  baseURL: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  /** How `maxTokens` is chosen (absent: the number as given, as before). */
  maxTokensMode?: 'model' | 'manual'
  /** Output limits by model id, read from the provider's `/models` metadata. */
  modelOutputLimits?: Record<string, number>
  /** Output limits by model id learned from provider rejections (自动探测). */
  learnedOutputLimits?: Record<string, number>
  /** 同时进行的 AI 请求数 (1–8); multi-part generations schedule this many at once. */
  maxConcurrency?: number
  /**
   * The model's own output limit, once resolved (`resolveProviderConfig`).
   * No request ever asks for more than this.
   */
  modelMaxOutputTokens?: number
  /**
   * 轻量模型: a cheaper model of the same provider (same key and base URL)
   * for simple tasks — see `AIService.light()`. Empty: the main model.
   */
  lightModel?: string
}

export function ensureConfig(cfg: ProviderConfig): ProviderConfig {
  if (!cfg.apiKey) throw new MissingAPIKeyError()
  if (!cfg.baseURL) throw new AIProviderError(t('errors.aiBaseUrlRequired'), 'MISSING_BASE_URL')
  if (!cfg.model) throw new AIProviderError(t('errors.aiModelRequired'), 'MISSING_MODEL')
  return cfg
}
