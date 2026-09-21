import { create } from 'zustand'
import type { UserTheme } from '@/entities/user/types'
import {
  DEFAULT_COLOR_THEME,
  resolveColorTheme,
  type ColorThemeId,
} from './colorThemes'

interface ThemeState {
  resolved: 'light' | 'dark'
  preference: UserTheme
  /** Palette dimension — independent of `preference`. */
  colorTheme: ColorThemeId
  systemPrefersDark: boolean
}

interface ThemeActions {
  setPreference: (theme: UserTheme) => void
  setColorTheme: (theme: ColorThemeId) => void
  syncSystem: () => void
  apply: (theme: UserTheme) => void
}

export type ThemeStore = ThemeState & ThemeActions

function detectSystem(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(preference: UserTheme, systemDark: boolean): 'light' | 'dark' {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

/**
 * Paint the resolved mode and palette onto `<html>`.
 *
 * Both dimensions are applied here and nowhere else: the mode as the `dark`
 * class (plus `color-scheme` for native controls) and the palette as
 * `data-color-theme`, which the CSS variable blocks in `globals.css` key off.
 */
function applyToDom(resolved: 'light' | 'dark', colorTheme: ColorThemeId): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  root.dataset.colorTheme = colorTheme
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  resolved: 'light',
  preference: 'system',
  colorTheme: DEFAULT_COLOR_THEME,
  systemPrefersDark: false,

  setPreference(theme) {
    const sys = get().systemPrefersDark
    const resolved = resolve(theme, sys)
    applyToDom(resolved, get().colorTheme)
    set({ preference: theme, resolved })
  },

  setColorTheme(theme) {
    const next = resolveColorTheme(theme)
    applyToDom(get().resolved, next)
    set({ colorTheme: next })
  },

  syncSystem() {
    const sys = detectSystem()
    const { preference, colorTheme } = get()
    const resolved = resolve(preference, sys)
    applyToDom(resolved, colorTheme)
    set({ systemPrefersDark: sys, resolved })
  },

  apply(theme) {
    get().setPreference(theme)
  },
}))

let mql: MediaQueryList | null = null
let onChange: (() => void) | null = null

export function initThemeListener(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
  mql = window.matchMedia('(prefers-color-scheme: dark)')
  useThemeStore.getState().syncSystem()
  onChange = () => useThemeStore.getState().syncSystem()
  mql.addEventListener('change', onChange)
  return () => {
    if (mql && onChange) mql.removeEventListener('change', onChange)
    mql = null
    onChange = null
  }
}

/** Test helper — clears the DOM attributes and returns to the defaults. */
export function resetThemeForTesting(): void {
  useThemeStore.setState({
    resolved: 'light',
    preference: 'system',
    colorTheme: DEFAULT_COLOR_THEME,
    systemPrefersDark: false,
  })
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.classList.remove('dark')
    delete root.dataset.colorTheme
  }
}
