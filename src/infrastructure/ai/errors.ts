/**
 * Typed errors raised by the AI layer. Callers (services, UI) should catch
 * AppError subclasses for fine-grained handling.
 */
import { AppError } from '../errors/AppError'

export type AIErrorCode =
  | 'MISSING_API_KEY'
  | 'MISSING_BASE_URL'
  | 'MISSING_MODEL'
  | 'INVALID_REQUEST'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'INVALID_JSON'
  | 'ABORTED'
  | 'UNKNOWN'

export class AIProviderError extends AppError {
  readonly code: AIErrorCode
  readonly status?: number
  constructor(message: string, code: AIErrorCode, status?: number) {
    super(message, code)
    this.code = code
    if (status !== undefined) this.status = status
  }
}

export class MissingAPIKeyError extends AIProviderError {
  constructor() {
    super('API key is required. Configure it in Settings.', 'MISSING_API_KEY')
  }
}

export class AuthFailedError extends AIProviderError {
  constructor(message: string) {
    super(message, 'AUTH_FAILED', 401)
  }
}

export class RateLimitedError extends AIProviderError {
  constructor(message = 'Rate limited by AI provider') {
    super(message, 'RATE_LIMITED', 429)
  }
}

export class TimeoutError extends AIProviderError {
  constructor(ms: number) {
    super(`AI request timed out after ${ms}ms`, 'TIMEOUT')
  }
}

export class ProviderUnavailableError extends AIProviderError {
  constructor(message = 'AI provider is unavailable') {
    super(message, 'PROVIDER_UNAVAILABLE', 503)
  }
}

export class InvalidJSONError extends AIProviderError {
  constructor(detail?: string) {
    super(`AI returned malformed JSON${detail ? `: ${detail}` : ''}`, 'INVALID_JSON')
  }
}

export class AbortedError extends AIProviderError {
  constructor() {
    super('Request was cancelled', 'ABORTED')
  }
}

export function isAIError(err: unknown): err is AIProviderError {
  return err instanceof AIProviderError
}

/** Map an HTTP status code to a typed error, falling back to a generic one. */
export function errorFromStatus(status: number, message?: string): AIProviderError {
  const text = message ?? `HTTP ${status}`
  if (status === 401 || status === 403) return new AuthFailedError(text)
  if (status === 429) return new RateLimitedError(text)
  if (status === 408) return new TimeoutError(0)
  if (status >= 500) return new ProviderUnavailableError(text)
  return new AIProviderError(text, 'INVALID_REQUEST', status)
}