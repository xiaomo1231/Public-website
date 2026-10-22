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
  | 'ENDPOINT_NOT_FOUND'
  | 'CONTEXT_TOO_LONG'
  | 'OUTPUT_LIMIT'
  | 'TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'INVALID_JSON'
  | 'OUTPUT_TRUNCATED'
  | 'REASONING_EXHAUSTED'
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
  /** The provider's `Retry-After`, in ms, when it sent one (and CORS exposed it). */
  retryAfterMs?: number
  constructor(message = t('errors.aiRateLimited')) {
    super(message, 'RATE_LIMITED', 429)
  }
}

/**
 * A `Retry-After` header value (seconds, or an HTTP date) in milliseconds;
 * undefined when absent or unreadable.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  const text = value?.trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000)
  const date = Date.parse(text)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
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
 * HTTP 404: the base URL points at the wrong path, or the model does not
 * exist. A configuration problem — retrying cannot help.
 */
export class EndpointNotFoundError extends AIProviderError {
  constructor(message = t('errors.aiEndpointNotFound')) {
    super(message, 'ENDPOINT_NOT_FOUND', 404)
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
    super(
      detail ? `${t('errors.aiMalformedJson')}: ${detail}` : t('errors.aiMalformedJson'),
      'INVALID_JSON',
    )
  }
}

/**
 * Whose limit a reply was cut at: the model's own (`model`: known or learned),
 * the user's manual number (`setting`), or — in 使用模型允许的最大值 mode with
 * the model's limit still unknown — the largest budget tried (`unknown`).
 */
export interface OutputCap {
  limit: number
  by: 'model' | 'setting' | 'unknown'
}

/**
 * The model stopped because it hit the output token cap, so the content is
 * incomplete. Reported separately from `InvalidJSONError` because the fix is
 * to raise the output budget (or send less input), not to retry the parse.
 */
export class OutputTruncatedError extends AIProviderError {
  /**
   * Set when the reply was cut at the largest budget allowed: the model's own
   * output limit (`model`) or the user's setting (`setting`). Asking again
   * with more room is impossible, so the message says so.
   */
  readonly atCap?: OutputCap

  constructor(limit?: number, atCap?: OutputCap) {
    super(
      typeof limit === 'number'
        ? t('errors.aiOutputTruncated', { limit })
        : t('errors.aiOutputTruncatedGeneric'),
      'OUTPUT_TRUNCATED',
    )
    if (atCap) this.atCap = atCap
  }
}

/**
 * A thinking model spent the whole output budget on its reasoning and wrote
 * no (or almost no) answer. Not "the answer is too long": splitting the task
 * into smaller requests does not help — each part thinks just as much. The fix
 * is a larger budget, or less thinking.
 */
export class ReasoningExhaustedError extends AIProviderError {
  /** The output budget the reasoning used up. */
  readonly limit: number
  constructor(limit: number) {
    super(t('errors.aiReasoningExhausted', { limit }), 'REASONING_EXHAUSTED')
    this.limit = limit
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

/** The output-cap parameter named outright. */
const EXPLICIT_OUTPUT_LIMIT_HINTS = /max[_\s-]?(completion[_\s-]?|new[_\s-]?|output[_\s-]?)?tokens/i
/** Wording only a context-window rejection uses. */
const EXPLICIT_CONTEXT_HINTS =
  /context length|context_length|context window|maximum context|上下文/i

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
  // 402 Payment Required is always an exhausted account.
  if (status === 402) return new QuotaExceededError(message ? text : undefined)
  // The provider's own 404 body is usually an HTML page or a bare "Not Found";
  // the typed message tells the student what to check instead.
  if (status === 404) return new EndpointNotFoundError()
  // 4xx request errors carry the provider's explanation; classify the ones the
  // caller can actually act on instead of a blanket "invalid request".
  if (status >= 400 && status < 500) {
    // "max_tokens exceeds the maximum (40960)" is about the output cap, even
    // though it also reads like a context message ("tokens … exceed").
    if (EXPLICIT_OUTPUT_LIMIT_HINTS.test(text) && !EXPLICIT_CONTEXT_HINTS.test(text))
      return new OutputLimitError(text)
    if (CONTEXT_HINTS.test(text)) return new ContextTooLongError(text)
    if (OUTPUT_LIMIT_HINTS.test(text)) return new OutputLimitError(text)
    // Some providers report an empty balance as 400 / 403-ish request errors.
    if (QUOTA_HINTS.test(text)) return new QuotaExceededError(text)
    return new AIProviderError(text, 'INVALID_REQUEST', status)
  }
  if (status >= 500) return new ProviderUnavailableError(text)
  return new AIProviderError(text, 'INVALID_REQUEST', status)
}

/**
 * Map a `base_resp.status_code` error envelope (MiniMax; also sent inside
 * HTTP 200 responses) to a typed error. Codes from the provider's API
 * reference: 1000 unknown, 1001 timeout, 1002 rate limited, 1004 auth failed,
 * 1008 insufficient balance, 1013 internal, 1027 invalid output content, 1039
 * token limit exceeded, 2013 invalid parameters. Unknown codes fall back to
 * the HTTP status and the message wording.
 */
export function errorFromBaseResp(
  code: number,
  message: string | undefined,
  httpStatus: number,
): AIProviderError {
  const text = message ?? t('errors.aiProviderCode', { code })
  switch (code) {
    case 1000:
    case 1013:
      return new ProviderUnavailableError(text)
    case 1001:
      return new TimeoutError(0)
    case 1002:
      return new RateLimitedError(text)
    case 1004:
      return new AuthFailedError(text)
    case 1008:
      return new QuotaExceededError()
    case 1027:
      return new AIProviderError(text, 'INVALID_RESPONSE', httpStatus >= 400 ? httpStatus : 200)
    case 1039: {
      const typed = errorFromStatus(400, text)
      return typed.code === 'CONTEXT_TOO_LONG' ? typed : new OutputLimitError(text)
    }
    case 2013: {
      // A rejected output cap is still an output-limit problem (it is probed).
      const typed = errorFromStatus(400, text)
      if (typed.code === 'OUTPUT_LIMIT' || typed.code === 'CONTEXT_TOO_LONG') return typed
      return new AIProviderError(
        t('errors.aiInvalidParams', { detail: text }),
        'INVALID_REQUEST',
        400,
      )
    }
    default:
      return errorFromStatus(httpStatus >= 400 ? httpStatus : 400, text)
  }
}
