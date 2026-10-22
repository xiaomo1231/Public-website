import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIService, withLightModel } from '@/services/aiService'
import { SettingsService } from '@/services/settingsService'
import { checkBlanksWithAi } from '@/services/fillBlankChecker'
import type { ProviderConfig } from '@/infrastructure/ai/types'
import type { Question } from '@/entities/question/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'

const config: ProviderConfig = {
  provider: 'deepseek',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-v4-pro',
  temperature: 0.4,
  maxTokens: 8192,
  maxTokensMode: 'model',
}

function recordFetch(content = '{"ok":true}') {
  const bodies: Array<Record<string, unknown>> = []
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>)
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return bodies
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('轻量模型 (AIService.light)', () => {
  it('is the service itself without a light model, or with the main model again', () => {
    const ai = new AIService({ config })
    expect(ai.light()).toBe(ai)
    const same = new AIService({ config: { ...config, lightModel: ' deepseek-v4-pro ' } })
    expect(same.light()).toBe(same)
  })

  it('sends to the light model with the same key, and resolves its own output cap', async () => {
    const bodies = recordFetch()
    const ai = new AIService({ config: { ...config, lightModel: 'deepseek-v4-flash' } })
    // The main model's documented limit applies to the main model only.
    expect(ai.maxOutputTokens).toBe(384_000)
    const light = ai.light()
    expect(light).not.toBe(ai)
    // No documented limit for the light model: the manual number.
    expect(light.maxOutputTokens).toBe(8192)
    await light.chatJSON([{ role: 'user', content: 'q' }])
    await ai.chatJSON([{ role: 'user', content: 'q' }])
    expect(bodies.map((b) => b.model)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(bodies[0]!.max_tokens).toBe(8192)
  })

  it('withLightModel leaves test doubles alone', () => {
    const stub = { chatJSON: vi.fn() } as unknown as AIService
    expect(withLightModel(stub)).toBe(stub)
    expect(withLightModel(null)).toBeNull()
  })

  it('is used by the fill-blank check', async () => {
    const bodies = recordFetch('{"blanks":[{"index":1,"equivalent":true}]}')
    const ai = new AIService({ config: { ...config, lightModel: 'cheap-model' } })
    const evaluation = {
      correct: false,
      blanks: [{ given: 'ACh', accepted: ['乙酰胆碱'], correct: false }],
    } as unknown as QuestionEvaluation
    await checkBlanksWithAi(ai, { prompt: '____ 是递质' } as Question, evaluation)
    expect(bodies[0]!.model).toBe('cheap-model')
  })
})

describe('settings: light model', () => {
  it('stores a trimmed light model and clears it when emptied', async () => {
    const svc = new SettingsService()
    expect((await svc.get()).lightModel).toBe('')
    expect((await svc.update({ lightModel: '  gpt-4o-mini ' })).lightModel).toBe('gpt-4o-mini')
    expect((await svc.get()).lightModel).toBe('gpt-4o-mini')
    expect((await svc.update({ lightModel: '' })).lightModel).toBe('')
  })
})
