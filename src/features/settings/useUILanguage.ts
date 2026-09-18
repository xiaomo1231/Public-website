import { useCallback } from 'react'
import { useTranslation, type UILanguage } from '@/i18n'
import { useAuthStore } from '@/features/auth/authStore'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Reads and changes the **interface** language.
 *
 * Changing it applies immediately (so the UI re-renders at once) and is then
 * persisted to the local user profile. A persistence failure is logged but
 * never blocks the switch — the interface stays usable and the choice is still
 * mirrored to `localStorage`.
 */
export function useUILanguage(): {
  language: UILanguage
  setLanguage: (language: UILanguage) => void
} {
  const { language, setLanguage: applyLanguage } = useTranslation()
  const setProfileUILanguage = useAuthStore((s) => s.setUILanguage)

  const setLanguage = useCallback(
    (next: UILanguage) => {
      applyLanguage(next)
      void setProfileUILanguage(next).catch((err: unknown) => {
        logger.warn('Failed to persist UI language', { language: next })
        logger.debug('UI language persistence error', { error: String(err) })
      })
    },
    [applyLanguage, setProfileUILanguage],
  )

  return { language, setLanguage }
}
