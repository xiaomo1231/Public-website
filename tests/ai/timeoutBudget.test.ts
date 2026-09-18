import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from '@/infrastructure/ai/openaiCompatible'
import { AbortedError, TimeoutError } from '@/infrastructure/ai/errors'
import type { ProviderConfig } from '@/infrastructure/ai/types'

/**
 * Regression tests for the request time budget.
 *
 * The provider used to abort every request 10 s after it was sent, because the
 * connect timeout was applied to the whole wait for response headers. A large
 * analysis prompt legitimately needs longer than that, so healthy requests were
 * reported as "the AI took too long".
 */

const config: ProviderConfig = {
  provider: 'custom',
  baseURL: 'https://example.com/v1',
  apiKey: 'sk-test-not-a-real-key',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 2048,
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

/** A `fetch` that answers successfully after `delayMs`. */
function slowFetch(delayMs: number, onAbort?: () => void): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    return new Promise((resolve, reject) => {
      const signal = init?.signal
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"ok":true}' } }],
            model: 'test-model',
          }),
          text: async () => '',
        } as unknown as Response)
      }, delayMs)

      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        onAbort?.()
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        reject(err)
      })
    })
  }) as unknown as typeof fetch
}

function chat() {
  return provider().chat({ messages: [{ role: 'user', content: 'hello' }] })
}

describe('AI request time budget', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('allows a response slower than the connect timeout', async () => {
    globalThis.fetch = slowFetch(15_000)

    const settled = chat()
      .then((r) => r.content)
      .catch(() => 'rejected')

    await vi.advanceTimersByTimeAsync(16_000)

    expect(await settled).toBe('{"ok":true}')
  })

  it('allows a response that takes most of the read budget', async () => {
    globalThis.fetch = slowFetch(READ_MS - 1_000)

    const settled = chat()
      .then((r) => r.content)
      .catch(() => 'rejected')

    await vi.advanceTimersByTimeAsync(READ_MS)

    expect(await settled).toBe('{"ok":true}')
  })

  it('enforces the overall budget once it is genuinely exceeded', async () => {
    let aborted = false
    globalThis.fetch = slowFetch(TOTAL_MS * 10, () => {
      aborted = true
    })

    const settled = chat()
      .then(() => null)
      .catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(TOTAL_MS + 1)
    const err = await settled

    expect(err).toBeInstanceOf(TimeoutError)
    expect((err as TimeoutError).message).toContain(String(TOTAL_MS))
    expect(aborted).toBe(true)
  })

  it('still honours caller cancellation', async () => {
    globalThis.fetch = slowFetch(15_000)
    const ctrl = new AbortController()

    const settled = provider()
      .chat({ messages: [{ role: 'user', content: 'hello' }], signal: ctrl.signal })
      .then(() => null)
      .catch((err: unknown) => err)

    await vi.advanceTimersByTimeAsync(1_000)
    ctrl.abort()

    expect(await settled).toBeInstanceOf(AbortedError)
  })

  it('succeeds immediately for a fast response', async () => {
    globalThis.fetch = slowFetch(2_000)

    const settled = chat()
      .then((r) => r.content)
      .catch(() => 'rejected')

    await vi.advanceTimersByTimeAsync(3_000)

    expect(await settled).toBe('{"ok":true}')
  })

  it('does not leave a timer behind after a successful request', async () => {
    globalThis.fetch = slowFetch(1_000)

    const settled = chat()
      .then((r) => r.content)
      .catch(() => 'rejected')
    await vi.advanceTimersByTimeAsync(2_000)
    await settled

    // If the budget timer leaked, this would fire an abort on a settled request.
    expect(vi.getTimerCount()).toBe(0)
  })
})
