/**
 * Application-wide configuration constants.
 *
 * IMPORTANT: never put secrets here. Use environment variables or local storage.
 */

export const APP_NAME = 'AI Learning Platform'
export const APP_VERSION = '1.1.0'

export const DB_NAME = 'ai-learning-platform'

export const MAX_PROJECT_NAME_LENGTH = 80
export const MIN_PROJECT_NAME_LENGTH = 1

export const DEFAULT_THEME = 'system' as const

/**
 * Default invite codes, seeded into IndexedDB the first time the store is
 * empty (see `InviteService.ensureSeeded`).
 *
 * These are checked client-side only — there is no remote validation, and
 * anyone with access to this build can read them. The invite system is an
 * access gate for a local-first app, not authentication.
 *
 * There is no UI for managing codes; change this list and clear the app's
 * IndexedDB to reseed.
 */
export const SEED_INVITE_CODES: ReadonlyArray<string> = [
  'WELCOME-LEARN',
  'STUDENT-2026',
]

export const TOAST_LIMIT = 5
export const TOAST_DEFAULT_DURATION = 4000