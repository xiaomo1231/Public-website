/**
 * Crypto utilities backed by the Web Crypto API.
 *
 * We never implement cryptographic primitives ourselves — everything here is
 * a thin wrapper over `crypto.subtle` (AES-GCM, SHA-256) plus base64 helpers.
 */

import { AppError } from '../errors/AppError'

const AES_GCM = 'AES-GCM'
/** 96-bit IV is the AES-GCM recommendation and is generated per encryption. */
const IV_BYTES = 12

export function randomId(length = 16): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** UUID v4 using Web Crypto. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** True when the runtime exposes the Web Crypto subtle API (secure contexts). */
export function isEncryptionAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle?.encrypt === 'function'
}

/**
 * Generate a non-extractable AES-GCM key.
 *
 * `extractable: false` means the raw key bytes can never be read back out of
 * the crypto subsystem — they cannot be logged, serialised, or exfiltrated as
 * a string, even by script running on this origin.
 */
export async function generateDeviceKey(): Promise<CryptoKey> {
  if (!isEncryptionAvailable()) {
    throw new AppError('Web Crypto is unavailable in this context', 'CRYPTO_UNAVAILABLE')
  }
  return crypto.subtle.generateKey({ name: AES_GCM, length: 256 }, false, ['encrypt', 'decrypt'])
}

/**
 * Encrypt a UTF-8 string. Returns `base64(iv).base64(ciphertext)`.
 * A fresh random IV is used for every call.
 */
export async function encryptString(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const data = new TextEncoder().encode(plaintext)
  const cipher = await crypto.subtle.encrypt({ name: AES_GCM, iv }, key, data)
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`
}

/** Decrypt a payload produced by {@link encryptString}. */
export async function decryptString(key: CryptoKey, payload: string): Promise<string> {
  const separator = payload.indexOf('.')
  if (separator <= 0) {
    throw new AppError('Stored ciphertext is malformed', 'CRYPTO_MALFORMED')
  }
  const iv = fromBase64(payload.slice(0, separator))
  const cipher = fromBase64(payload.slice(separator + 1))
  if (iv.length !== IV_BYTES || cipher.length === 0) {
    throw new AppError('Stored ciphertext is malformed', 'CRYPTO_MALFORMED')
  }
  try {
    const plain = await crypto.subtle.decrypt({ name: AES_GCM, iv }, key, cipher)
    return new TextDecoder().decode(plain)
  } catch (err) {
    // Never include the payload or the key in the message.
    throw new AppError('Could not decrypt stored value', 'CRYPTO_DECRYPT_FAILED', err)
  }
}

/** Looks like an `iv.ciphertext` payload rather than a raw secret. */
export function isEncryptedPayload(value: string): boolean {
  const separator = value.indexOf('.')
  if (separator <= 0) return false
  try {
    const iv = fromBase64(value.slice(0, separator))
    const cipher = fromBase64(value.slice(separator + 1))
    return iv.length === IV_BYTES && cipher.length > 0
  } catch {
    return false
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
