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
  },
  {
    id: 'qwen',
    label: 'Qwen (DashScope)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
    supportsJsonMode: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsJsonMode: false,
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
  })
}