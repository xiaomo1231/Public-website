import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { getDb, setDbForTesting } from '@/infrastructure/db/database'
import { clearCachedDeviceKey } from '@/infrastructure/crypto/deviceKey'
import { resetUILanguageForTesting } from '@/i18n/store'

;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()

// jsdom does not implement ResizeObserver, which Radix primitives (Slider,
// Select, …) use for layout measurement. A no-op stub is enough for tests.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
}

// jsdom 25's Blob.prototype.arrayBuffer and .text are stubs that return
// an empty buffer / empty string regardless of the underlying data.
// Override both via FileReader so test behaviour matches real browsers.
const BlobProto = Blob.prototype as unknown as Record<string, unknown>
Object.defineProperty(BlobProto, 'arrayBuffer', {
  configurable: true,
  value(this: unknown) {
    const blob = this as Blob
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
      reader.readAsArrayBuffer(blob)
    })
  },
})
Object.defineProperty(BlobProto, 'text', {
  configurable: true,
  value(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
      reader.readAsText(this)
    })
  },
})

beforeEach(async () => {
  // UI language is a module-level singleton; reset it so a test that switches
  // language cannot leak into the next one.
  resetUILanguageForTesting()
  // The device key is cached in module memory; the database is wiped below,
  // so the cache must be dropped too or tests would reuse a key that no
  // longer exists in storage.
  clearCachedDeviceKey()
  setDbForTesting(null)
  const db = getDb()
  try {
    await db.delete()
  } catch {
    /* first test, db may not be open */
  }
  setDbForTesting(null)
})

afterEach(() => {
  cleanup()
})