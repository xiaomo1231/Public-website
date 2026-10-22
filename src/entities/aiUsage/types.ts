/**
 * Local AI usage statistics.
 *
 * Every AI response's `usage` block (prompt / completion / cached tokens) is
 * added to a per-month, per-request-kind bucket. The aggregate lives on the AI
 * settings row (`AISettingsRow.usage`) — no extra table — and never holds
 * message content, only counters.
 */

/** What a request was for. Derived from the calling service; default `other`. */
export type AIUsageKind =
  'walkthrough' | 'quiz' | 'analysis' | 'tutor' | 'grading' | 'qa' | 'vocab' | 'other'

export const AI_USAGE_KINDS: readonly AIUsageKind[] = [
  'walkthrough',
  'quiz',
  'analysis',
  'tutor',
  'grading',
  'qa',
  'vocab',
  'other',
] as const

export interface AIUsageBucket {
  /** Responses received (with or without a usage block). */
  requests: number
  promptTokens: number
  completionTokens: number
  /** Prompt tokens served from the provider's prefix cache (when reported). */
  cachedTokens: number
  /** Responses whose provider sent no usage block: their tokens are unknown. */
  missingUsage: number
}

/** `YYYY-MM` (local time) → kind → bucket. */
export interface AIUsageStore {
  months: Record<string, Partial<Record<AIUsageKind, AIUsageBucket>>>
}

/** One response's token counts, as parsed from the provider. */
export interface AIUsageSample {
  promptTokens: number
  completionTokens: number
  cachedTokens?: number
}

/** Optional prices the user enters to estimate spend for providers without a balance API. */
export interface AIUsagePrices {
  /** Price per 1M prompt (input) tokens. */
  inputPerMillion: number
  /** Price per 1M completion (output) tokens. */
  outputPerMillion: number
  /** Price per 1M cached input tokens; falls back to `inputPerMillion`. */
  cachedInputPerMillion?: number
  currency: 'CNY' | 'USD'
}

/** Months kept; older buckets are pruned on write. */
export const USAGE_MONTHS_KEPT = 13

export function isAIUsageKind(value: unknown): value is AIUsageKind {
  return typeof value === 'string' && (AI_USAGE_KINDS as readonly string[]).includes(value)
}

export function monthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function previousMonthKey(date: Date = new Date()): string {
  return monthKey(new Date(date.getFullYear(), date.getMonth() - 1, 1))
}

export function emptyBucket(): AIUsageBucket {
  return { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, missingUsage: 0 }
}

function count(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * Add one response to the store (pure). A response without usage still counts
 * as a request and is tallied in `missingUsage`, so "unknown" is visible
 * instead of silently reading as zero tokens.
 */
export function addUsage(
  store: AIUsageStore | undefined,
  kind: AIUsageKind,
  sample: AIUsageSample | undefined,
  at: Date = new Date(),
): AIUsageStore {
  const key = monthKey(at)
  const months = { ...(store?.months ?? {}) }
  const month = { ...(months[key] ?? {}) }
  const bucket = { ...emptyBucket(), ...(month[kind] ?? {}) }
  bucket.requests += 1
  if (sample) {
    bucket.promptTokens += count(sample.promptTokens)
    bucket.completionTokens += count(sample.completionTokens)
    bucket.cachedTokens += count(sample.cachedTokens)
  } else {
    bucket.missingUsage += 1
  }
  month[kind] = bucket
  months[key] = month
  return { months: pruneMonths(months) }
}

function pruneMonths(months: AIUsageStore['months']): AIUsageStore['months'] {
  const keys = Object.keys(months).sort()
  if (keys.length <= USAGE_MONTHS_KEPT) return months
  const kept: AIUsageStore['months'] = {}
  for (const key of keys.slice(-USAGE_MONTHS_KEPT)) kept[key] = months[key]!
  return kept
}

/** Per-kind buckets of one month, every kind present (zeros when unused). */
export function monthBreakdown(
  store: AIUsageStore | undefined,
  key: string,
): Record<AIUsageKind, AIUsageBucket> {
  const month = store?.months[key] ?? {}
  const out = {} as Record<AIUsageKind, AIUsageBucket>
  for (const kind of AI_USAGE_KINDS) out[kind] = { ...emptyBucket(), ...(month[kind] ?? {}) }
  return out
}

export function sumBuckets(buckets: Iterable<AIUsageBucket>): AIUsageBucket {
  const total = emptyBucket()
  for (const b of buckets) {
    total.requests += b.requests
    total.promptTokens += b.promptTokens
    total.completionTokens += b.completionTokens
    total.cachedTokens += b.cachedTokens
    total.missingUsage += b.missingUsage
  }
  return total
}

export function monthTotal(store: AIUsageStore | undefined, key: string): AIUsageBucket {
  return sumBuckets(Object.values(monthBreakdown(store, key)))
}

/** Valid, non-zero prices or `null`. */
export function normalizePrices(prices: unknown): AIUsagePrices | null {
  if (!prices || typeof prices !== 'object') return null
  const p = prices as Record<string, unknown>
  const num = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  const input = num(p.inputPerMillion)
  const output = num(p.outputPerMillion)
  if (input === 0 && output === 0) return null
  const cached =
    p.cachedInputPerMillion === undefined || p.cachedInputPerMillion === ''
      ? undefined
      : num(p.cachedInputPerMillion)
  return {
    inputPerMillion: input,
    outputPerMillion: output,
    ...(cached !== undefined ? { cachedInputPerMillion: cached } : {}),
    currency: p.currency === 'USD' ? 'USD' : 'CNY',
  }
}

/**
 * Estimated cost of a bucket at the user's prices. Cached prompt tokens use
 * the cached price when one is given. This is an estimate, never a bill.
 */
export function estimateCost(bucket: AIUsageBucket, prices: AIUsagePrices): number {
  const cached = Math.min(bucket.cachedTokens, bucket.promptTokens)
  const fresh = bucket.promptTokens - cached
  const cachedPrice = prices.cachedInputPerMillion ?? prices.inputPerMillion
  return (
    (fresh * prices.inputPerMillion +
      cached * cachedPrice +
      bucket.completionTokens * prices.outputPerMillion) /
    1_000_000
  )
}
