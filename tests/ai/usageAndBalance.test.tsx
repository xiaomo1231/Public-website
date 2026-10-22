import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AIService, setAIUsageSink } from '@/services/aiService'
import { AIUsageService, installAIUsageRecording } from '@/services/aiUsageService'
import { SettingsService } from '@/services/settingsService'
import { DataManagementService } from '@/services/dataManagementService'
import { getDb } from '@/infrastructure/db/database'
import { parseUsage } from '@/infrastructure/ai/openaiCompatible'
import {
  OPENAI_COSTS_URL,
  deepseekBalanceUrl,
  parseDeepSeekBalance,
  parseOpenAICostsPage,
  queryBalance,
} from '@/infrastructure/ai/balance'
import { fetchModelList, modelsEndpoint, parseModelList } from '@/infrastructure/ai/models'
import { logger } from '@/infrastructure/logger/logger'
import {
  addUsage,
  estimateCost,
  monthBreakdown,
  monthKey,
  monthTotal,
} from '@/entities/aiUsage/types'
import type { ProviderConfig } from '@/infrastructure/ai/types'
import { ModelCombobox } from '@/widgets/settings/ModelCombobox'
import { filterModels } from '@/widgets/settings/modelFilter'
import { usageReadout } from '@/widgets/settings/usageFormat'

const SECRET = 'sk-SECRETkey1234567890abcdef'
const ADMIN = 'sk-admin-SECRETadmin1234567890'

const config: ProviderConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: SECRET,
  model: 'gpt-test',
  temperature: 0.4,
  maxTokens: 256,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  setAIUsageSink(null)
  vi.restoreAllMocks()
})

describe('parseUsage', () => {
  it('reads OpenAI cached tokens and DeepSeek cache hits', () => {
    expect(
      parseUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 64 },
      }),
    ).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedTokens: 64 })
    expect(
      parseUsage({ prompt_tokens: 50, completion_tokens: 5, prompt_cache_hit_tokens: 30 }),
    ).toEqual({ promptTokens: 50, completionTokens: 5, totalTokens: 55, cachedTokens: 30 })
  })

  it('returns undefined without a usage block', () => {
    expect(parseUsage(undefined)).toBeUndefined()
    expect(parseUsage(null)).toBeUndefined()
    expect(parseUsage({})).toBeUndefined()
  })
})

describe('usage aggregation', () => {
  it('adds per month and per kind, counting missing usage separately', () => {
    const oct = new Date(2026, 9, 5)
    const nov = new Date(2026, 10, 2)
    let store = addUsage(undefined, 'quiz', { promptTokens: 100, completionTokens: 10 }, oct)
    store = addUsage(
      store,
      'quiz',
      { promptTokens: 50, completionTokens: 5, cachedTokens: 20 },
      oct,
    )
    store = addUsage(store, 'walkthrough', undefined, oct)
    store = addUsage(store, 'quiz', { promptTokens: 7, completionTokens: 1 }, nov)

    const october = monthBreakdown(store, monthKey(oct))
    expect(october.quiz).toEqual({
      requests: 2,
      promptTokens: 150,
      completionTokens: 15,
      cachedTokens: 20,
      missingUsage: 0,
    })
    expect(october.walkthrough.requests).toBe(1)
    expect(october.walkthrough.missingUsage).toBe(1)
    expect(october.walkthrough.promptTokens).toBe(0)
    expect(october.analysis.requests).toBe(0)
    expect(monthTotal(store, monthKey(nov)).promptTokens).toBe(7)
  })

  it('estimates cost with a cached-input price', () => {
    const bucket = {
      requests: 1,
      promptTokens: 1_000_000,
      completionTokens: 500_000,
      cachedTokens: 400_000,
      missingUsage: 0,
    }
    const cost = estimateCost(bucket, {
      inputPerMillion: 2,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 8,
      currency: 'CNY',
    })
    expect(cost).toBeCloseTo(0.6 * 2 + 0.4 * 0.5 + 0.5 * 8)
  })

  it('records AIService responses by kind into the settings row', async () => {
    await new SettingsService().update({ apiKey: SECRET })
    const usage = new AIUsageService()
    const recorded: Promise<void>[] = []
    setAIUsageSink((kind, u) => {
      recorded.push(usage.record(kind, u))
    })
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'no usage' } }] }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          choices: [{ message: { content: '{"a":1}' } }],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 4,
            prompt_tokens_details: { cached_tokens: 32 },
          },
        }),
      ) as unknown as typeof fetch

    const ai = new AIService({ config })
    await ai.chat([{ role: 'user', content: 'x' }])
    await ai.withKind('walkthrough').chat([{ role: 'user', content: 'y' }])
    await ai.withKind('quiz').chatJSON([{ role: 'user', content: 'z' }])
    await Promise.all(recorded)

    const { usage: store } = await usage.snapshot()
    const month = monthBreakdown(store, monthKey())
    expect(month.other).toMatchObject({ requests: 1, promptTokens: 12, completionTokens: 3 })
    expect(month.walkthrough).toMatchObject({ requests: 1, missingUsage: 1, promptTokens: 0 })
    expect(month.quiz).toMatchObject({ requests: 1, promptTokens: 40, cachedTokens: 32 })

    // A settings save keeps the counters; reset clears them.
    await new SettingsService().update({ model: 'other-model' })
    expect(monthTotal((await usage.snapshot()).usage, monthKey()).requests).toBe(3)
    await usage.reset()
    expect((await usage.snapshot()).usage).toBeUndefined()
  })

  it('records nothing without a settings row, and the installed sink never throws', async () => {
    installAIUsageRecording(new AIUsageService())
    await new AIUsageService().record('quiz', {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    })
    expect(await getDb().settings.get('singleton')).toBeUndefined()
  })
})

