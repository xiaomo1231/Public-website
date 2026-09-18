import { AIProviderError, MissingAPIKeyError } from './errors'
import { t } from '@/i18n'

/** Roles accepted by OpenAI-compatible chat APIs. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  /** Optional name for multi-user / function-calling style prompts. */
  name?: string
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
}

export interface ChatChunk {
  delta: string
  done: boolean
  /** Usage stats arrive with the final chunk. */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export interface ChatResponse {
  content: string
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
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
}

export function ensureConfig(cfg: ProviderConfig): ProviderConfig {
  if (!cfg.apiKey) throw new MissingAPIKeyError()
  if (!cfg.baseURL) throw new AIProviderError(t('errors.aiBaseUrlRequired'), 'MISSING_BASE_URL')
  if (!cfg.model) throw new AIProviderError(t('errors.aiModelRequired'), 'MISSING_MODEL')
  return cfg
}