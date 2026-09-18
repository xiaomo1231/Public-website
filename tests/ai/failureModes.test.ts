import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from '@/infrastructure/ai/openaiCompatible'
import { ensureConfig } from '@/infrastructure/ai/types'
import {
  AIProviderError,
  MissingAPIKeyError,
  TimeoutError,
} from '@/infrastructure/ai/errors'
import { AIService } from '@/services/aiService'
import type { ProviderConfig } from '@/infrastructure/ai/types'

const baseConfig: ProviderConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-test',
  temperature: 0.5,
  maxTokens: 256,
}

const originalFetch = globalThis.fetch
let mockFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockFetch = vi.fn()
  globalThis.fetch = mockFetch as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('ensureConfig validation', () => {
  it('rejects a missing API key', () => {
    expect(() => ensureConfig({ ...baseConfig, apiKey: '' })).toThrow(MissingAPIKeyError)
  })
  it('rejects a missing base URL', () => {
    expect(() => ensureConfig({ ...baseConfig, baseURL: '' })).toThrow(/base URL/i)
  })
  it('rejects a missing model', () => {
    expect(() => ensureConfig({ ...baseConfig, model: '' })).toThrow(/model/i)
  })
})

describe('Provider failure modes', () => {
  it('surfaces timeout as TimeoutError when fetch aborts', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    mockFetch.mockImplementation(() => {
      throw abortError
    })
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', baseConfig, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
      connectTimeoutMs: 5,
      readTimeoutMs: 5,
    })
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(TimeoutError)
  })

  it('surfaces rate limiting', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'rate limit exceeded' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', baseConfig, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('surfaces auth failure', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', baseConfig, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('surfaces provider unavailable', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Service Unavailable', { status: 503 }),
    )
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', baseConfig, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('handles malformed non-JSON responses gracefully', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 200 }))
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', baseConfig, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(AIProviderError)
  })

  it('AIService.chatJSON rejects when both attempts are unparseable', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'nope' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'still nope' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const ai = new AIService({ config: baseConfig })
    await expect(ai.chatJSON([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
      code: 'INVALID_JSON',
    })
  })

  it('testConnection returns error info without throwing on 500', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', baseConfig, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    const res = await provider.testConnection()
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })
})