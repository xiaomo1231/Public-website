import { type AIProviderId } from '@/entities/settings/types'
import { OpenAICompatibleProvider } from './openaiCompatible'
import type { AIProvider, ProviderConfig } from './types'

export interface ProviderPresetInfo {
  id: AIProviderId
  label: string
  baseURL: string
  defaultModel: string
  models: string[]
  supportsJsonMode: boolean
  /**
   * The provider documents `stream_options.include_usage`, so streamed
   * responses can report token usage. Off for presets where it is unverified.
   */
  streamUsage?: boolean
}

/**
 * Built-in presets. The `id` of each preset must match
 * `entities/settings/types.ts` so the existing Settings UI can drive the
 * AI provider without further mapping.
 */
export const PROVIDER_PRESETS: ProviderPresetInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    supportsJsonMode: true,
    streamUsage: true,
  },
  {
    id: 'qwen',
    label: 'Qwen (DashScope)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
    supportsJsonMode: true,
    streamUsage: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsJsonMode: false,
    streamUsage: true,
  },
  {
    id: 'MiniMax',
    label: 'MiniMax',
    baseURL: 'https://api.MiniMax.com/v1',
    defaultModel: 'MiniMax-Text-01',
    models: ['MiniMax-Text-01', 'MiniMax-VL-01'],
    supportsJsonMode: true,
  },
  {
    id: 'mimo',
    label: 'MiMo',
    baseURL: 'https://api.mimo.example.com/v1',
    defaultModel: 'mimo-7b',
    models: ['mimo-7b', 'mimo-13b'],
    supportsJsonMode: true,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseURL: '',
    defaultModel: '',
    models: [],
    supportsJsonMode: true,
  },
]

/**
 * Maximum output tokens per request for models whose limit is published in
 * the provider's own documentation (checked 2026-10):
 *  - OpenAI model pages: gpt-4o / gpt-4o-mini 16,384; gpt-4-turbo and
 *    gpt-3.5-turbo 4,096.
 *  - DeepSeek pricing page: deepseek-v4-pro "maximum 384K" (written here as
 *    384,000, the lower reading of "K").
 * Models whose docs give no output limit (MiniMax-M3 / M3.1-Flash, current
 * Qwen and deepseek-flash, legacy deepseek-chat / deepseek-reasoner) are left
 * out on purpose: a guessed value could send a `max_tokens` the provider
 * rejects, or cut answers short. A context length is never used as an output
 * limit. `/models` metadata, when the provider returns it, takes precedence.
 */
export const KNOWN_MODEL_OUTPUT_LIMITS: Readonly<Record<string, number>> = {
  'gpt-4o': 16_384,
  'gpt-4o-mini': 16_384,
  'gpt-4-turbo': 4_096,
  'gpt-3.5-turbo': 4_096,
  'deepseek-v4-pro': 384_000,
}

/** The documented output limit of `model` (exact id, case-insensitive), if known. */
export function knownModelOutputLimit(model: string): number | undefined {
  const id = model.trim().toLowerCase()
  return id && Object.prototype.hasOwnProperty.call(KNOWN_MODEL_OUTPUT_LIMITS, id)
    ? KNOWN_MODEL_OUTPUT_LIMITS[id]
    : undefined
}

export function getPreset(id: AIProviderId): ProviderPresetInfo {
  const found = PROVIDER_PRESETS.find((p) => p.id === id)
  if (!found) {
    throw new Error(`Unknown AI provider preset: ${id}`)
  }
  return found
}

/**
 * Construct an AIProvider from the user's settings. All presets share the
 * OpenAI-compatible implementation; only metadata differs.
 */
export function createProvider(config: ProviderConfig): AIProvider {
  const preset = getPreset(config.provider)
  return new OpenAICompatibleProvider(preset.id, preset.label, config, {
    defaultModel: preset.defaultModel,
    supportsJsonMode: preset.supportsJsonMode,
    streamUsage: preset.streamUsage === true,
  })
}
