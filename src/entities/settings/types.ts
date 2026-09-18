export type AIProviderId = 'openai' | 'qwen' | 'deepseek' | 'MiniMax' | 'mimo' | 'custom'

export interface ProviderPreset {
  id: AIProviderId
  label: string
  baseURL: string
  defaultModel: string
  models: string[]
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    id: 'qwen',
    label: 'Qwen (DashScope)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'MiniMax',
    label: 'MiniMax',
    baseURL: 'https://api.MiniMax.com/v1',
    defaultModel: 'MiniMax-Text-01',
    models: ['MiniMax-Text-01', 'MiniMax-VL-01'],
  },
  {
    id: 'mimo',
    label: 'MiMo',
    baseURL: 'https://api.mimo.example.com/v1',
    defaultModel: 'mimo-7b',
    models: ['mimo-7b', 'mimo-13b'],
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseURL: '',
    defaultModel: '',
    models: [],
  },
]

export const DEFAULT_AI_SETTINGS: Omit<AISettingsRow, 'updatedAt'> = {
  id: 'singleton',
  provider: 'openai',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 2048,
}

/**
 * The shape actually persisted in IndexedDB.
 *
 * The API key is **never** stored here in plaintext: it lives in
 * `apiKeyEncrypted` as an AES-GCM payload. `apiKey` exists only to carry a
 * legacy plaintext value until the migration in `SettingsService` moves it.
 */
export interface AISettingsRow {
  id: 'singleton'
  provider: AIProviderId
  baseURL: string
  /** `base64(iv).base64(ciphertext)` produced by Web Crypto AES-GCM. */
  apiKeyEncrypted?: string
  /** @deprecated Legacy plaintext key. Cleared by migration. */
  apiKey?: string
  model: string
  temperature: number
  maxTokens: number
  updatedAt: number
}

/**
 * The in-memory shape handed to callers. `apiKey` is decrypted on read and
 * only ever exists in memory — it is never persisted in this shape.
 */
export interface AISettings {
  id: 'singleton'
  provider: AIProviderId
  baseURL: string
  /**
   * Decrypted API key. Sent only to the user-configured baseURL when a
   * request is made. Never logged, never placed in a URL.
   */
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  updatedAt: number
}

export interface UpdateAISettingsInput {
  provider?: AIProviderId
  baseURL?: string
  apiKey?: string
  model?: string
  temperature?: number
  maxTokens?: number
}