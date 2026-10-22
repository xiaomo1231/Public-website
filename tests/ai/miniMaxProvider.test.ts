import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProvider, getPreset, miniMaxLowEffort } from '@/infrastructure/ai/presets'
import {
  OutputTruncatedError,
  ReasoningExhaustedError,
  errorFromBaseResp,
} from '@/infrastructure/ai/errors'
import type { ProviderConfig } from '@/infrastructure/ai/types'
import { AIService, isReasoningExhausted } from '@/services/aiService'
import { classifyHomeworkError } from '@/entities/homework/errorKind'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { SettingsRepository } from '@/entities/settings/repository'
import { SettingsService } from '@/services/settingsService'
import {
  DEFAULT_AI_SETTINGS,
  LEGACY_MINIMAX_BASE_URL,
  PROVIDER_PRESETS,
} from '@/entities/settings/types'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'

const miniMax = (model = 'MiniMax-M3', extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  provider: 'MiniMax',
  baseURL: 'https://api.minimax.io/v1',
  apiKey: 'sk-test',
  model,
  temperature: 0.7,
  maxTokens: 8192,
  ...extra,
})

const deepseek: ProviderConfig = {
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  temperature: 0.7,
  maxTokens: 4096,
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

/** Replies in order (the last one repeats); records every request body. */
function mockFetch(replies: Array<() => Response>): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = []
  let i = 0
  globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const reply = replies[Math.min(i, replies.length - 1)]!
    i += 1
    return Promise.resolve(reply())
  }) as unknown as typeof fetch
  return bodies
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const completion = (
  content: string,
  finish: string,
  extra: { reasoning?: string; usage?: Record<string, unknown> } = {},
) =>
  json({
    model: 'MiniMax-M3',
    choices: [
      {
        message: {
          content,
          ...(extra.reasoning ? { reasoning_content: extra.reasoning } : {}),
        },
        finish_reason: finish,
      },
    ],
    ...(extra.usage ? { usage: extra.usage } : {}),
    base_resp: { status_code: 0, status_msg: 'success' },
  })

const sse = (events: unknown[]) => () =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })

const user = [{ role: 'user' as const, content: 'go' }]

describe('MiniMax preset', () => {
  it('points at the documented endpoints and current models, without json mode', () => {
    const preset = getPreset('MiniMax')
    expect(preset.baseURL).toBe('https://api.minimax.io/v1')
    expect(preset.defaultModel).toBe('MiniMax-M3')
    expect(preset.models).toContain('MiniMax-M3.1-Flash')
    expect(preset.supportsJsonMode).toBe(false)
    expect(preset.streamUsage).toBe(true)
    const settingsPreset = PROVIDER_PRESETS.find((p) => p.id === 'MiniMax')!
    expect(settingsPreset.regions?.map((r) => r.baseURL)).toEqual([
      'https://api.minimax.io/v1',
      'https://api.minimax.cn/v1',
    ])
  })

  it('sends reasoning_split and max_completion_tokens, never temperature or response_format', async () => {
    const bodies = mockFetch([completion('{"ok":true}', 'stop')])
    const ai = new AIService({ config: miniMax() })
    await ai.chatJSON(user)
    const body = bodies[0]!
    expect(body.reasoning_split).toBe(true)
    expect(body.max_completion_tokens).toBeTypeOf('number')
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('response_format')
    expect(body).not.toHaveProperty('thinking')
  })

  it('streams with include_usage', async () => {
    const bodies = mockFetch([
      sse([{ choices: [{ delta: { content: '{"a":1}' }, finish_reason: 'stop' }] }]),
    ])
    await new AIService({ config: miniMax() }).streamJSON(user)
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true })
  })

  it('sends the whole configured cap (no separate thinking reserve)', async () => {
    const bodies = mockFetch([completion('{"ok":true}', 'stop')])
    await new AIService({ config: miniMax('MiniMax-M3', { maxTokens: 64_000 }) }).chatJSON(user)
    expect(bodies[0]!.max_completion_tokens).toBe(64_000)

    const capped = mockFetch([completion('{"ok":true}', 'stop')])
    await new AIService({ config: miniMax('MiniMax-M3', { maxTokens: 8_192 }) }).chatJSON(user)
    expect(capped[0]!.max_completion_tokens).toBe(8_192)
  })

  it('leaves other presets unchanged', async () => {
    const bodies = mockFetch([completion('{"ok":true}', 'stop')])
    await new AIService({ config: deepseek }).chatJSON(user)
    const body = bodies[0]!
    expect(body.max_tokens).toBe(deepseek.maxTokens)
    expect(body.temperature).toBe(0.7)
    expect(body).not.toHaveProperty('reasoning_split')
    expect(body).not.toHaveProperty('max_completion_tokens')
  })
})

