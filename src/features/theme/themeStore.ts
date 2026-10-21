import { create } from 'zustand'
import {
  DEFAULT_UI_STYLE,
  UI_STYLES,
  type UserTheme,
  type UserUiStyle,
} from '@/entities/user/types'
import { DEFAULT_COLOR_THEME, resolveColorTheme, type ColorThemeId } from './colorThemes'

interface ThemeState {
  resolved: 'light' | 'dark'
  preference: UserTheme
  /** Palette dimension — independent of `preference`. */
  colorTheme: ColorThemeId
  /** Interface style — independent of mode and palette. */
  uiStyle: UserUiStyle
  systemPrefersDark: boolean
}

interface ThemeActions {
  setPreference: (theme: UserTheme) => void
  setColorTheme: (theme: ColorThemeId) => void
  setUiStyle: (style: UserUiStyle) => void
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

export function resolveUiStyle(value: unknown): UserUiStyle {
  return UI_STYLES.includes(value as UserUiStyle) ? (value as UserUiStyle) : DEFAULT_UI_STYLE
}

/**
 * Paint the resolved mode, palette and interface style onto `<html>`.
 *
 * All three dimensions are applied here and nowhere else: the mode as the
 * `dark` class (plus `color-scheme` for native controls), the palette as
 * `data-color-theme` and the style as `data-ui-style`, which the CSS variable
 * blocks in `globals.css` (and the `lecture:` / `lab:` variants) key off.
 */
function applyToDom(
  resolved: 'light' | 'dark',
  colorTheme: ColorThemeId,
  uiStyle: UserUiStyle,
): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  root.dataset.colorTheme = colorTheme
  root.dataset.uiStyle = uiStyle
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  resolved: 'light',
  preference: 'system',
  colorTheme: DEFAULT_COLOR_THEME,
  uiStyle: DEFAULT_UI_STYLE,
  systemPrefersDark: false,

  setPreference(theme) {
    const sys = get().systemPrefersDark
    const resolved = resolve(theme, sys)
    applyToDom(resolved, get().colorTheme, get().uiStyle)
    set({ preference: theme, resolved })
  },

  setColorTheme(theme) {
    const next = resolveColorTheme(theme)
    applyToDom(get().resolved, next, get().uiStyle)
    set({ colorTheme: next })
  },

  setUiStyle(style) {
    const next = resolveUiStyle(style)
    applyToDom(get().resolved, get().colorTheme, next)
    set({ uiStyle: next })
  },

  syncSystem() {
    const sys = detectSystem()
    const { preference, colorTheme, uiStyle } = get()
    const resolved = resolve(preference, sys)
    applyToDom(resolved, colorTheme, uiStyle)
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
    uiStyle: DEFAULT_UI_STYLE,
    systemPrefersDark: false,
  })
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.classList.remove('dark')
    delete root.dataset.colorTheme
    delete root.dataset.uiStyle
  }
}
