import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { SettingsService } from '@/services/settingsService'
import { AIService } from '@/services/aiService'
import {
  FALLBACK_OUTPUT_TOKENS,
  modelOutputLimit,
  resolveOutputLimit,
} from '@/infrastructure/ai/outputLimit'
import { parseModelOutputLimits } from '@/infrastructure/ai/models'
import { knownModelOutputLimit } from '@/infrastructure/ai/presets'
import { OutputTruncatedError } from '@/infrastructure/ai/errors'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { DEFAULT_AI_SETTINGS } from '@/entities/settings/types'
import type { ProviderConfig } from '@/infrastructure/ai/types'
import { t } from '@/i18n'

describe('model output limit', () => {
  it('reads output fields from /models metadata, never the context length', () => {
    expect(
      parseModelOutputLimits({
        data: [
          { id: 'a', max_output_tokens: 65_536, context_length: 1_000_000 },
          { id: 'b', max_completion_tokens: '32768' },
          { id: 'c', top_provider: { max_completion_tokens: 20_000, context_length: 200_000 } },
          { id: 'd', context_length: 1_000_000 },
          { id: 'e', max_output_tokens: 0 },
        ],
      }),
    ).toEqual({ a: 65_536, b: 32_768, c: 20_000 })
    expect(parseModelOutputLimits(null)).toEqual({})
  })

  it('prefers metadata, then the documented table, else nothing', () => {
    expect(modelOutputLimit('gpt-4o', { 'gpt-4o': 12_000 })).toEqual({
      limit: 12_000,
      source: 'metadata',
    })
    expect(modelOutputLimit('GPT-4o-mini')).toEqual({ limit: 16_384, source: 'table' })
    expect(knownModelOutputLimit('MiniMax-M3')).toBeUndefined()
    expect(knownModelOutputLimit('constructor')).toBeUndefined()
    expect(modelOutputLimit('MiniMax-M3', { other: 9 })).toBeUndefined()
  })

  it('resolves the cap per mode', () => {
    // 使用模型允许的最大值: the model's limit when known…
    expect(resolveOutputLimit({ mode: 'model', manualMaxTokens: 4096, model: 'gpt-4o' })).toEqual({
      maxTokens: 16_384,
      modelMax: 16_384,
      source: 'table',
    })
    // …else the manual number (or the fallback when that is invalid).
    expect(
      resolveOutputLimit({ mode: 'model', manualMaxTokens: 32_000, model: 'MiniMax-M3' }),
    ).toEqual({ maxTokens: 32_000, source: 'manual' })
    expect(resolveOutputLimit({ mode: 'model', manualMaxTokens: NaN, model: 'x' }).maxTokens).toBe(
      FALLBACK_OUTPUT_TOKENS,
    )
    // Manual: the number, never above a known model limit.
    expect(
      resolveOutputLimit({ mode: 'manual', manualMaxTokens: 100_000, model: 'gpt-4-turbo' }),
    ).toEqual({ maxTokens: 4_096, modelMax: 4_096, source: 'manual' })
    expect(
      resolveOutputLimit({
        mode: 'manual',
        manualMaxTokens: 2_000,
        model: 'm',
        metadata: { m: 64_000 },
      }),
    ).toEqual({ maxTokens: 2_000, modelMax: 64_000, source: 'manual' })
  })
})

describe('requests never exceed the model limit', () => {
  const originalFetch = globalThis.fetch
  let bodies: Array<{ max_tokens: number }>

  beforeEach(() => {
    bodies = []
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string))
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }], model: 'm' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const config = (patch: Partial<ProviderConfig>): ProviderConfig => ({
    provider: 'custom',
    baseURL: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'm',
    temperature: 0.2,
    maxTokens: 100_000,
    ...patch,
  })

  it('clamps explicit and default budgets to the model limit', async () => {
    const ai = new AIService({
      config: config({ maxTokensMode: 'manual', modelOutputLimits: { m: 8_000 } }),
    })
    expect(ai.maxOutputTokens).toBe(8_000)
    expect(ai.modelMaxOutputTokens).toBe(8_000)
    await ai.chat([{ role: 'user', content: 'hi' }], { maxTokens: 50_000 })
    await ai.chat([{ role: 'user', content: 'hi' }])
    expect(bodies.map((body) => body.max_tokens)).toEqual([8_000, 8_000])
  })

  it('model mode sends the model limit; always sends a limit', async () => {
    const ai = new AIService({ config: config({ maxTokensMode: 'model', model: 'gpt-4o' }) })
    expect(ai.maxOutputTokens).toBe(16_384)
    await ai.chat([{ role: 'user', content: 'hi' }])
    expect(bodies[0]!.max_tokens).toBe(16_384)
    // Unknown model: the manual number, still sent.
    const unknown = new AIService({ config: config({ maxTokensMode: 'model', maxTokens: 9_000 }) })
    await unknown.chat([{ role: 'user', content: 'hi' }])
    expect(bodies[1]!.max_tokens).toBe(9_000)
  })

  it('a config without a mode keeps its number', () => {
    expect(new AIService({ config: config({ maxTokens: 3_000 }) }).maxOutputTokens).toBe(3_000)
  })
})

describe('max tokens setting', () => {
  let db: AppDatabase
  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('new installs use the model maximum; the mode and number persist', async () => {
    expect(DEFAULT_AI_SETTINGS.maxTokensMode).toBe('model')
    const svc = new SettingsService(db)
    expect((await svc.get()).maxTokensMode).toBe('model')
    await svc.update({ maxTokensMode: 'manual', maxTokens: 128_000 })
    const saved = await new SettingsService(db).get()
    expect(saved).toMatchObject({ maxTokensMode: 'manual', maxTokens: 128_000 })
    await expect(svc.update({ maxTokens: 128_001 })).rejects.toThrow()
    await expect(svc.update({ maxTokens: 63 })).rejects.toThrow()
  })

  it('an existing row without a mode keeps its number (manual)', async () => {
    await db.settings.put({
      ...DEFAULT_AI_SETTINGS,
      maxTokens: 32_000,
      maxTokensMode: undefined,
      updatedAt: 1,
    })
    expect(await new SettingsService(db).get()).toMatchObject({
      maxTokensMode: 'manual',
      maxTokens: 32_000,
    })
  })

  it('remembers /models limits for the base URL they came from', async () => {
    const svc = new SettingsService(db)
    await svc.update({ baseURL: 'https://api.a.com/v1' })
    await svc.rememberModelOutputLimits('https://api.a.com/v1', { m: 64_000, bad: -1 })
    expect((await svc.get()).modelOutputLimits).toEqual({ m: 64_000 })
    // Another base URL: those limits describe other models.
    await svc.update({ baseURL: 'https://api.b.com/v1' })
    expect((await svc.get()).modelOutputLimits).toEqual({})
  })
})

describe('truncation at the cap', () => {
  it('names the model limit, or the setting', () => {
    expect(friendlyAIError(new OutputTruncatedError(8192, { limit: 8192, by: 'model' }))).toBe(
      t('friendlyError.outputTruncatedModelMax', { limit: 8192 }),
    )
    expect(friendlyAIError(new OutputTruncatedError(8192, { limit: 8192, by: 'setting' }))).toBe(
      t('friendlyError.outputTruncatedSettingMax', { limit: 8192 }),
    )
    expect(friendlyAIError(new OutputTruncatedError(8192))).toBe(t('friendlyError.outputTruncated'))
  })
})
