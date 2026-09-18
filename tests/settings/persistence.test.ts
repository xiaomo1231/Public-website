import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { SettingsService } from '@/services/settingsService'
import { clearCachedDeviceKey } from '@/infrastructure/crypto/deviceKey'

/**
 * DIAGNOSTIC — does an AI provider configuration survive a reload?
 *
 * A "reload" is modelled as a fresh database handle plus a cold device-key
 * cache, which is exactly what the browser gives us after F5.
 */

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  clearCachedDeviceKey()
})

/** Simulate a page reload: new handle, cold in-memory caches. */
function reload(): AppDatabase {
  const fresh = new AppDatabase()
  setDbForTesting(fresh)
  clearCachedDeviceKey()
  return fresh
}

describe('AI settings persistence', () => {
  it('restores every field after a reload', async () => {
    await new SettingsService(db).update({
      provider: 'MiniMax',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test-1234567890',
      model: 'MiniMax-M3',
      temperature: 0.4,
      maxTokens: 4096,
    })

    const restored = await new SettingsService(reload()).get()

    expect(restored.provider).toBe('MiniMax')
    expect(restored.baseURL).toBe('https://api.example.com/v1')
    expect(restored.model).toBe('MiniMax-M3')
    expect(restored.temperature).toBe(0.4)
    expect(restored.maxTokens).toBe(4096)
    expect(restored.apiKey).toBe('sk-test-1234567890')
  })

  it('stores the API key encrypted, never as plaintext', async () => {
    await new SettingsService(db).update({ apiKey: 'sk-test-plaintext-check' })

    const raw = await db.settings.get('singleton')
    expect(raw?.apiKeyEncrypted).toBeTruthy()
    expect(raw?.apiKey).toBeUndefined()
    expect(JSON.stringify(raw)).not.toContain('sk-test-plaintext-check')
  })

  it('survives saving twice without retyping the key', async () => {
    const svc = new SettingsService(db)
    await svc.update({ apiKey: 'sk-test-stable-key', model: 'model-a' })

    // Second save carries the decrypted key back, as the Settings page does.
    const current = await new SettingsService(reload()).get()
    await new SettingsService(db).update({ ...current, model: 'model-b' })

    const restored = await new SettingsService(reload()).get()
    expect(restored.apiKey).toBe('sk-test-stable-key')
    expect(restored.model).toBe('model-b')
  })

  it('keeps the key when the device key is cached across a reload', async () => {
    await new SettingsService(db).update({ apiKey: 'sk-test-cached' })

    // A reload that does NOT clear the device-key cache (same JS context).
    const fresh = new AppDatabase()
    setDbForTesting(fresh)

    expect((await new SettingsService(fresh).get()).apiKey).toBe('sk-test-cached')
  })

  it('reports an empty key (not a crash) when the device key is lost', async () => {
    await new SettingsService(db).update({ apiKey: 'sk-test-orphan' })

    // Wipe the device key only — the ciphertext stays behind.
    await db.cryptoKeys.clear()
    clearCachedDeviceKey()

    const restored = await new SettingsService(reload()).get()
    expect(restored.apiKey).toBe('')
    expect(restored.baseURL).toBeTruthy()
  })

  it('the database name is stable across instances', () => {
    expect(new AppDatabase().name).toBe('ai-learning-platform')
    expect(new AppDatabase().name).toBe(db.name)
  })
})
