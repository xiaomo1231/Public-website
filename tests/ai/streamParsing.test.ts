import { afterEach, describe, expect, it } from 'vitest'
import { OpenAICompatibleProvider } from '@/infrastructure/ai/openaiCompatible'
import { ProviderUnavailableError } from '@/infrastructure/ai/errors'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import type { ProviderConfig } from '@/infrastructure/ai/types'

const config: ProviderConfig = {
  provider: 'custom',
  baseURL: 'https://example.com/v1',
  apiKey: 'sk-test-not-a-real-key',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 512,
}

function provider(): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('custom', 'Custom', config, {
    defaultModel: 'test-model',
    supportsJsonMode: false,
  })
}

/** A streaming fetch that sends the given byte chunks, then closes (or errors). */
function bytesFetch(chunks: Uint8Array[], fail?: Error): typeof fetch {
  return (() => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        if (fail) controller.error(fail)
        else controller.close()
      },
    })
    return Promise.resolve({ ok: true, status: 200, body: stream, text: async () => '' } as unknown as Response)
  }) as unknown as typeof fetch
}

const encode = (text: string) => new TextEncoder().encode(text)
const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`

function run() {
  const deltas: string[] = []
  return {
    deltas,
    result: provider().streamChat({ messages: [{ role: 'user', content: 'hi' }] }, (chunk) => {
      if (chunk.delta) deltas.push(chunk.delta)
    }),
  }
}

describe('OpenAI-compatible stream parsing', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('parses a final event that is not followed by a blank line', async () => {
    globalThis.fetch = bytesFetch([encode(`${event('Hello')}\n\n${event(' world')}`)])
    const { result } = run()
    expect((await result).content).toBe('Hello world')
  })

  it('flushes a multi-byte character split across the last chunk', async () => {
    const bytes = encode(`${event('Hi ')}\n\n${event('生理学')}`)
    // Cut inside the last UTF-8 character so its tail arrives in the final read.
    const cut = bytes.length - 3
    globalThis.fetch = bytesFetch([bytes.slice(0, cut), bytes.slice(cut)])
    const { result } = run()
    expect((await result).content).toBe('Hi 生理学')
  })

  it('joins multi-line data fields of one event with a newline', async () => {
    const payload = JSON.stringify({ choices: [{ delta: { content: 'multi' } }] }, null, 2)
    const block = payload
      .split('\n')
      .map((line) => `data: ${line}`)
      .join('\n')
    globalThis.fetch = bytesFetch([encode(`${block}\n\n${event('-line')}\n\ndata: [DONE]\n\n`)])
    const { result } = run()
    expect((await result).content).toBe('multi-line')
  })

  it('wraps a mid-stream network failure as provider-unavailable with a friendly message', async () => {
    globalThis.fetch = bytesFetch([encode(`${event('partial')}\n\n`)], new TypeError('network error'))
    const { result } = run()
    const err = await result.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderUnavailableError)
    expect((err as ProviderUnavailableError).code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('maps a raw Chrome "network error" to the provider-unavailable hint', () => {
    expect(friendlyAIError(new TypeError('network error'))).toBe(friendlyAIError(new TypeError('Failed to fetch')))
  })
})
