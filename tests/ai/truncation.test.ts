import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIService } from '@/services/aiService'
import { OpenAICompatibleProvider } from '@/infrastructure/ai/openaiCompatible'
import { InvalidJSONError, OutputTruncatedError } from '@/infrastructure/ai/errors'
import type { ProviderConfig } from '@/infrastructure/ai/types'

/**
 * A response that stops because the model hit the output cap is incomplete.
 * That must be reported as truncation, not as "the AI returned malformed JSON",
 * because the fix is a larger output budget rather than a retry.
 */

const config: ProviderConfig = {
  provider: 'custom',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 2048,
}

const originalFetch = globalThis.fetch

/** A fresh Response per call — a body can only be read once. */
function replyWith(content: string, finishReason: string | null): void {
  globalThis.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: finishReason }],
          model: 'test-model',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  ) as unknown as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('provider finishReason', () => {
  it('is surfaced on the chat response', async () => {
    replyWith('{"ok":true}', 'stop')
    const provider = new OpenAICompatibleProvider('custom', 'Custom', config, {
      defaultModel: 'test-model',
      supportsJsonMode: true,
    })

    const res = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(res.finishReason).toBe('stop')
  })

  it('reports "length" when the model was cut off', async () => {
    replyWith('{"topics":[{"name":"A"', 'length')
    const provider = new OpenAICompatibleProvider('custom', 'Custom', config, {
      defaultModel: 'test-model',
      supportsJsonMode: true,
    })

    const res = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(res.finishReason).toBe('length')
  })
})

describe('chatJSON truncation handling', () => {
  it('throws OutputTruncatedError instead of a JSON parse error', async () => {
    replyWith('{"topics":[{"name":"A"', 'length')
    const ai = new AIService({ config })

    const err = await ai
      .chatJSON([{ role: 'user', content: 'analyze' }])
      .then(() => null)
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(OutputTruncatedError)
    expect(err).not.toBeInstanceOf(InvalidJSONError)
    expect((err as OutputTruncatedError).code).toBe('OUTPUT_TRUNCATED')
    expect((err as OutputTruncatedError).message).toContain('2048')
  })

  it('reports the requested budget when one is passed explicitly', async () => {
    replyWith('{"topics":[{"name":"A"', 'length')
    const ai = new AIService({ config })

    const err = await ai
      .chatJSON([{ role: 'user', content: 'analyze' }], { maxTokens: 8192 })
      .then(() => null)
      .catch((e: unknown) => e)

    expect((err as OutputTruncatedError).message).toContain('8192')
  })

  it('does not retry a truncated response (a retry cannot fix it)', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }],
            model: 'test-model',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const ai = new AIService({ config })

    await expect(ai.chatJSON([{ role: 'user', content: 'analyze' }])).rejects.toBeInstanceOf(
      OutputTruncatedError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still parses a complete response normally', async () => {
    replyWith('{"ok":true}', 'stop')
    const ai = new AIService({ config })

    const { data } = await ai.chatJSON<{ ok: boolean }>([{ role: 'user', content: 'hi' }])
    expect(data.ok).toBe(true)
  })

  it('still reports genuine malformed JSON as InvalidJSONError', async () => {
    // Not truncated — the model simply returned prose.
    replyWith('I am sorry, I cannot do that.', 'stop')
    const ai = new AIService({ config })

    await expect(
      ai.chatJSON([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(InvalidJSONError)
  })
})
