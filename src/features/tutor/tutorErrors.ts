import { AIProviderError, type AIErrorCode } from '@/infrastructure/ai/errors'
import { friendlyTutorError } from '@/shared/lib/aiErrors'
import { t } from '@/i18n'

/**
 * A tutor error the page can act on: the plain-language cause, plus whether
 * the fix lives in Settings (so the notice offers "Open settings" next to
 * "Try again").
 */
export interface TutorErrorInfo {
  message: string
  needsSettings: boolean
}

/** Provider errors only the student's AI configuration can fix. */
const SETTINGS_CODES: ReadonlySet<AIErrorCode> = new Set<AIErrorCode>([
  'MISSING_API_KEY',
  'MISSING_BASE_URL',
  'MISSING_MODEL',
  'AUTH_FAILED',
  'QUOTA_EXCEEDED',
  'ENDPOINT_NOT_FOUND',
  'OUTPUT_LIMIT',
  'INVALID_REQUEST',
])

export function tutorErrorInfo(err: unknown): TutorErrorInfo {
  return {
    message: friendlyTutorError(err),
    needsSettings: err instanceof AIProviderError && SETTINGS_CODES.has(err.code),
  }
}

/** No AI provider configured: generation is impossible until Settings is filled in. */
export function noProviderInfo(): TutorErrorInfo {
  return { message: t('tutor.noProvider'), needsSettings: true }
}