describe('balance registry', () => {
  it('parses the documented DeepSeek balance body', async () => {
    expect(deepseekBalanceUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/user/balance',
    )
    const body = {
      is_available: true,
      balance_infos: [
        {
          currency: 'CNY',
          total_balance: '110.00',
          granted_balance: '10.00',
          topped_up_balance: '100.00',
        },
      ],
    }
    expect(parseDeepSeekBalance(body)).toEqual({
      status: 'ok',
      kind: 'balance',
      source: 'deepseek',
      available: true,
      entries: [{ currency: 'CNY', total: 110, granted: 10, toppedUp: 100 }],
    })
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body))
    const result = await queryBalance({
      provider: 'deepseek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.status).toBe('ok')
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.deepseek.com/user/balance')
    expect(fetchImpl.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${SECRET}`)
  })

  it('OpenAI: needs the admin key, sends it only to api.openai.com, sums cost pages', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            { results: [{ amount: { value: 1.25, currency: 'usd' } }] },
            { results: [{ amount: { value: 0.5, currency: 'usd' } }] },
          ],
          next_page: 'page_2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [{ results: [{ amount: { value: '0.25', currency: 'usd' } }] }],
          next_page: null,
        }),
      )
    const noAdmin = await queryBalance({
      provider: 'openai',
      baseURL: 'https://proxy.example.com/v1',
      apiKey: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(noAdmin).toEqual({ status: 'needs-admin-key' })
    expect(fetchImpl).not.toHaveBeenCalled()

    const now = new Date(2026, 9, 21)
    const result = await queryBalance({
      provider: 'openai',
      baseURL: 'https://proxy.example.com/v1',
      apiKey: SECRET,
      adminApiKey: ADMIN,
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ status: 'ok', kind: 'spent', currency: 'USD', amount: 2 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url).startsWith(`${OPENAI_COSTS_URL}?`)).toBe(true)
      expect(init.headers.Authorization).toBe(`Bearer ${ADMIN}`)
    }
    expect(String(fetchImpl.mock.calls[1]![0])).toContain('page=page_2')
    expect(parseOpenAICostsPage({ nope: true })).toBeNull()
  })

  it('unknown providers fall back to local usage without a request', async () => {
    const fetchImpl = vi.fn()
    for (const provider of ['qwen', 'MiniMax', 'mimo', 'custom'] as const) {
      const result = await queryBalance({
        provider,
        baseURL: 'https://api.example.com/v1',
        apiKey: SECRET,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      expect(result).toEqual({ status: 'unsupported' })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
    const readout = usageReadout({
      balance: { status: 'unsupported' },
      usage: addUsage(undefined, 'quiz', { promptTokens: 1500, completionTokens: 500 }),
      prices: { inputPerMillion: 1, outputPerMillion: 2, currency: 'CNY' },
      unconfigured: false,
      language: 'zh-CN',
    })
    expect(readout).toContain('2')
    expect(readout).toContain('估算')
  })

  it('a CORS failure reports "blocked" and the readout shows local usage', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await queryBalance({
      provider: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      apiKey: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ status: 'error', reason: 'blocked' })
    const readout = usageReadout({
      balance: result,
      usage: addUsage(undefined, 'tutor', { promptTokens: 900, completionTokens: 100 }),
      prices: null,
      unconfigured: false,
      language: 'en',
    })
    expect(readout).toBe('1K tokens this month')
  })
})

describe('model list', () => {
  it('parses OpenAI-compatible bodies', () => {
    expect(modelsEndpoint('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/v1/models',
    )
    expect(modelsEndpoint('https://x.test/v1/chat/completions')).toBe('https://x.test/v1/models')
    expect(
      parseModelList({
        object: 'list',
        data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }],
      }),
    ).toEqual(['a-model', 'b-model'])
    expect(parseModelList({ models: [{ name: 'm1' }] })).toEqual(['m1'])
    expect(parseModelList({ unexpected: 1 })).toBeNull()
  })

  it('uses the provider headers and falls back on CORS / auth errors', async () => {
    const ok = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'deepseek-chat' }] }))
    expect(
      await fetchModelList(
        { baseURL: 'https://api.deepseek.com/v1', apiKey: SECRET },
        { fetchImpl: ok as unknown as typeof fetch },
      ),
    ).toEqual({ ok: true, models: ['deepseek-chat'] })
    expect(ok.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${SECRET}`)

    const blocked = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(
      await fetchModelList(
        { baseURL: 'https://api.example.com/v1', apiKey: SECRET },
        { fetchImpl: blocked as unknown as typeof fetch },
      ),
    ).toEqual({ ok: false, reason: 'blocked' })

    const denied = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'bad key' } }))
    const result = await fetchModelList(
      { baseURL: 'https://api.example.com/v1', apiKey: SECRET },
      { fetchImpl: denied as unknown as typeof fetch },
    )
    expect(result).toMatchObject({ ok: false, reason: 'auth', status: 401 })
    expect(await fetchModelList({ baseURL: '', apiKey: SECRET })).toEqual({
      ok: false,
      reason: 'missing-config',
    })
  })

  it('combobox filters the list but keeps free text; no list → plain input', () => {
    expect(filterModels(['gpt-4o', 'gpt-4o-mini', 'o3'], '4O')).toEqual(['gpt-4o', 'gpt-4o-mini'])
    const onChange = vi.fn()
    const { rerender } = render(
      <ModelCombobox id="m" value="" onChange={onChange} models={['alpha', 'beta']} />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.change(input, { target: { value: 'my-own-model' } })
    expect(onChange).toHaveBeenLastCalledWith('my-own-model')
    rerender(<ModelCombobox id="m" value="be" onChange={onChange} models={['alpha', 'beta']} />)
    fireEvent.focus(input)
    fireEvent.click(screen.getByRole('option', { name: 'beta' }))
    expect(onChange).toHaveBeenLastCalledWith('beta')

    rerender(<ModelCombobox id="m" value="x" onChange={onChange} models={[]} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('textbox')).toHaveValue('x')
  })
})

