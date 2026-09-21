import { useCallback } from 'react'
import type { UserTheme } from '@/entities/user/types'
import { useAuthStore } from '@/features/auth/authStore'
import { logger } from '@/infrastructure/logger/logger'
import { useThemeStore } from './themeStore'
import { resolveColorTheme, type ColorThemeId } from './colorThemes'

/**
 * Appearance preferences.
 *
 * The two dimensions are deliberately separate:
 *   - `useThemePreference` — Light / Dark / System (the *mode*)
 *   - `useColorTheme`      — the palette (Default / Pink Aqua / …)
 *
 * Both apply to the DOM immediately (so the UI repaints at once) and are then
 * persisted to the local user profile. A persistence failure is logged but
 * never blocks the switch.
 */

export function useThemePreference(): {
  preference: UserTheme
  setPreference: (theme: UserTheme) => void
} {
  const preference = useThemeStore((s) => s.preference)
  const applyPreference = useThemeStore((s) => s.setPreference)
  const persistPreference = useAuthStore((s) => s.setTheme)

  const setPreference = useCallback(
    (next: UserTheme) => {
      applyPreference(next)
      void persistPreference(next).catch((err: unknown) => {
        logger.warn('Failed to persist theme preference', { preference: next })
        logger.debug('Theme preference persistence error', { error: String(err) })
      })
    },
    [applyPreference, persistPreference],
  )

  return { preference, setPreference }
}

export function useColorTheme(): {
  colorTheme: ColorThemeId
  setColorTheme: (theme: ColorThemeId) => void
} {
  const colorTheme = useThemeStore((s) => s.colorTheme)
  const applyColorTheme = useThemeStore((s) => s.setColorTheme)
  const persistColorTheme = useAuthStore((s) => s.setColorTheme)

  const setColorTheme = useCallback(
    (next: ColorThemeId) => {
      const resolved = resolveColorTheme(next)
      applyColorTheme(resolved)
      void persistColorTheme(resolved).catch((err: unknown) => {
        logger.warn('Failed to persist color theme', { colorTheme: resolved })
        logger.debug('Color theme persistence error', { error: String(err) })
      })
    },
    [applyColorTheme, persistColorTheme],
  )

  return { colorTheme, setColorTheme }
}
