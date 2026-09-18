import { describe, expect, it } from 'vitest'
import { extractJSON, parseSSE } from '@/infrastructure/ai'
import {
  AIProviderError,
  AuthFailedError,
  InvalidJSONError,
  ProviderUnavailableError,
  RateLimitedError,
  TimeoutError,
  errorFromStatus,
  isAIError,
} from '@/infrastructure/ai/errors'

describe('errorFromStatus', () => {
  it('maps 401/403 to AuthFailedError', () => {
    expect(errorFromStatus(401, 'no')).toBeInstanceOf(AuthFailedError)
    expect(errorFromStatus(403, 'no')).toBeInstanceOf(AuthFailedError)
  })
  it('maps 429 to RateLimitedError', () => {
    expect(errorFromStatus(429)).toBeInstanceOf(RateLimitedError)
  })
  it('maps 5xx to ProviderUnavailableError', () => {
    expect(errorFromStatus(500)).toBeInstanceOf(ProviderUnavailableError)
    expect(errorFromStatus(503, 'down')).toBeInstanceOf(ProviderUnavailableError)
  })
  it('maps 408 to TimeoutError', () => {
    expect(errorFromStatus(408)).toBeInstanceOf(TimeoutError)
  })
  it('falls back to AIProviderError', () => {
    expect(errorFromStatus(418, 'teapot')).toBeInstanceOf(AIProviderError)
  })
  it('isAIError narrows', () => {
    expect(isAIError(new InvalidJSONError())).toBe(true)
    expect(isAIError(new Error('plain'))).toBe(false)
  })
})

describe('extractJSON', () => {
  it('parses plain JSON', () => {
    expect(extractJSON<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })
  it('strips ```json fences', () => {
    expect(extractJSON<{ a: number }>('```json\n{"a":2}\n```')).toEqual({ a: 2 })
  })
  it('extracts JSON embedded in prose', () => {
    expect(extractJSON<{ a: number }>('Sure! {"a":3} cheers')).toEqual({ a: 3 })
  })
  it('throws InvalidJSONError on garbage', () => {
    expect(() => extractJSON('not json')).toThrow(InvalidJSONError)
  })
  it('throws InvalidJSONError on empty string', () => {
    expect(() => extractJSON('')).toThrow(InvalidJSONError)
  })
})

describe('parseSSE', () => {
  function makeStream(text: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    const chunk = encoder.encode(text)
    return new ReadableStream({
      start(controller) {
        controller.enqueue(chunk)
        controller.close()
      },
    })
  }

  it('yields data events from a SSE response', async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
      'data: [DONE]\n\n'
    const events: string[] = []
    for await (const ev of parseSSE(makeStream(body))) events.push(ev.data)
    expect(events).toEqual([
      '{"choices":[{"delta":{"content":"hello"}}]}',
      '{"choices":[{"delta":{"content":" world"}}]}',
      '[DONE]',
    ])
  })

  it('tolerates CRLF separators', async () => {
    const body = 'data: {"x":1}\r\n\r\ndata: {"x":2}\r\n\r\n'
    const events: string[] = []
    for await (const ev of parseSSE(makeStream(body))) events.push(ev.data)
    expect(events).toEqual(['{"x":1}', '{"x":2}'])
  })
})

describe('AIProviderError', () => {
  it('preserves status and code', () => {
    const e = new AIProviderError('boom', 'AUTH_FAILED', 401)
    expect(e.code).toBe('AUTH_FAILED')
    expect(e.status).toBe(401)
    expect(e.message).toBe('boom')
  })
})