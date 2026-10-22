import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIService, asTruncatedAtCap, exhaustedOutputCap } from '@/services/aiService'
import {
  clearLearnedOutputLimitsForTesting,
  PROBE_OUTPUT_TOKENS,
  setLearnedOutputLimitSink,
} from '@/infrastructure/ai/outputLimit'
import {
  OutputTruncatedError,
  ReasoningExhaustedError,
  RateLimitedError,
} from '@/infrastructure/ai/errors'
import type { ProviderConfig } from '@/infrastructure/ai/types'

/**
 * 「额度直接给到上限」: every request sends the resolved output cap up front —
 * never a small first try that grows on a retry — and a reply cut off at the
 * cap is never sent again as the same request.
 */

const originalFetch = globalThis.fetch
let bodies: Array<Record<string, unknown>>

/** Replies in order (the last one repeats); a streaming request gets SSE. */
function mockFetch(replies: Array<{ content: string; finish: string; status?: number }>): void {
  let i = 0
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    const reply = replies[Math.min(i, replies.length - 1)]!
    i += 1
    if (reply.status && reply.status >= 400)
      return new Response(JSON.stringify({ error: { message: reply.content } }), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (body.stream) {
      const event = {
        choices: [{ delta: { content: reply.content }, finish_reason: reply.finish }],
      }
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    return new Response(
      JSON.stringify({
        model: 'm',
        choices: [{ message: { content: reply.content }, finish_reason: reply.finish }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as typeof fetch
}

const config = (patch: Partial<ProviderConfig> = {}): ProviderConfig => ({
  provider: 'custom',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'some-model',
  temperature: 0.2,
  maxTokens: 12_000,
  ...patch,
})

const user = [{ role: 'user' as const, content: 'go' }]

beforeEach(() => {
  bodies = []
  clearLearnedOutputLimitsForTesting()
  setLearnedOutputLimitSink(null)
})
afterEach(() => {
  globalThis.fetch = originalFetch
  clearLearnedOutputLimitsForTesting()
})

async function everyKind(ai: AIService): Promise<void> {
  await ai.chat(user)
  await ai.chatJSON(user)
  await ai.streamJSON(user)
  await ai.streamChat(user, () => {})
}

describe('every request sends the whole output cap', () => {
  it('manual mode: the user’s number, for chat / chatJSON / streamJSON / streamChat', async () => {
    mockFetch([{ content: '{"ok":true}', finish: 'stop' }])
    await everyKind(new AIService({ config: config({ maxTokensMode: 'manual' }) }))
    expect(bodies.map((body) => body.max_tokens)).toEqual([12_000, 12_000, 12_000, 12_000])
  })

  it('model mode with a known limit: the model’s limit', async () => {
    mockFetch([{ content: '{"ok":true}', finish: 'stop' }])
    await everyKind(new AIService({ config: config({ maxTokensMode: 'model', model: 'gpt-4o' }) }))
    expect(bodies.map((body) => body.max_tokens)).toEqual([16_384, 16_384, 16_384, 16_384])
  })

  it('model mode with the limit unknown: the probe value', async () => {
    mockFetch([{ content: '{"ok":true}', finish: 'stop' }])
    await everyKind(new AIService({ config: config({ maxTokensMode: 'model' }) }))
    expect(bodies.every((body) => body.max_tokens === PROBE_OUTPUT_TOKENS)).toBe(true)
    expect(bodies).toHaveLength(4)
  })

  it('a light-model view sends its own cap too', async () => {
    mockFetch([{ content: '{"ok":true}', finish: 'stop' }])
    const ai = new AIService({
      config: config({ maxTokensMode: 'model', model: 'gpt-4o', lightModel: 'gpt-4o-mini' }),
    })
    await ai.light().chatJSON(user)
    expect(bodies[0]!.model).toBe('gpt-4o-mini')
    expect(bodies[0]!.max_tokens).toBe(16_384)
  })
})

describe('a reply cut off at the cap', () => {
  it('fails at once with the at-the-cap error: one request, no larger retry', async () => {
    mockFetch([{ content: '{"a":"long', finish: 'length' }])
    const ai = new AIService({ config: config({ maxTokensMode: 'model', model: 'gpt-4o' }) })
    const err = await ai.streamJSON(user).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutputTruncatedError)
    expect((err as OutputTruncatedError).atCap).toEqual({ limit: 16_384, by: 'model' })
    expect(bodies).toHaveLength(1)
    expect(exhaustedOutputCap(err)).toBe(true)
  })

  it('a thinking model that used the whole cap fails at once with REASONING_EXHAUSTED', async () => {
    mockFetch([{ content: '<think>still thinking', finish: 'length' }])
    const ai = new AIService({ config: config({ maxTokensMode: 'manual' }) })
    const err = await ai.chatJSON(user).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReasoningExhaustedError)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.max_tokens).toBe(12_000)
    expect(exhaustedOutputCap(err)).toBe(true)
  })

  it('a probe value refused as too large is learned (the only budget change), not a quality retry', async () => {
    mockFetch([
      { content: 'max_tokens must be <= 40960', finish: 'stop', status: 400 },
      { content: '{"ok":true}', finish: 'stop' },
    ])
    const ai = new AIService({ config: config({ maxTokensMode: 'model' }) })
    await ai.chatJSON(user)
    await ai.chatJSON(user)
    expect(bodies.map((body) => body.max_tokens)).toEqual([PROBE_OUTPUT_TOKENS, 40_960, 40_960])
  })

  it('asTruncatedAtCap keeps an at-the-cap error and rebuilds a plain one for the cap', () => {
    const atCap = new OutputTruncatedError(8_000, { limit: 8_000, by: 'model' })
    expect(asTruncatedAtCap({ maxOutputTokens: 8_000 }, atCap)).toBe(atCap)
    const rebuilt = asTruncatedAtCap({ maxOutputTokens: 9_000 }, new OutputTruncatedError())
    expect(rebuilt.atCap).toEqual({ limit: 9_000, by: 'setting' })
    expect(exhaustedOutputCap(new RateLimitedError('slow down'))).toBe(false)
  })
})
