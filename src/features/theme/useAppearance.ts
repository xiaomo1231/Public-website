import { useCallback } from 'react'
import { DEFAULT_UI_STYLE, type UserTheme, type UserUiStyle } from '@/entities/user/types'
import { useAuthStore } from '@/features/auth/authStore'
import { logger } from '@/infrastructure/logger/logger'
import { toast } from '@/features/toast/toastStore'
import { t } from '@/i18n'
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

let uiStyleSaveSeq = 0
let uiStyleSavesInFlight = 0

/**
 * True while an interface-style switch is still being saved. The profile then
 * reports the value of an older save, so it must not be re-applied over the
 * newer choice already on screen.
 */
export function isUiStyleSavePending(): boolean {
  return uiStyleSavesInFlight > 0
}

export function useUiStyle(): {
  uiStyle: UserUiStyle
  setUiStyle: (style: UserUiStyle) => void
} {
  const uiStyle = useThemeStore((s) => s.uiStyle)
  const applyUiStyle = useThemeStore((s) => s.setUiStyle)
  const persistUiStyle = useAuthStore((s) => s.setUiStyle)

  const setUiStyle = useCallback(
    (next: UserUiStyle) => {
      applyUiStyle(next)
      const seq = ++uiStyleSaveSeq
      uiStyleSavesInFlight += 1
      void persistUiStyle(next)
        .catch((err: unknown) => {
          logger.warn('Failed to persist interface style', { uiStyle: next })
          logger.debug('Interface style persistence error', { error: String(err) })
          // Only the latest switch decides what is shown; an older failed save
          // has already been superseded.
          if (seq !== uiStyleSaveSeq) return
          applyUiStyle(useAuthStore.getState().profile?.uiStyle ?? DEFAULT_UI_STYLE)
          toast({ variant: 'error', title: t('theme.uiStyleSaveFailed') })
        })
        .finally(() => {
          uiStyleSavesInFlight -= 1
        })
    },
    [applyUiStyle, persistUiStyle],
  )

  return { uiStyle, setUiStyle }
}
