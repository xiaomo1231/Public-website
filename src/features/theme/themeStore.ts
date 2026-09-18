import { create } from 'zustand'
import type { UserTheme } from '@/entities/user/types'

interface ThemeState {
  resolved: 'light' | 'dark'
  preference: UserTheme
  systemPrefersDark: boolean
}

interface ThemeActions {
  setPreference: (theme: UserTheme) => void
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

function applyToDom(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  resolved: 'light',
  preference: 'system',
  systemPrefersDark: false,

  setPreference(theme) {
    const sys = get().systemPrefersDark
    const resolved = resolve(theme, sys)
    applyToDom(resolved)
    set({ preference: theme, resolved })
  },

  syncSystem() {
    const sys = detectSystem()
    const { preference } = get()
    const resolved = resolve(preference, sys)
    applyToDom(resolved)
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