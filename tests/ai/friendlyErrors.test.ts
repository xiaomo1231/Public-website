import { describe, expect, it } from 'vitest'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import {
  AIProviderError,
  AuthFailedError,
  InvalidJSONError,
  MissingAPIKeyError,
  ProviderUnavailableError,
  RateLimitedError,
  TimeoutError,
} from '@/infrastructure/ai/errors'
import { AppError } from '@/infrastructure/errors/AppError'

describe('friendlyAIError', () => {
  it('guides the user when no API key is configured', () => {
    expect(friendlyAIError(new MissingAPIKeyError())).toMatch(/Settings/i)
  })

  it('explains an invalid API key', () => {
    expect(friendlyAIError(new AuthFailedError('bad key'))).toMatch(/rejected|correct/i)
  })

  it('explains rate limiting', () => {
    expect(friendlyAIError(new RateLimitedError())).toMatch(/rate limit|wait/i)
  })

  it('explains a timeout', () => {
    expect(friendlyAIError(new TimeoutError(5000))).toMatch(/too long|connection/i)
  })

  it('explains provider unavailability', () => {
    expect(friendlyAIError(new ProviderUnavailableError())).toMatch(/unavailable|network/i)
  })

  it('explains malformed JSON', () => {
    expect(friendlyAIError(new InvalidJSONError())).toMatch(/could not read|try again/i)
  })

  it('maps app-level codes to guidance', () => {
    expect(friendlyAIError(new AppError('x', 'NO_DOCUMENTS'))).toMatch(/upload/i)
    expect(friendlyAIError(new AppError('x', 'NO_ANALYSIS'))).toMatch(/Analyze Course/i)
    expect(friendlyAIError(new AppError('x', 'NO_MISTAKES'))).toMatch(/take a quiz/i)
    expect(friendlyAIError(new AppError('x', 'QUIZ_GENERATION_FAILED'))).toMatch(/valid quiz/i)
  })

  it('recognises browser network errors', () => {
    expect(friendlyAIError(new TypeError('Failed to fetch'))).toMatch(/unavailable|network/i)
  })

  it('recognises abort errors', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(friendlyAIError(err)).toMatch(/cancelled/i)
  })

  it('never returns a generic "something went wrong" message', () => {
    const messages = [
      friendlyAIError(new MissingAPIKeyError()),
      friendlyAIError(new AuthFailedError('x')),
      friendlyAIError(new RateLimitedError()),
      friendlyAIError(new TimeoutError(1)),
      friendlyAIError(new ProviderUnavailableError()),
      friendlyAIError(new InvalidJSONError()),
      friendlyAIError(new AIProviderError('custom', 'UNKNOWN')),
      friendlyAIError(new AppError('x', 'NO_DOCUMENTS')),
      friendlyAIError(null),
    ]
    for (const m of messages) {
      expect(m.toLowerCase()).not.toContain('something went wrong')
      expect(m.length).toBeGreaterThan(10)
    }
  })
})
