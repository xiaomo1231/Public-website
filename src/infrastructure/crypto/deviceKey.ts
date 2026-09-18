import { getDb } from '../db/database'
import { generateDeviceKey, isEncryptionAvailable } from './crypto'
import { logger } from '../logger/logger'
import { AppError } from '../errors/AppError'

export interface CryptoKeyRow {
  id: string
  key: CryptoKey
  createdAt: number
}

/** Single row holding the app's device key. */
const DEVICE_KEY_ID = 'device-key'

let cached: CryptoKey | null = null
let inflight: Promise<CryptoKey> | null = null

/**
 * Load (or create) the device key used to encrypt local secrets at rest.
 *
 * ## Security boundary
 *
 * The key is a **non-extractable** AES-GCM `CryptoKey` kept in IndexedDB.
 * Its raw bytes never exist as a JavaScript value, so they cannot be logged,
 * serialised, put in a URL, or copied out of the browser.
 *
 * This protects against:
 *   - plaintext secrets sitting in IndexedDB / a disk image / a browser backup
 *   - secrets leaking into logs, error messages, telemetry, or exports
 *   - secrets being scraped from the origin's storage by another application
 *
 * It does **not** protect against script executing on this same origin (XSS or
 * a malicious dependency): such script can call `crypto.subtle.decrypt` with
 * this key. That is an inherent limit of a purely client-side app — stronger
 * protection requires an independent user secret (e.g. a passphrase-derived
 * key), which is not implemented.
 */
export async function getDeviceKey(): Promise<CryptoKey> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = loadOrCreate()
  try {
    cached = await inflight
    return cached
  } finally {
    inflight = null
  }
}

async function loadOrCreate(): Promise<CryptoKey> {
  if (!isEncryptionAvailable()) {
    throw new AppError('Web Crypto is unavailable; cannot store secrets securely', 'CRYPTO_UNAVAILABLE')
  }
  const db = getDb()
  const existing = await db.cryptoKeys.get(DEVICE_KEY_ID)
  if (existing?.key) return existing.key

  const key = await generateDeviceKey()
  await db.cryptoKeys.put({ id: DEVICE_KEY_ID, key, createdAt: Date.now() })
  logger.info('Generated device encryption key')
  return key
}

/** Drop the in-memory key. The stored key is left intact. */
export function clearCachedDeviceKey(): void {
  cached = null
  inflight = null
}

/** Delete the device key entirely. Anything encrypted with it becomes unreadable. */
export async function destroyDeviceKey(): Promise<void> {
  clearCachedDeviceKey()
  await getDb().cryptoKeys.delete(DEVICE_KEY_ID)
  logger.warn('Device encryption key destroyed')
}
