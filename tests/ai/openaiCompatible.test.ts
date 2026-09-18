import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from '@/infrastructure/ai/openaiCompatible'
import { ProviderUnavailableError, RateLimitedError } from '@/infrastructure/ai/errors'
import type { ProviderConfig } from '@/infrastructure/ai/types'

const config: ProviderConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-test',
  temperature: 0.5,
  maxTokens: 256,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
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

describe('OpenAICompatibleProvider', () => {
  it('POSTs to /chat/completions with expected body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        model: 'gpt-test',
      }),
    )
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    const res = await provider.chat({
      messages: [{ role: 'user', content: 'ping' }],
      temperature: 0.2,
      maxTokens: 32,
    })
    expect(res.content).toBe('hi')
    expect(res.usage?.totalTokens).toBe(7)
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    const body = JSON.parse((init.body as string))
    expect(body.model).toBe('gpt-test')
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(32)
    expect(body.stream).toBe(false)
  })

  it('adds response_format when supportsJsonMode', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '{}' } }] }))
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    await provider.chat({ messages: [{ role: 'user', content: 'ping' }], responseFormat: { type: 'json_object' } })
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('does not add response_format when supportsJsonMode=false', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '{}' } }] }))
    const provider = new OpenAICompatibleProvider('deepseek', 'DeepSeek', config, {
      defaultModel: 'deepseek-chat',
      supportsJsonMode: false,
    })
    await provider.chat({ messages: [{ role: 'user', content: 'ping' }], responseFormat: { type: 'json_object' } })
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.response_format).toBeUndefined()
  })

  it('maps HTTP 429 to RateLimitedError', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(429, { error: { message: 'slow down' } }))
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    await expect(provider.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('maps HTTP 503 to ProviderUnavailableError', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(503, { error: { message: 'down' } }))
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    await expect(provider.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toBeInstanceOf(ProviderUnavailableError)
  })

  it('streams SSE and accumulates delta', async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
      'data: [DONE]\n\n'
    mockFetch.mockResolvedValueOnce(sseResponse(body))
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    const deltas: string[] = []
    const res = await provider.streamChat(
      { messages: [{ role: 'user', content: 'hi' }] },
      (chunk) => deltas.push(chunk.delta),
    )
    expect(res.content).toBe('hello world')
    expect(deltas.join('')).toBe('hello world')
  })

  it('reports failure on network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network down'))
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    const test = await provider.testConnection()
    expect(test.ok).toBe(false)
    expect(test.error).toMatch(/Network|down/i)
  })

  it('testConnection succeeds on 2xx', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'pong' } }] }))
    const provider = new OpenAICompatibleProvider('openai', 'OpenAI', config, {
      defaultModel: 'gpt-test',
      supportsJsonMode: true,
    })
    const test = await provider.testConnection()
    expect(test.ok).toBe(true)
    expect(test.model).toBe('gpt-test')
    expect(test.latencyMs).toBeGreaterThanOrEqual(0)
  })
})