describe('low reasoning', () => {
  it('translates per model', () => {
    expect(miniMaxLowEffort('MiniMax-M3')).toEqual({ thinking: { type: 'disabled' } })
    expect(miniMaxLowEffort('MiniMax-M3.1-Flash')).toEqual({ reasoning_effort: 'low' })
    expect(miniMaxLowEffort('MiniMax-M2.7')).toBeUndefined()
    expect(miniMaxLowEffort('MiniMax-M2.5-highspeed')).toBeUndefined()
  })

  it('reaches the request body only when asked, and only for MiniMax', async () => {
    const bodies = mockFetch([completion('{"ok":true}', 'stop')])
    await new AIService({ config: miniMax() }).chatJSON(user, { reasoning: 'low' })
    await new AIService({ config: miniMax('MiniMax-M3.1-Flash') }).chatJSON(user, {
      reasoning: 'low',
    })
    await new AIService({ config: miniMax('MiniMax-M2.7') }).chatJSON(user, { reasoning: 'low' })
    await new AIService({ config: deepseek }).chatJSON(user, { reasoning: 'low' })
    expect(bodies[0]!.thinking).toEqual({ type: 'disabled' })
    expect(bodies[1]!.reasoning_effort).toBe('low')
    expect(bodies[1]).not.toHaveProperty('thinking')
    expect(bodies[2]).not.toHaveProperty('thinking')
    expect(bodies[2]).not.toHaveProperty('reasoning_effort')
    expect(bodies[3]).not.toHaveProperty('thinking')
    expect(bodies[3]).not.toHaveProperty('reasoning_effort')
  })
})

describe('reasoning_content parsing', () => {
  it('keeps reasoning out of the content (non-streaming)', async () => {
    mockFetch([completion('{"a":1}', 'stop', { reasoning: 'Let me think about it…' })])
    const provider = createProvider(miniMax())
    const res = await provider.chat({ messages: user })
    expect(res.content).toBe('{"a":1}')
    expect(res.reasoningChars).toBe('Let me think about it…'.length)
  })

  it('keeps reasoning out of the content (streaming, both field names)', async () => {
    mockFetch([
      sse([
        { choices: [{ delta: { reasoning_content: 'think ' } }] },
        { choices: [{ delta: { reasoning_details: [{ text: 'more' }] } }] },
        { choices: [{ delta: { content: '{"a":' } }] },
        { choices: [{ delta: { content: '1}' }, finish_reason: 'stop' }] },
        {
          usage: {
            prompt_tokens: 5,
            completion_tokens: 9,
            completion_tokens_details: { reasoning_tokens: 4 },
          },
        },
      ]),
    ])
    const deltas: string[] = []
    const res = await createProvider(miniMax()).streamChat({ messages: user }, (c) => {
      if (c.delta) deltas.push(c.delta)
    })
    expect(res.content).toBe('{"a":1}')
    expect(deltas.join('')).toBe('{"a":1}')
    expect(res.reasoningChars).toBe('think more'.length)
    expect(res.usage?.reasoningTokens).toBe(4)
  })

  it('still strips <think> blocks when the thinking stays in the content', async () => {
    mockFetch([completion('<think>hmm</think>{"a":1}', 'stop')])
    const { data } = await new AIService({ config: miniMax() }).chatJSON<{ a: number }>(user)
    expect(data).toEqual({ a: 1 })
  })
})

