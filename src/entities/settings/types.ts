import type { AIUsagePrices, AIUsageStore } from '@/entities/aiUsage/types'

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
  // New installs use the model's own output limit; the number is the fallback
  // when that limit is unknown. Existing rows (no mode) keep their number.
  maxTokens: 8192,
  maxTokensMode: 'model',
}

/**
 * The shape actually persisted in IndexedDB.
 *
 * The API key is **never** stored here in plaintext: it lives in
 * `apiKeyEncrypted` as an AES-GCM payload. `apiKey` exists only to carry a
 * legacy plaintext value until the migration in `SettingsService` moves it.
 */
/** `/models` output limits, remembered for the base URL they were read from. */
export interface ModelOutputLimits {
  baseURL: string
  limits: Record<string, number>
}

export type MaxTokensMode = 'model' | 'manual'

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
  /**
   * 「使用模型允许的最大值」 (`model`) or the number above (`manual`). Absent on
   * rows written before the option existed: those keep their number.
   */
  maxTokensMode?: MaxTokensMode
  /**
   * Output limits by model id from the provider's `/models` metadata (only
   * output fields, never the context length), for `baseURL`.
   */
  modelOutputLimits?: ModelOutputLimits
  /**
   * 轻量模型 (optional): same provider and key, used only for simple tasks
   * (`AIService.light()`). Absent / empty: the main model does everything.
   */
  lightModel?: string
  /** Opt-in: search the web for chemistry / biology reference images. */
  webImagesEnabled?: boolean
  /** Ask the (vision-capable) model whether each image fits its purpose. */
  webImagesVisionCheck?: boolean
  /**
   * OpenAI admin key (`sk-admin-…`), AES-GCM encrypted like the API key. Used
   * ONLY for the organization Costs API (this month's spend). Never exported.
   */
  adminApiKeyEncrypted?: string
  /** Optional per-1M-token prices for an estimated cost (labelled 估算). */
  usagePrices?: AIUsagePrices
  /**
   * Local per-month, per-kind token counters. Owned by `AIUsageService`:
   * settings writes preserve whatever is stored (see `SettingsRepository`).
   */
  usage?: AIUsageStore
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
  /** 轻量模型 ('' or absent: none). */
  lightModel?: string
  temperature: number
  /** The manual number (also the fallback when the model's limit is unknown). */
  maxTokens: number
  maxTokensMode: MaxTokensMode
  /** Limits read from `/models` for the current base URL (empty when none). */
  modelOutputLimits: Record<string, number>
  /** Off by default; see `AISettingsRow.webImagesEnabled`. */
  webImagesEnabled: boolean
  webImagesVisionCheck: boolean
  /** Decrypted OpenAI admin key ('' when unset). In memory only. */
  adminApiKey: string
  usagePrices: AIUsagePrices | null
  updatedAt: number
}

export interface UpdateAISettingsInput {
  provider?: AIProviderId
  baseURL?: string
  apiKey?: string
  model?: string
  lightModel?: string
  temperature?: number
  maxTokens?: number
  maxTokensMode?: MaxTokensMode
  webImagesEnabled?: boolean
  webImagesVisionCheck?: boolean
  adminApiKey?: string
  usagePrices?: AIUsagePrices | null
}
