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

// jsdom has no canvas backend: its getContext() prints a "Not implemented"
// error for every call. Return null — what a browser returns for an
// unsupported context — so callers (smiles-drawer, text measuring) take
// their existing no-canvas fallback quietly.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  writable: true,
  value: () => null,
})

// floating-ui (Radix menus / popovers / tooltips) probes `:popover-open` and
// `:modal` on every ancestor while positioning. jsdom's selector engine
// (nwsapi) evaluates those pseudo-classes pathologically slowly — one
// dropdown open took ~20 s. jsdom has no top layer, so answer `false`
// directly, exactly what a browser says for an element that is not in it.
const nativeMatches = Element.prototype.matches
Object.defineProperty(Element.prototype, 'matches', {
  configurable: true,
  writable: true,
  value(this: Element, selector: string): boolean {
    if (selector === ':popover-open' || selector === ':modal') return false
    return nativeMatches.call(this, selector)
  },
})

// React Router v6 prints a "Future Flag Warning" from every test router.
// They are about the future v7 upgrade, not test behaviour, so drop them.
const nativeWarn = console.warn.bind(console)
console.warn = (...args: unknown[]): void => {
  if (typeof args[0] === 'string' && args[0].includes('React Router Future Flag Warning')) return
  nativeWarn(...args)
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