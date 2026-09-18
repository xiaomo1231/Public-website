import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { SettingsService } from '@/services/settingsService'
import { SettingsRepository } from '@/entities/settings/repository'
import { getDeviceKey } from '@/infrastructure/crypto/deviceKey'
import {
  decryptString,
  encryptString,
  isEncryptedPayload,
} from '@/infrastructure/crypto/crypto'
import { OpenAICompatibleProvider } from '@/infrastructure/ai/openaiCompatible'
import { logger } from '@/infrastructure/logger/logger'
import type { ProviderConfig } from '@/infrastructure/ai/types'

const SECRET = 'sk-must-never-appear-in-plaintext-1234567890'

describe('API key storage', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('persists the key encrypted and never as plaintext', async () => {
    const svc = new SettingsService(db)
    await svc.update({ apiKey: SECRET })

    const row = await db.settings.get('singleton')
    expect(row).toBeDefined()
    // No plaintext field survives.
    expect(row!.apiKey).toBeUndefined()
    expect(row!.apiKeyEncrypted).toBeTruthy()
    // The ciphertext does not contain the secret.
    expect(row!.apiKeyEncrypted).not.toContain(SECRET)
    // Nor does the serialised row.
    expect(JSON.stringify(row)).not.toContain(SECRET)
  })

  it('round-trips the key through encryption', async () => {
    const svc = new SettingsService(db)
    await svc.update({ apiKey: SECRET })
    expect((await svc.get()).apiKey).toBe(SECRET)
  })

  it('uses a non-extractable device key', async () => {
    const key = await getDeviceKey()
    expect(key.extractable).toBe(false)
    // Raw bytes can never be read back out.
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toBeDefined()
  })

  it('uses a fresh IV so identical keys produce different ciphertext', async () => {
    const key = await getDeviceKey()
    const a = await encryptString(key, SECRET)
    const b = await encryptString(key, SECRET)
    expect(a).not.toBe(b)
    expect(await decryptString(key, a)).toBe(SECRET)
    expect(await decryptString(key, b)).toBe(SECRET)
  })

  it('marks its own payloads as encrypted', async () => {
    const key = await getDeviceKey()
    expect(isEncryptedPayload(await encryptString(key, 'x'))).toBe(true)
    expect(isEncryptedPayload('sk-plaintext')).toBe(false)
    expect(isEncryptedPayload('')).toBe(false)
    expect(isEncryptedPayload('not.base64!!')).toBe(false)
  })

  it('clears the key when set to an empty string', async () => {
    const svc = new SettingsService(db)
    await svc.update({ apiKey: SECRET })
    await svc.update({ apiKey: '' })
    const row = await db.settings.get('singleton')
    expect(row!.apiKeyEncrypted).toBeUndefined()
    expect((await svc.get()).apiKey).toBe('')
  })

  it('reports an empty key instead of throwing when the device key is lost', async () => {
    const svc = new SettingsService(db)
    await svc.update({ apiKey: SECRET })
    // Simulate a wiped key store.
    await db.cryptoKeys.clear()
    const { clearCachedDeviceKey } = await import('@/infrastructure/crypto/deviceKey')
    clearCachedDeviceKey()
    // A brand new device key cannot decrypt the old ciphertext.
    expect((await svc.get()).apiKey).toBe('')
  })
})

