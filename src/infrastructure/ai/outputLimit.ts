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
/**
 * 使用模型允许的最大值 with the model's limit unknown (not in `/models`, not in
 * the documented table, not learned yet): requests start from this generous
 * cap. A provider that rejects it as too large teaches the real limit
 * (`AIService` reads it from the error, or halves) and it is remembered.
 */
export const PROBE_OUTPUT_TOKENS = 65_536
/** Probing never goes below this (a smaller rejection is not a size problem). */
export const PROBE_MIN_OUTPUT_TOKENS = 1_024

/**
 * `metadata` / `table` / `learned` — the model's own limit (from `/models`, the
 * documented table, or learned from a provider rejection); `probe` — model
 * mode with the limit still unknown (`PROBE_OUTPUT_TOKENS`); `manual` — the
 * user's number.
 */
export type OutputLimitSource = 'metadata' | 'table' | 'learned' | 'probe' | 'manual'

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

/**
 * Limits learned from provider rejections during this page visit, by base URL
 * and model (also persisted in the settings row by the installed sink), so an
 * AI service built before the settings were re-read already uses them.
 */
const learnedThisVisit = new Map<string, number>()
const learnedKey = (baseURL: string, model: string): string =>
  `${baseURL.trim().replace(/\/+$/, '')}|${model.trim()}`

export type LearnedOutputLimitSink = (baseURL: string, model: string, limit: number) => void
let learnedSink: LearnedOutputLimitSink | null = null

/** Installed once at app start (persists learned limits in the settings row). */
export function setLearnedOutputLimitSink(sink: LearnedOutputLimitSink | null): void {
  learnedSink = sink
}

/** Remember a model's output limit learned from a provider rejection. */
export function rememberLearnedOutputLimit(baseURL: string, model: string, limit: number): void {
  const value = positive(limit)
  if (!value || !model.trim()) return
  learnedThisVisit.set(learnedKey(baseURL, model), value)
  try {
    learnedSink?.(baseURL, model, value)
  } catch {
    /* persisting is best-effort; the limit is still used this visit */
  }
}

export function learnedOutputLimit(baseURL: string, model: string): number | undefined {
  return learnedThisVisit.get(learnedKey(baseURL, model))
}

/** Tests only. */
export function clearLearnedOutputLimitsForTesting(): void {
  learnedThisVisit.clear()
}

/**
 * The output limit a provider states in its rejection (`max_tokens must be
 * <= 40960`, `range [1, 8192]`, `maximum allowed is 32768`…): the largest
 * number in the text below the budget that was rejected, or undefined.
 */
export function parseOutputLimitFromText(text: string, rejected?: number): number | undefined {
  const numbers = [...text.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').matchAll(/\d{3,7}/g)]
    .map((match) => Number(match[0]))
    .filter(
      (value) => value >= PROBE_MIN_OUTPUT_TOKENS && (rejected === undefined || value < rejected),
    )
  return numbers.length > 0 ? Math.max(...numbers) : undefined
}

/**
 * The model's own output limit: learned from a rejection first (evidence from
 * this very endpoint), then `/models` metadata, then the documented table.
 */
export function modelOutputLimit(
  model: string,
  metadata?: Readonly<Record<string, number>>,
  learned?: Readonly<Record<string, number>>,
): { limit: number; source: 'metadata' | 'table' | 'learned' } | undefined {
  const id = model.trim()
  const fromLearned =
    id && learned && Object.prototype.hasOwnProperty.call(learned, id)
      ? positive(learned[id])
      : undefined
  if (fromLearned) return { limit: fromLearned, source: 'learned' }
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
  learned?: Readonly<Record<string, number>>
}): ResolvedOutputLimit {
  const manual = positive(input.manualMaxTokens) ?? FALLBACK_OUTPUT_TOKENS
  const known = modelOutputLimit(input.model, input.metadata, input.learned)
  if (!known) {
    // Model mode never falls back to the manual number: it probes instead.
    return input.mode === 'model'
      ? { maxTokens: PROBE_OUTPUT_TOKENS, source: 'probe' }
      : { maxTokens: manual, source: 'manual' }
  }
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
    baseURL?: string
    maxTokens: number
    maxTokensMode?: MaxTokensMode
    modelOutputLimits?: Record<string, number>
    learnedOutputLimits?: Record<string, number>
    modelMaxOutputTokens?: number
  },
>(config: T): T & { outputLimit: ResolvedOutputLimit } {
  const visit = learnedOutputLimit(config.baseURL ?? '', config.model)
  const learned = {
    ...config.learnedOutputLimits,
    ...(visit !== undefined ? { [config.model.trim()]: visit } : {}),
  }
  const resolved = resolveOutputLimit({
    mode: config.maxTokensMode ?? 'manual',
    manualMaxTokens: config.maxTokens,
    model: config.model,
    ...(config.modelOutputLimits ? { metadata: config.modelOutputLimits } : {}),
    learned,
  })
  const next = { ...config, maxTokens: resolved.maxTokens, outputLimit: resolved }
  if (resolved.modelMax !== undefined) next.modelMaxOutputTokens = resolved.modelMax
  else delete next.modelMaxOutputTokens
  return next
}
