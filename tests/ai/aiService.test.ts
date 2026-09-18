import { describe, expect, it, vi } from 'vitest'
import { AIService } from '@/services/aiService'
import { InvalidJSONError } from '@/infrastructure/ai/errors'
import type { ProviderConfig } from '@/infrastructure/ai/types'

const config: ProviderConfig = {
  provider: 'openai',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
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

describe('AIService', () => {
  it('returns raw content via chat()', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const ai = new AIService({ config })
      const res = await ai.chat([{ role: 'user', content: 'ping' }])
      expect(res.content).toBe('hi')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('parses JSON via chatJSON and retries once on invalid response', async () => {
    // First response: not parseable. Second: valid JSON.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'not json' } }] }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '{"a":42}' } }] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const ai = new AIService({ config })
      const { data, raw } = await ai.chatJSON<{ a: number }>([{ role: 'user', content: 'q' }])
      expect(data.a).toBe(42)
      expect(raw.content).toBe('{"a":42}')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('throws InvalidJSONError after retry exhaustion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'nope' } }] }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'still nope' } }] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const ai = new AIService({ config })
      await expect(ai.chatJSON([{ role: 'user', content: 'q' }])).rejects.toBeInstanceOf(InvalidJSONError)
    } finally {
      vi.restoreAllMocks()
    }
  })
})