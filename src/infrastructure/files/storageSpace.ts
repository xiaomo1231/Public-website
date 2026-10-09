import { ValidationError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

/**
 * Uploads are limited by the browser storage left for this origin, not by a
 * fixed size: IndexedDB keeps every file's bytes, so a file only fits when the
 * quota has room for it.
 */

/** Room for what processing derives from a file (chunks, page images). */
const HEADROOM = 1.2

function sizeLabel(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(0.1, mb).toFixed(1)} MB`
}

/** Bytes still free in this origin's quota, or null when the browser cannot tell. */
export async function freeStorageBytes(): Promise<number | null> {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.()
    if (!estimate?.quota) return null
    return Math.max(0, estimate.quota - (estimate.usage ?? 0))
  } catch {
    return null
  }
}

/** Refuse a file the free storage clearly cannot hold; unknown space lets the save decide. */
export async function ensureStorageFor(bytes: number): Promise<void> {
  const free = await freeStorageBytes()
  if (free === null || bytes * HEADROOM <= free) return
  throw new ValidationError(t('errors.storageInsufficient', { size: sizeLabel(bytes), free: sizeLabel(free) }))
}

/** IndexedDB ran out of quota (Dexie wraps the DOMException, keeping its name). */
export function isQuotaError(err: unknown): boolean {
  const names = [err, (err as { inner?: unknown } | null)?.inner].map((e) => (e as { name?: unknown } | null)?.name)
  return names.includes('QuotaExceededError')
}
