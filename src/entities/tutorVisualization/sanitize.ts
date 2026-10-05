import { stripThinkBlocks } from '@/infrastructure/ai/responseText'
import { VISUALIZATION_LIMITS } from './limits'

/** Shared parsing helpers for untrusted visualization drafts. */

const MAX_MAGNITUDE = VISUALIZATION_LIMITS.maxMagnitude

export function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = stripThinkBlocks(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, maxLength)
}

export function readNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= MAX_MAGNITUDE ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && Math.abs(parsed) <= MAX_MAGNITUDE ? parsed : null
  }
  return null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}
