/**
 * Defensive coercion helpers for AI structured output.
 *
 * Model output is untrusted: it may be missing fields, use the wrong types,
 * or nest unexpectedly. Every value that reaches business logic or the
 * database passes through one of these first.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function asTrimmedString(value: unknown, fallback = ''): string {
  const text = asString(value, fallback).trim()
  return text || fallback
}

/** Returns null when the value is not a non-empty string. */
export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item): item is string => item.length > 0)
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** Map an unknown array through a normalizer, dropping entries that fail. */
export function asNormalizedArray<T>(
  value: unknown,
  normalize: (item: Record<string, unknown>) => T | null,
  max = 500,
): T[] {
  const out: T[] = []
  for (const item of asArray(value)) {
    const record = asRecord(item)
    if (!record) continue
    const normalized = normalize(record)
    if (normalized === null) continue
    out.push(normalized)
    if (out.length >= max) break
  }
  return out
}