describe('thinking used up the budget', () => {
  it('is told apart from a plain truncation', () => {
    const base = { model: 'm', finishReason: 'length' }
    expect(isReasoningExhausted({ ...base, content: '', reasoningChars: 900 })).toBe(true)
    expect(isReasoningExhausted({ ...base, content: '<think>still going' })).toBe(true)
    expect(
      isReasoningExhausted({
        ...base,
        content: '{"a":',
        usage: { promptTokens: 1, completionTokens: 1000, totalTokens: 1001, reasoningTokens: 900 },
      }),
    ).toBe(true)
    // A long answer cut off, little thinking: plain truncation.
    expect(
      isReasoningExhausted({
        ...base,
        content: '{"a":"long',
        usage: { promptTokens: 1, completionTokens: 1000, totalTokens: 1001, reasoningTokens: 100 },
      }),
    ).toBe(false)
    // A plain model cut off with nothing written: not about thinking.
    expect(isReasoningExhausted({ ...base, content: '' })).toBe(false)
    expect(isReasoningExhausted({ model: 'm', finishReason: 'stop', content: '' })).toBe(false)
  })

  it('fails at once with REASONING_EXHAUSTED (not OUTPUT_TRUNCATED): the cap was already sent', async () => {
    const bodies = mockFetch([completion('', 'length', { reasoning: 'thinking forever' })])
    const ai = new AIService({ config: miniMax('MiniMax-M3', { maxTokens: 64_000 }) })
    const err = await ai.streamJSON(user).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReasoningExhaustedError)
    expect(err).not.toBeInstanceOf(OutputTruncatedError)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.max_completion_tokens).toBe(64_000)
    expect(classifyHomeworkError(err)).toBe('reasoning-exhausted')
    expect(friendlyAIError(err)).toMatch(/Max tokens|最大 Token/)
  })

  it('does not retry when the budget is already the cap', async () => {
    const bodies = mockFetch([completion('', 'length', { reasoning: 'thinking' })])
    const ai = new AIService({ config: miniMax('MiniMax-M3', { maxTokens: 8_192 }) })
    const err = await ai.chatJSON(user).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReasoningExhaustedError)
    expect(bodies).toHaveLength(1)
  })

  it('a plain cut-off answer is still OUTPUT_TRUNCATED', async () => {
    mockFetch([completion('{"a":"long', 'length')])
    const err = await new AIService({ config: miniMax() }).chatJSON(user).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutputTruncatedError)
  })
})

describe('base_resp error codes', () => {
  it.each([
    [1002, 'RATE_LIMITED'],
    [1004, 'AUTH_FAILED'],
    [1008, 'QUOTA_EXCEEDED'],
    [1039, 'OUTPUT_LIMIT'],
    [2013, 'INVALID_REQUEST'],
    [1027, 'INVALID_RESPONSE'],
    [1001, 'TIMEOUT'],
    [1000, 'PROVIDER_UNAVAILABLE'],
    [1013, 'PROVIDER_UNAVAILABLE'],
  ])('maps %i to %s', (code, expected) => {
    expect(errorFromBaseResp(code, 'provider says no', 200).code).toBe(expected)
  })

  it('keeps an output-cap rejection under 2013 an output-limit error', () => {
    expect(
      errorFromBaseResp(2013, 'invalid params, max_completion_tokens must be <= 131072', 200).code,
    ).toBe('OUTPUT_LIMIT')
  })

  it('reads a base_resp failure inside a 200 response', async () => {
    mockFetch([json({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } })])
    const err = await createProvider(miniMax())
      .chat({ messages: user })
      .catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('QUOTA_EXCEEDED')
  })

  it('reads a base_resp failure inside an HTTP error', async () => {
    mockFetch([json({ base_resp: { status_code: 1004, status_msg: 'login fail' } }, 401)])
    const err = await createProvider(miniMax())
      .streamChat({ messages: user }, () => {})
      .catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('AUTH_FAILED')
  })
})

