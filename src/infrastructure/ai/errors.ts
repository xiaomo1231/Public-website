/**
 * Typed errors raised by the AI layer. Callers (services, UI) should catch
 * AppError subclasses for fine-grained handling.
 */
import { AppError } from '../errors/AppError'
import { t } from '@/i18n'

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
  | 'OUTPUT_TRUNCATED'
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
    super(t('errors.aiKeyRequired'), 'MISSING_API_KEY')
  }
}

export class AuthFailedError extends AIProviderError {
  constructor(message: string) {
    super(message, 'AUTH_FAILED', 401)
  }
}

export class RateLimitedError extends AIProviderError {
  constructor(message = t('errors.aiRateLimited')) {
    super(message, 'RATE_LIMITED', 429)
  }
}

export class TimeoutError extends AIProviderError {
  constructor(ms: number) {
    super(`AI request timed out after ${ms}ms`, 'TIMEOUT')
  }
}

export class ProviderUnavailableError extends AIProviderError {
  constructor(message = t('errors.aiUnavailable')) {
    super(message, 'PROVIDER_UNAVAILABLE', 503)
  }
}

export class InvalidJSONError extends AIProviderError {
  constructor(detail?: string) {
    super(detail ? `${t('errors.aiMalformedJson')}: ${detail}` : t('errors.aiMalformedJson'), 'INVALID_JSON')
  }
}

/**
 * The model stopped because it hit the output token cap, so the content is
 * incomplete. Reported separately from `InvalidJSONError` because the fix is
 * to raise the output budget (or send less input), not to retry the parse.
 */
export class OutputTruncatedError extends AIProviderError {
  constructor(limit?: number) {
    super(
      typeof limit === 'number'
        ? t('errors.aiOutputTruncated', { limit })
        : t('errors.aiOutputTruncatedGeneric'),
      'OUTPUT_TRUNCATED',
    )
  }
}

export class AbortedError extends AIProviderError {
  constructor() {
    super(t('errors.aiCancelled'), 'ABORTED')
  }
}

export function isAIError(err: unknown): err is AIProviderError {
  return err instanceof AIProviderError
}

/** Map an HTTP status code to a typed error, falling back to a generic one. */
export function errorFromStatus(status: number, message?: string): AIProviderError {
  const text = message ?? t('errors.aiHttp', { status })
  if (status === 401 || status === 403) return new AuthFailedError(text)
  if (status === 429) return new RateLimitedError(text)
  if (status === 408) return new TimeoutError(0)
  if (status >= 500) return new ProviderUnavailableError(text)
  return new AIProviderError(text, 'INVALID_REQUEST', status)
}