import { knownModelOutputLimit } from './presets'

/**
 * How the per-request output cap (`max_tokens`) is chosen.
 *
 * `model`  — 使用模型允许的最大值: the model's own output limit, read from the
 *            provider's `/models` metadata, else from the documented table in
 *            `presets.ts`, else the manual number.
 * `manual` — the number the user typed, never above the model's limit when
 *            that limit is known.
 *
 * `max_tokens` is always sent: leaving it out makes some providers fall back
 * to a small default (DeepSeek: 4,096), which would cut long answers short.
 */
export type MaxTokensMode = 'model' | 'manual'

export const MANUAL_MAX_TOKENS_MIN = 64
export const MANUAL_MAX_TOKENS_MAX = 128_000
/** Used when nothing better is known and the manual number is invalid. */
export const FALLBACK_OUTPUT_TOKENS = 8_192

export type OutputLimitSource = 'metadata' | 'table' | 'manual'

export interface ResolvedOutputLimit {
  /** The cap requests use (and never exceed). */
  maxTokens: number
  /** The model's own output limit, when known. */
  modelMax?: number
  /** Where `maxTokens` came from. */
  source: OutputLimitSource
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

/** The model's own output limit: `/models` metadata first, then the documented table. */
export function modelOutputLimit(
  model: string,
  metadata?: Readonly<Record<string, number>>,
): { limit: number; source: 'metadata' | 'table' } | undefined {
  const id = model.trim()
  const fromMetadata =
    id && metadata && Object.prototype.hasOwnProperty.call(metadata, id)
      ? positive(metadata[id])
      : undefined
  if (fromMetadata) return { limit: fromMetadata, source: 'metadata' }
  const fromTable = knownModelOutputLimit(id)
  return fromTable ? { limit: fromTable, source: 'table' } : undefined
}

export function resolveOutputLimit(input: {
  mode?: MaxTokensMode
  manualMaxTokens: number
  model: string
  metadata?: Readonly<Record<string, number>>
}): ResolvedOutputLimit {
  const manual = positive(input.manualMaxTokens) ?? FALLBACK_OUTPUT_TOKENS
  const known = modelOutputLimit(input.model, input.metadata)
  if (!known) return { maxTokens: manual, source: 'manual' }
  if (input.mode === 'model')
    return { maxTokens: known.limit, modelMax: known.limit, source: known.source }
  return { maxTokens: Math.min(manual, known.limit), modelMax: known.limit, source: 'manual' }
}

/** A requested budget, never above the model's own limit. */
export function clampOutputTokens(requested: number, modelMax: number | undefined): number {
  return modelMax !== undefined && requested > modelMax ? modelMax : requested
}

/**
 * The provider configuration requests actually use: `maxTokens` replaced by
 * the resolved cap and `modelMaxOutputTokens` set when the model's own limit
 * is known. A configuration without `maxTokensMode` keeps its number (only
 * lowered to a known model limit).
 */
export function resolveProviderConfig<
  T extends {
    model: string
    maxTokens: number
    maxTokensMode?: MaxTokensMode
    modelOutputLimits?: Record<string, number>
    modelMaxOutputTokens?: number
  },
>(config: T): T & { outputLimit: ResolvedOutputLimit } {
  const resolved = resolveOutputLimit({
    mode: config.maxTokensMode ?? 'manual',
    manualMaxTokens: config.maxTokens,
    model: config.model,
    ...(config.modelOutputLimits ? { metadata: config.modelOutputLimits } : {}),
  })
  const next = { ...config, maxTokens: resolved.maxTokens, outputLimit: resolved }
  if (resolved.modelMax !== undefined) next.modelMaxOutputTokens = resolved.modelMax
  else delete next.modelMaxOutputTokens
  return next
}
