import { isAppError } from '@/infrastructure/errors/AppError'
import { AIProviderError } from '@/infrastructure/ai/errors'
import { t } from '@/i18n'

/**
 * Map a thrown error to a message a student can act on.
 *
 * The AI layer already produces typed errors; this converts them into
 * plain-language guidance. Never returns "Something went wrong".
 */
export function friendlyAIError(err: unknown): string {
  if (err instanceof AIProviderError) {
    switch (err.code) {
      case 'MISSING_API_KEY':
        return t('friendlyError.missingApiKey')
      case 'MISSING_BASE_URL':
        return t('friendlyError.missingBaseUrl')
      case 'MISSING_MODEL':
        return t('friendlyError.missingModel')
      case 'AUTH_FAILED':
        return t('friendlyError.authFailed')
      case 'RATE_LIMITED':
        return t('friendlyError.rateLimited')
      case 'TIMEOUT':
        return t('friendlyError.timeout')
      case 'PROVIDER_UNAVAILABLE':
        return t('friendlyError.providerUnavailable')
      case 'INVALID_JSON':
      case 'INVALID_RESPONSE':
        return t('friendlyError.invalidResponse')
      case 'OUTPUT_TRUNCATED':
        return t('friendlyError.outputTruncated')
      case 'ABORTED':
        return t('friendlyError.cancelled')
      case 'INVALID_REQUEST':
        return err.message || t('friendlyError.invalidRequest')
      default:
        return ensureUseful(err.message, t('friendlyError.requestFailed'))
    }
  }
  if (isAppError(err)) {
    switch (err.code) {
      case 'NO_DOCUMENTS':
        return t('friendlyError.noDocuments')
      case 'NO_ANALYSIS':
        return t('friendlyError.noAnalysis')
      case 'NO_MISTAKES':
        return t('errors.noMistakesToReview')
      case 'MALFORMED_QUIZ':
      case 'QUIZ_GENERATION_FAILED':
        return t('friendlyError.malformedQuiz')
      case 'NOT_FOUND':
        return t('friendlyError.notFound')
      case 'VALIDATION_ERROR':
        return ensureUseful(err.message, t('friendlyError.invalidInput'))
      default:
        return ensureUseful(err.message, t('friendlyError.generic'))
    }
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return t('friendlyError.cancelled')
    if (/failed to fetch|networkerror|network request failed/i.test(err.message)) {
      return t('friendlyError.providerUnavailable')
    }
    return ensureUseful(err.message, t('friendlyError.generic'))
  }
  return t('friendlyError.generic')
}

/**
 * Error text for the AI tutor.
 *
 * The tutor has two independent halves — the topic explanation and the practice
 * question — and the student needs to know which one failed. The generic AI
 * wording would report a missing explanation when only the question failed.
 */
export function friendlyTutorError(err: unknown): string {
  if (isAppError(err)) {
    switch (err.code) {
      case 'NO_TOPIC_CONTENT':
        return t('tutor.noContent')
      case 'EMPTY_TUTOR_RESPONSE':
        return t('tutor.emptyResponse')
      case 'MALFORMED_QUESTION':
        return t('tutor.questionUnparsable')
      default:
        break
    }
  }
  if (err instanceof AIProviderError) {
    switch (err.code) {
      case 'TIMEOUT':
        return t('tutor.timeout')
      case 'PROVIDER_UNAVAILABLE':
        return t('tutor.connectFailed')
      default:
        break
    }
  }
  return friendlyAIError(err)
}

function ensureUseful(message: string | undefined, fallback: string): string {
  const trimmed = (message ?? '').trim()
  if (trimmed.length >= 12) return trimmed
  return fallback
}

export function isOffline(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
}

/** Resolved on demand so it follows the current UI language. */
export function offlineMessage(): string {
  return t('friendlyError.offline')
}
