import { AIProviderError } from '@/infrastructure/ai/errors'

/**
 * Classify a homework AI failure into the action it actually needs.
 *
 * The analyzer and per-question generation must react differently to the same
 * thrown error: a context overflow means "split the batch", a rejected output
 * cap means "retry with a smaller budget", a truncation means "retry with a
 * larger budget", while a rate limit is retried once and an exhausted account
 * stops all further requests.
 */
export type HomeworkErrorKind =
  | 'context-too-long'
  | 'output-limit'
  | 'truncated'
  | 'quota'
  | 'rate-limited'
  | 'timeout'
  | 'auth'
  | 'unavailable'
  | 'invalid-response'
  | 'cancelled'
  | 'request'
  | 'unknown'

export function classifyHomeworkError(err: unknown): HomeworkErrorKind {
  if (err instanceof AIProviderError) {
    switch (err.code) {
      case 'CONTEXT_TOO_LONG':
        return 'context-too-long'
      case 'OUTPUT_LIMIT':
        return 'output-limit'
      case 'OUTPUT_TRUNCATED':
        return 'truncated'
      case 'QUOTA_EXCEEDED':
        return 'quota'
      case 'RATE_LIMITED':
        return 'rate-limited'
      case 'TIMEOUT':
        return 'timeout'
      case 'AUTH_FAILED':
      case 'MISSING_API_KEY':
      case 'MISSING_BASE_URL':
      case 'MISSING_MODEL':
        return 'auth'
      case 'PROVIDER_UNAVAILABLE':
        return 'unavailable'
      case 'INVALID_JSON':
      case 'INVALID_RESPONSE':
        return 'invalid-response'
      case 'ABORTED':
        return 'cancelled'
      case 'INVALID_REQUEST':
      case 'UNKNOWN':
      default:
        return 'request'
    }
  }
  return 'unknown'
}

/** Transient failures worth one bounded retry (never hammering the provider). */
export function isRetryableHomeworkError(kind: HomeworkErrorKind): boolean {
  return kind === 'rate-limited' || kind === 'timeout' || kind === 'unavailable'
}

/**
 * Failures that make further requests pointless until the user acts: the
 * account has no credit, or the credentials are rejected. Scheduling more work
 * would only waste the student's time.
 */
export function isAccountFatalError(kind: HomeworkErrorKind): boolean {
  return kind === 'quota' || kind === 'auth'
}
