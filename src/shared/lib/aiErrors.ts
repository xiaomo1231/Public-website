import { isAppError } from '@/infrastructure/errors/AppError'
import { AIProviderError } from '@/infrastructure/ai/errors'

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
        return 'No API key configured. Open Settings → AI Settings to add one.'
      case 'MISSING_BASE_URL':
        return 'No API base URL configured. Open Settings → AI Settings to set one.'
      case 'MISSING_MODEL':
        return 'No model selected. Open Settings → AI Settings to choose one.'
      case 'AUTH_FAILED':
        return 'The API key was rejected. Check that it is correct and still active.'
      case 'RATE_LIMITED':
        return 'The AI provider is rate limiting requests. Wait a moment and try again.'
      case 'TIMEOUT':
        return 'The AI took too long to respond. Check your connection or try a smaller request.'
      case 'PROVIDER_UNAVAILABLE':
        return 'AI connection unavailable. Check your network and that the base URL is reachable.'
      case 'INVALID_JSON':
      case 'INVALID_RESPONSE':
        return 'The AI returned a response the app could not read. Try again.'
      case 'ABORTED':
        return 'The request was cancelled.'
      case 'INVALID_REQUEST':
        return err.message || 'The AI provider rejected the request.'
      default:
        return ensureUseful(err.message, 'The AI request failed. Check your AI Settings and try again.')
    }
  }
  if (isAppError(err)) {
    switch (err.code) {
      case 'NO_DOCUMENTS':
        return 'No processed documents found. Upload a document and wait for it to finish processing.'
      case 'NO_ANALYSIS':
        return 'Run Analyze Course first — the AI needs the structured course knowledge.'
      case 'NO_MISTAKES':
        return 'No mistakes to review yet. Take a quiz first.'
      case 'MALFORMED_QUIZ':
      case 'QUIZ_GENERATION_FAILED':
        return 'The AI could not produce a valid quiz. Try again or reduce the question count.'
      case 'NOT_FOUND':
        return 'That item no longer exists. It may have been deleted.'
      case 'VALIDATION_ERROR':
        return ensureUseful(err.message, 'The input was not valid.')
      default:
        return ensureUseful(err.message, 'The request failed. Please try again.')
    }
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'The request was cancelled.'
    if (/failed to fetch|networkerror|network request failed/i.test(err.message)) {
      return 'AI connection unavailable. Check your network and that the base URL is reachable.'
    }
    return ensureUseful(err.message, 'The request failed. Please try again.')
  }
  return 'The request failed. Please try again.'
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

export const OFFLINE_MESSAGE = 'AI connection unavailable. Check your network connection.'
