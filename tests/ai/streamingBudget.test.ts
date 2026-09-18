import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from '@/infrastructure/ai/openaiCompatible'
import { TimeoutError } from '@/infrastructure/ai/errors'
import { AIService } from '@/services/aiService'
import type { ProviderConfig } from '@/infrastructure/ai/types'

/**
 * A long structured generation cannot fit in a fixed total budget: producing
 * ~8k tokens can take minutes. Streaming makes the budget an *inactivity*
 * window instead, so a request stays alive as long as data keeps arriving.
 */

const config: ProviderConfig = {
  provider: 'custom',
  baseURL: 'https://example.com/v1',
  apiKey: 'sk-test-not-a-real-key',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 8192,
}

const CONNECT_MS = 10_000
const READ_MS = 60_000
const TOTAL_MS = CONNECT_MS + READ_MS

function provider(): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('custom', 'Custom', config, {
    defaultModel: 'test-model',
    supportsJsonMode: false,
  })
}

/**
 * A streaming response that emits `chunkCount` deltas `gapMs` apart, then a
 * `[DONE]` event. Each delta carries `content`.
 */
function streamingFetch(chunkCount: number, gapMs: number, content: string): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    const encoder = new TextEncoder()
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = (): void => {
          if (sent >= chunkCount) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          }
          sent += 1
          const payload = JSON.stringify({
            choices: [{ delta: { content }, finish_reason: null }],
            model: 'test-model',
          })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
          setTimeout(push, gapMs)
        }
        push()
        // A real fetch aborts the body when the signal fires; mirror that.
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.')
          err.name = 'AbortError'
          controller.error(err)
        })
      },
    })
    return Promise.resolve({
      ok: true,
      status: 200,
      body: stream,
      text: async () => '',
    } as unknown as Response)
  }) as unknown as typeof fetch
}

function streamOnce() {
  return provider().streamChat({ messages: [{ role: 'user', content: 'hi' }] }, () => undefined)
}

describe('streaming request budget', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('keeps a stream alive well past the total budget while data keeps arriving', async () => {
    // 10 chunks, 20 s apart = 200 s of generation, far beyond the 70 s budget,
    // but every individual gap is shorter than the 60 s read timeout.
    globalThis.fetch = streamingFetch(10, 20_000, 'a')

    const settled = streamOnce()
      .then((res) => res.content.length)
      .catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(210_000)

    expect(await settled).toBe(10)
  })

  it('still aborts when the stream goes silent for the read timeout', async () => {
    // One chunk, then nothing for ten minutes.
    globalThis.fetch = streamingFetch(1, 600_000, 'a')

    const settled = streamOnce()
      .then(() => null)
      .catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(TOTAL_MS + 1_000)

    expect(await settled).toBeInstanceOf(TimeoutError)
  })

  it('completes normally when the stream is quick', async () => {
    globalThis.fetch = streamingFetch(3, 10, 'x')

    const settled = streamOnce()
      .then((res) => res.content)
      .catch(() => 'rejected')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(await settled).toBe('xxx')
  })
})

describe('streamJSON', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('accumulates the stream and parses the JSON', async () => {
    const parts = ['{"ok":', 'true', '}']
    const encoder = new TextEncoder()
    let i = 0
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const part of parts) {
              const payload = JSON.stringify({
                choices: [{ delta: { content: part }, finish_reason: null }],
                model: 'test-model',
              })
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
              i += 1
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          },
        }),
        text: async () => '',
      } as unknown as Response),
    ) as unknown as typeof fetch

    const ai = new AIService({ config })
    const deltas: string[] = []
    const { data, raw } = await ai.streamJSON<{ ok: boolean }>(
      [{ role: 'user', content: 'return json' }],
      (d) => deltas.push(d),
    )

    expect(data.ok).toBe(true)
    expect(deltas.join('')).toBe('{"ok":true}')
    expect(raw.content).toBe('{"ok":true}')
    expect(i).toBe(3)
  })

  it('reports truncation instead of a parse error', async () => {
    const encoder = new TextEncoder()
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            const payload = JSON.stringify({
              choices: [{ delta: { content: '{"topics":[{"name":"A"' }, finish_reason: 'length' }],
              model: 'test-model',
            })
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          },
        }),
        text: async () => '',
      } as unknown as Response),
    ) as unknown as typeof fetch

    const ai = new AIService({ config })
    const err = await ai
      .streamJSON([{ role: 'user', content: 'analyze' }])
      .then(() => null)
      .catch((e: unknown) => e)

    expect(err).toMatchObject({ code: 'OUTPUT_TRUNCATED' })
  })
})