describe('testConnection', () => {
  it('sends a thinking-friendly ping and counts reasoning-only replies as success', async () => {
    const bodies = mockFetch([completion('', 'length', { reasoning: 'pinging…' })])
    const result = await createProvider(miniMax()).testConnection()
    expect(result.ok).toBe(true)
    const body = bodies[0]!
    expect(body).not.toHaveProperty('temperature')
    expect(body.max_completion_tokens as number).toBeGreaterThanOrEqual(512)
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('reports a base_resp failure', async () => {
    mockFetch([json({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } })])
    const result = await createProvider(miniMax()).testConnection()
    expect(result.ok).toBe(false)
  })

  it('is unchanged for plain presets', async () => {
    const bodies = mockFetch([completion('pong', 'stop')])
    await createProvider(deepseek).testConnection()
    expect(bodies[0]!.max_tokens).toBe(8)
    expect(bodies[0]!.temperature).toBe(0)
  })
})

describe('legacy MiniMax base URL', () => {
  beforeEach(() => {
    setDbForTesting(new AppDatabase())
  })

  it('moves exactly the old preset default to the international endpoint, key untouched', async () => {
    const repo = new SettingsRepository()
    await repo.putRow({
      ...DEFAULT_AI_SETTINGS,
      provider: 'MiniMax',
      baseURL: LEGACY_MINIMAX_BASE_URL,
      model: 'MiniMax-Text-01',
      apiKeyEncrypted: 'iv.cipher',
      updatedAt: 1,
    })
    await new SettingsService().get()
    const row = await repo.getRow()
    expect(row.baseURL).toBe('https://api.minimax.io/v1')
    expect(row.apiKeyEncrypted).toBe('iv.cipher')
    expect(row.model).toBe('MiniMax-Text-01')
  })

  it('leaves a base URL the user typed alone', async () => {
    const repo = new SettingsRepository()
    await repo.putRow({
      ...DEFAULT_AI_SETTINGS,
      provider: 'MiniMax',
      baseURL: 'https://api.minimaxi.com/v1',
      updatedAt: 1,
    })
    await new SettingsService().get()
    expect((await repo.getRow()).baseURL).toBe('https://api.minimaxi.com/v1')
  })
})

describe('walkthrough does not split when thinking ran out', () => {
  let db: AppDatabase
  let setId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projectId = (await new ProjectService(db).create({ name: 'Calc', subject: 'calculus' }))
      .id
    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType: 'homework',
      name: 'hw.pdf',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    const repo = new HomeworkRepository(db)
    setId = crypto.randomUUID()
    const set: HomeworkSet = {
      id: setId,
      projectId,
      documentId: doc.id,
      documentName: 'hw.pdf',
      title: 'HW',
      status: 'ready',
      language: 'en',
      questionCount: 4,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    }
    await repo.upsertSet(set)
    for (let i = 1; i <= 4; i++) {
      const question: HomeworkQuestion = {
        id: `q${i}`,
        projectId,
        setId,
        documentId: doc.id,
        documentName: 'hw.pdf',
        order: i - 1,
        number: String(i),
        prompt: `Differentiate x^${i + 1}.`,
        sourceRefs: [],
        hints: [],
        generationStatus: 'ready',
        promptVersion: 'v1',
        draftText: '',
        revealedHints: 0,
        solutionRevealed: false,
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }
      await repo.upsertQuestion(question)
    }
  })

  it('fails the opening / summary once each instead of splitting them', async () => {
    const frameCalls: string[] = []
    const streamJSON = vi.fn(
      async (
        messages: Array<{ content: string }>,
        _delta: unknown,
        opts: { maxTokens: number },
      ) => {
        const system = messages[0]!.content
        if (system.includes('ONLY the opening') || system.includes('ONLY the closing summary')) {
          frameCalls.push(system.includes('ONLY the opening') ? 'overview' : 'summary')
          throw new ReasoningExhaustedError(opts.maxTokens)
        }
        return {
          data: { status: 'ready', conclusion: 'Done.', body: 'Work.' },
          raw: {},
        }
      },
    )
    const ai = {
      streamJSON,
      chatJSON: streamJSON,
      maxOutputTokens: 8192,
      modelMaxOutputTokens: 8192,
    } as unknown as AIService
    const service = new HomeworkWalkthroughService({
      ai,
      db,
      homework: new HomeworkService({ ai, db }),
    })
    const result = await service.generate(setId)
    expect(result.failed).toBe(2)
    expect(frameCalls.sort()).toEqual(['overview', 'summary'])
  })
})
