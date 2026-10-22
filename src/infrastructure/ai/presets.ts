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
  /**
   * The provider's models think before answering and the endpoint has
   * switches for it (see `ReasoningProfile`). Absent: plain chat models.
   */
  reasoning?: ReasoningProfile
}

/**
 * How a preset talks to models that think before answering. Every field is
 * a wire-level switch; the business services only ever say "this task needs
 * little reasoning" (`ChatRequest.reasoning: 'low'`).
 */
export interface ReasoningProfile {
  /**
   * Send `reasoning_split: true`, so the thinking arrives in
   * `reasoning_content` apart from the answer instead of as `<think>` text.
   */
  split: boolean
  /** The output-cap parameter the provider documents as current. */
  outputParam: 'max_tokens' | 'max_completion_tokens'
  /** Leave `temperature` out (the endpoint fixes it for these models). */
  omitTemperature: boolean
  /** Output budget of the connection test (thinking needs room before "pong"). */
  testMaxTokens: number
  /**
   * Body fields that make `model` think less, for formatting-only tasks;
   * undefined when the model has no such switch.
   */
  lowEffort?: (model: string) => Record<string, unknown> | undefined
}

/** MiniMax international and mainland-China endpoints (official docs, 2026-10). */
export const MINIMAX_BASE_URL_INTL = 'https://api.minimax.io/v1'
export const MINIMAX_BASE_URL_CN = 'https://api.minimax.cn/v1'

/**
 * MiniMax thinking switches (OpenAI-compatible API docs, 2026-10):
 * MiniMax-M3 can turn thinking off (`thinking: {type: 'disabled'}`);
 * MiniMax-M3.1-Flash cannot (400, code 2013) but takes
 * `reasoning_effort: 'low'`; M2.x can do neither.
 */
export function miniMaxLowEffort(model: string): Record<string, unknown> | undefined {
  const id = model.trim().toLowerCase()
  if (/^minimax-m3\.1-flash\b/.test(id)) return { reasoning_effort: 'low' }
  if (/^minimax-m3(?![.\d])/.test(id)) return { thinking: { type: 'disabled' } }
  return undefined
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
    baseURL: MINIMAX_BASE_URL_INTL,
    // M3: the flagship (1M context) and the one model whose thinking can be
    // turned off for formatting-only tasks.
    defaultModel: 'MiniMax-M3',
    models: ['MiniMax-M3', 'MiniMax-M3.1-Flash', 'MiniMax-M2.7', 'MiniMax-M2.5'],
    // `json_object` is not documented for the current models.
    supportsJsonMode: false,
    streamUsage: true,
    reasoning: {
      split: true,
      // `max_tokens` is legacy; thinking counts toward either.
      outputParam: 'max_completion_tokens',
      // The OpenAI-compatible endpoint fixes temperature / top_p for M3.
      omitTemperature: true,
      testMaxTokens: 512,
      lowEffort: miniMaxLowEffort,
    },
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
    ...(preset.reasoning ? { reasoning: preset.reasoning } : {}),
  })
}
