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
  | 'QUOTA_EXCEEDED'
  | 'CONTEXT_TOO_LONG'
  | 'OUTPUT_LIMIT'
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

/**
 * The provider's account is out of credit / quota. Retrying cannot help, so
 * callers should stop automatic retries and tell the student to check their
 * provider account.
 */
export class QuotaExceededError extends AIProviderError {
  constructor(message = t('errors.aiQuotaExceeded')) {
    super(message, 'QUOTA_EXCEEDED', 429)
  }
}

/**
 * The request's *input* was too large for the model's context window. The fix
 * is a smaller request (fewer/short passages), not a retry or a larger output
 * budget.
 */
export class ContextTooLongError extends AIProviderError {
  constructor(message = t('errors.aiContextTooLong')) {
    super(message, 'CONTEXT_TOO_LONG', 400)
  }
}

/**
 * The provider rejected the requested `max_tokens`. Some models cap the output
 * budget far below the user's setting, so the request must be re-sent with a
 * smaller budget instead of the same value.
 */
export class OutputLimitError extends AIProviderError {
  constructor(message = t('errors.aiOutputLimit')) {
    super(message, 'OUTPUT_LIMIT', 400)
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

/** Provider messages that mean the plan/balance is exhausted, not throttling. */
const QUOTA_HINTS = /quota|insufficient|balance|credit|billing|payment|余额|额度|配额|欠费/i
/** Provider messages that mean the request input exceeds the context window. */
const CONTEXT_HINTS =
  /context length|context_length|maximum context|too many tokens|token.{0,20}exceed|reduce the length|上下文长度|超过.{0,6}长度|上下文超/i
/** Provider messages that mean the requested output cap was rejected. */
const OUTPUT_LIMIT_HINTS =
  /max[_\s-]?tokens|max\.? tokens|maximum.{0,20}(output|completion).{0,10}tokens?|completion tokens|输出.{0,6}上限|最大.{0,6}tokens?/i

/** Map an HTTP status code to a typed error, falling back to a generic one. */
export function errorFromStatus(status: number, message?: string): AIProviderError {
  const text = message ?? t('errors.aiHttp', { status })
  if (status === 401 || status === 403) return new AuthFailedError(text)
  if (status === 429) {
    // A 429 covers both "slow down" and "out of credit"; they need different
    // actions, so the provider's own message decides.
    return QUOTA_HINTS.test(text) ? new QuotaExceededError(text) : new RateLimitedError(text)
  }
  if (status === 408) return new TimeoutError(0)
  // 4xx request errors carry the provider's explanation; classify the ones the
  // caller can actually act on instead of a blanket "invalid request".
  if (status >= 400 && status < 500) {
    if (CONTEXT_HINTS.test(text)) return new ContextTooLongError(text)
    if (OUTPUT_LIMIT_HINTS.test(text)) return new OutputLimitError(text)
    return new AIProviderError(text, 'INVALID_REQUEST', status)
  }
  if (status >= 500) return new ProviderUnavailableError(text)
  return new AIProviderError(text, 'INVALID_REQUEST', status)
}