describe('secrets', () => {
  it('keys never appear in logged objects', async () => {
    const calls: unknown[] = []
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        calls.push(args)
      })
    }
    await fetchModelList(
      { baseURL: `https://api.example.com/v1?key=${SECRET}`, apiKey: SECRET },
      {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(
            jsonResponse(500, { error: { message: `bad key ${SECRET}` } }),
          ) as unknown as typeof fetch,
      },
    )
    await queryBalance({
      provider: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      apiKey: SECRET,
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('x')) as unknown as typeof fetch,
    })
    await queryBalance({
      provider: 'openai',
      baseURL: 'https://api.openai.com/v1',
      apiKey: SECRET,
      adminApiKey: ADMIN,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(403, {})) as unknown as typeof fetch,
    })
    await new SettingsService().update({ apiKey: SECRET, adminApiKey: ADMIN })
    expect(calls.length).toBeGreaterThan(0)
    const logged = JSON.stringify(calls)
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain(ADMIN)
  })

  it('the admin key is encrypted at rest and never exported', async () => {
    const saved = await new SettingsService().update({ adminApiKey: ADMIN })
    expect(saved.adminApiKey).toBe(ADMIN)
    const row = await getDb().settings.get('singleton')
    expect(row?.adminApiKeyEncrypted).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain(ADMIN)
    const { json } = await new DataManagementService().exportAll()
    expect(JSON.stringify(json)).not.toContain('adminApiKeyEncrypted')
  })
})