describe('API key migration from legacy plaintext', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function seedLegacyRow() {
    await db.settings.put({
      id: 'singleton',
      provider: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: SECRET,
      model: 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 1024,
      updatedAt: 1,
    })
  }

  it('keeps the key readable after migrating (no data loss)', async () => {
    await seedLegacyRow()
    const settings = await new SettingsService(db).get()
    expect(settings.apiKey).toBe(SECRET)
    expect(settings.provider).toBe('deepseek')
    expect(settings.baseURL).toBe('https://api.deepseek.com/v1')
    expect(settings.model).toBe('deepseek-chat')
    expect(settings.temperature).toBe(0.3)
    expect(settings.maxTokens).toBe(1024)
  })

  it('removes the plaintext from storage after migrating', async () => {
    await seedLegacyRow()
    await new SettingsService(db).get()
    const row = await db.settings.get('singleton')
    expect(row!.apiKey).toBeUndefined()
    expect(row!.apiKeyEncrypted).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain(SECRET)
  })

  it('is idempotent — a second read does not re-encrypt or fail', async () => {
    await seedLegacyRow()
    const svc = new SettingsService(db)
    await svc.get()
    const first = (await db.settings.get('singleton'))!.apiKeyEncrypted
    await svc.get()
    const second = (await db.settings.get('singleton'))!.apiKeyEncrypted
    expect(second).toBe(first)
    expect((await svc.get()).apiKey).toBe(SECRET)
  })

  it('drops a stale plaintext copy when ciphertext already exists', async () => {
    const key = await getDeviceKey()
    const encrypted = await encryptString(key, SECRET)
    await db.settings.put({
      id: 'singleton',
      provider: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-stale-plaintext',
      apiKeyEncrypted: encrypted,
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 2048,
      updatedAt: 1,
    })
    const settings = await new SettingsService(db).get()
    // The encrypted value wins; the stale plaintext is discarded.
    expect(settings.apiKey).toBe(SECRET)
    const row = await db.settings.get('singleton')
    expect(row!.apiKey).toBeUndefined()
  })

  it('does not migrate when there is no legacy key', async () => {
    const repo = new SettingsRepository(db)
    const row = await repo.getRow()
    expect(row.apiKey).toBeUndefined()
    expect(row.apiKeyEncrypted).toBeUndefined()
  })
})

describe('API key is never logged', () => {
  let db: AppDatabase
  let spies: Array<{ mockRestore: () => void; mock: { calls: unknown[][] } }>

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    spies = [
      vi.spyOn(console, 'debug').mockImplementation(() => undefined) as never,
      vi.spyOn(console, 'info').mockImplementation(() => undefined) as never,
      vi.spyOn(console, 'warn').mockImplementation(() => undefined) as never,
      vi.spyOn(console, 'error').mockImplementation(() => undefined) as never,
    ]
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
  })

  function captured(): string {
    return spies
      .flatMap((s) => s.mock.calls)
      .flat()
      .map((v) => {
        try {
          return JSON.stringify(v)
        } catch {
          return String(v)
        }
      })
      .join(' ')
  }

  it('does not log the key when saving or reading settings', async () => {
    const svc = new SettingsService(db)
    await svc.update({ apiKey: SECRET })
    await svc.get()
    expect(captured()).not.toContain(SECRET)
  })

  it('redacts a key placed directly in log context', () => {
    logger.error('diagnostic', { apiKey: SECRET, model: 'gpt-4o-mini' })
    const output = captured()
    expect(output).not.toContain(SECRET)
    expect(output).toContain('[REDACTED]')
  })

  it('redacts keys nested anywhere in the context', () => {
    logger.error('diagnostic', {
      outer: { inner: { apiKey: SECRET } },
      list: [{ api_key: SECRET }],
    })
    const output = captured()
    expect(output).not.toContain(SECRET)
  })

  it('redacts an encrypted key payload in log context', () => {
    logger.error('diagnostic', { apiKeyEncrypted: 'aaaa.bbbb' })
    expect(captured()).toContain('[REDACTED]')
  })

  it('does not log the key when the AI provider is constructed or used', async () => {
    const config: ProviderConfig = {
      provider: 'openai',
      baseURL: 'https://api.example.com/v1',
      apiKey: SECRET,
      model: 'gpt-test',
      temperature: 0.5,
      maxTokens: 128,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
        defaultModel: 'gpt-test',
        supportsJsonMode: true,
      })
      await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(captured()).not.toContain(SECRET)
  })
})

describe('API key is never placed in a URL', () => {
  it('sends the key only in the Authorization header', async () => {
    const config: ProviderConfig = {
      provider: 'openai',
      baseURL: 'https://api.example.com/v1',
      apiKey: SECRET,
      model: 'gpt-test',
      temperature: 0.5,
      maxTokens: 128,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
        defaultModel: 'gpt-test',
        supportsJsonMode: true,
      })
      await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    } finally {
      globalThis.fetch = originalFetch
    }

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(url).not.toContain(SECRET)
    expect(String(url)).not.toContain('api_key')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`)
    // The key must not leak into the request body either.
    expect(String(init.body)).not.toContain(SECRET)
  })
})
