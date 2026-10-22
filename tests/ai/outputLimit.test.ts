import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { SettingsService } from '@/services/settingsService'
import { AIService } from '@/services/aiService'
import {
  clearLearnedOutputLimitsForTesting,
  FALLBACK_OUTPUT_TOKENS,
  learnedOutputLimit,
  modelOutputLimit,
  parseOutputLimitFromText,
  PROBE_OUTPUT_TOKENS,
  resolveOutputLimit,
  setLearnedOutputLimitSink,
} from '@/infrastructure/ai/outputLimit'
import { parseModelOutputLimits } from '@/infrastructure/ai/models'
import { knownModelOutputLimit } from '@/infrastructure/ai/presets'
import {
  errorFromStatus,
  OutputTruncatedError,
  parseRetryAfter,
  RateLimitedError,
} from '@/infrastructure/ai/errors'
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
    // …else a generous cap to probe from (never the manual number).
    expect(
      resolveOutputLimit({ mode: 'model', manualMaxTokens: 32_000, model: 'MiniMax-M3' }),
    ).toEqual({ maxTokens: PROBE_OUTPUT_TOKENS, source: 'probe' })
    // A learned limit (自动探测) counts as the model's own.
    expect(
      resolveOutputLimit({
        mode: 'model',
        manualMaxTokens: 8_192,
        model: 'MiniMax-M3',
        learned: { 'MiniMax-M3': 40_960 },
      }),
    ).toEqual({ maxTokens: 40_960, modelMax: 40_960, source: 'learned' })
    // Manual mode with an unknown limit: the number (or the fallback when invalid).
    expect(resolveOutputLimit({ mode: 'manual', manualMaxTokens: NaN, model: 'x' }).maxTokens).toBe(
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

  it('clamps the budget to the model limit', async () => {
    const ai = new AIService({
      config: config({ maxTokensMode: 'manual', modelOutputLimits: { m: 8_000 } }),
    })
    expect(ai.maxOutputTokens).toBe(8_000)
    expect(ai.modelMaxOutputTokens).toBe(8_000)
    await ai.chat([{ role: 'user', content: 'hi' }])
    expect(bodies.map((body) => body.max_tokens)).toEqual([8_000])
  })

  it('model mode sends the model limit; always sends a limit', async () => {
    const ai = new AIService({ config: config({ maxTokensMode: 'model', model: 'gpt-4o' }) })
    expect(ai.maxOutputTokens).toBe(16_384)
    await ai.chat([{ role: 'user', content: 'hi' }])
    expect(bodies[0]!.max_tokens).toBe(16_384)
    // Unknown model: a generous cap to probe from, still sent.
    const unknown = new AIService({ config: config({ maxTokensMode: 'model', maxTokens: 9_000 }) })
    await unknown.chat([{ role: 'user', content: 'hi' }])
    expect(bodies[1]!.max_tokens).toBe(PROBE_OUTPUT_TOKENS)
    // Manual mode: the number.
    const manual = new AIService({ config: config({ maxTokensMode: 'manual', maxTokens: 9_000 }) })
    await manual.chat([{ role: 'user', content: 'hi' }])
    expect(bodies[2]!.max_tokens).toBe(9_000)
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

describe('自动探测: an unknown model limit is learned from the provider', () => {
  const originalFetch = globalThis.fetch
  let bodies: Array<{ max_tokens?: number; max_completion_tokens?: number }>
  let learned: Array<[string, string, number]>

  const ok = (): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }], model: 'm' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const rejected = (message: string): Response =>
    new Response(JSON.stringify({ error: { message } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })

  beforeEach(() => {
    bodies = []
    learned = []
    clearLearnedOutputLimitsForTesting()
    setLearnedOutputLimitSink((baseURL, model, limit) => learned.push([baseURL, model, limit]))
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    setLearnedOutputLimitSink(null)
    clearLearnedOutputLimitsForTesting()
  })

  const respondWith = (...responses: Array<() => Response>): void => {
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string))
      return (responses[bodies.length - 1] ?? ok)()
    }) as unknown as typeof fetch
  }

  const config: ProviderConfig = {
    provider: 'MiniMax',
    baseURL: 'https://api.minimax.example/v1',
    apiKey: 'sk-test',
    model: 'MiniMax-M3',
    temperature: 0.2,
    maxTokens: 8_192,
    maxTokensMode: 'model',
  }

  it('retries with the limit the provider states, and remembers it', async () => {
    respondWith(() => rejected('max_tokens too large (max 40960)'))
    const ai = new AIService({ config })
    expect(ai.maxOutputTokens).toBe(PROBE_OUTPUT_TOKENS)
    await ai.chatJSON([{ role: 'user', content: 'q' }])
    // MiniMax sends its output cap as `max_completion_tokens`.
    expect(bodies.map((body) => body.max_completion_tokens)).toEqual([PROBE_OUTPUT_TOKENS, 40_960])
    expect(learned).toEqual([['https://api.minimax.example/v1', 'MiniMax-M3', 40_960]])
    // Used at once, by this service and by any service built afterwards.
    expect(ai.maxOutputTokens).toBe(40_960)
    expect(ai.outputLimit.source).toBe('learned')
    expect(learnedOutputLimit(config.baseURL, config.model)).toBe(40_960)
    const later = new AIService({ config })
    expect(later.maxOutputTokens).toBe(40_960)
    await later.chatJSON([{ role: 'user', content: 'q' }])
    expect(bodies.at(-1)!.max_completion_tokens).toBe(40_960)
  })

  it('halves when the rejection states no number, and remembers what worked', async () => {
    respondWith(() => rejected('Invalid max_tokens value'))
    const ai = new AIService({ config })
    await ai.streamJSON([{ role: 'user', content: 'q' }])
    expect(bodies.map((body) => body.max_completion_tokens)).toEqual([PROBE_OUTPUT_TOKENS, 32_768])
    expect(learned.map(([, , limit]) => limit)).toEqual([32_768])
  })

  it('reads the limit out of common rejection texts', () => {
    expect(parseOutputLimitFromText('max_tokens must be <= 40960', 65_536)).toBe(40_960)
    expect(parseOutputLimitFromText('range of max_tokens should be [1,8192]', 65_536)).toBe(8_192)
    expect(parseOutputLimitFromText('max_tokens 65536 exceeds the limit 32,768', 65_536)).toBe(
      32_768,
    )
    expect(parseOutputLimitFromText('max_tokens is too large', 65_536)).toBeUndefined()
  })

  it('maps an explicit max_tokens rejection to the output-limit error', () => {
    expect(errorFromStatus(400, 'max_tokens exceeds the maximum allowed (40960)').code).toBe(
      'OUTPUT_LIMIT',
    )
    expect(errorFromStatus(422, 'max_tokens: must be less than or equal to 8192').code).toBe(
      'OUTPUT_LIMIT',
    )
    // A context-window message stays a context error.
    expect(errorFromStatus(400, 'The maximum context length is 8192 tokens').code).toBe(
      'CONTEXT_TOO_LONG',
    )
  })

  it('keeps the Retry-After of a 429', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '3' },
        }),
    ) as unknown as typeof fetch
    const ai = new AIService({ config })
    const err = await ai.chat([{ role: 'user', content: 'q' }]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).retryAfterMs).toBe(3_000)
    expect(
      parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('2026-10-21T07:27:58Z')),
    ).toBe(2_000)
  })
})

describe('the cut-off message names whose limit it was', () => {
  const base: ProviderConfig = {
    provider: 'custom',
    baseURL: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'mystery-model',
    temperature: 0.2,
    maxTokens: 8_192,
  }
  beforeEach(() => clearLearnedOutputLimitsForTesting())

  it('model mode, limit unknown: says so, never suggests the mode already chosen', () => {
    const ai = new AIService({ config: { ...base, maxTokensMode: 'model' } })
    const message = friendlyAIError(ai.truncatedAtCap(PROBE_OUTPUT_TOKENS))
    expect(message).toBe(
      t('friendlyError.outputTruncatedUnknownMax', { limit: PROBE_OUTPUT_TOKENS }),
    )
    expect(message).not.toContain(t('settings.sampling.modeModel'))
  })

  it('model mode, limit known or learned: the model limit', () => {
    const ai = new AIService({
      config: {
        ...base,
        maxTokensMode: 'model',
        learnedOutputLimits: { 'mystery-model': 16_384 },
      },
    })
    expect(friendlyAIError(ai.truncatedAtCap(16_384))).toBe(
      t('friendlyError.outputTruncatedModelMax', { limit: 16_384 }),
    )
  })

  it('manual mode: the setting', () => {
    const ai = new AIService({ config: { ...base, maxTokensMode: 'manual' } })
    expect(friendlyAIError(ai.truncatedAtCap(8_192))).toBe(
      t('friendlyError.outputTruncatedSettingMax', { limit: 8_192 }),
    )
  })
})

describe('learned limits and request concurrency in the settings', () => {
  let db: AppDatabase
  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('remembers a learned limit for the base URL it came from', async () => {
    const svc = new SettingsService(db)
    await svc.update({ baseURL: 'https://api.a.com/v1', model: 'm' })
    await svc.rememberLearnedOutputLimit('https://api.a.com/v1', 'm', 40_960)
    expect((await svc.get()).learnedOutputLimits).toEqual({ m: 40_960 })
    await svc.update({ baseURL: 'https://api.b.com/v1' })
    expect((await svc.get()).learnedOutputLimits).toEqual({})
  })

  it('同时进行的 AI 请求数: default 4, older rows too; 1–8 only', async () => {
    const svc = new SettingsService(db)
    expect((await svc.get()).maxConcurrency).toBe(4)
    await svc.update({ maxConcurrency: 6 })
    expect((await new SettingsService(db).get()).maxConcurrency).toBe(6)
    await expect(svc.update({ maxConcurrency: 9 })).rejects.toThrow()
    await expect(svc.update({ maxConcurrency: 0 })).rejects.toThrow()
    // A row written before the option existed.
    await db.settings.put({ ...DEFAULT_AI_SETTINGS, updatedAt: 1 })
    expect((await new SettingsService(db).get()).maxConcurrency).toBe(4)
    const settings = await svc.get()
    const config = { ...settings, apiKey: 'sk-test', maxConcurrency: 3 }
    expect(new AIService({ config }).concurrency).toBe(3)
  })
})
