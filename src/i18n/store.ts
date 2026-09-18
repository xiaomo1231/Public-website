import { create } from 'zustand'
import { DEFAULT_UI_LANGUAGE, isUILanguage, type UILanguage } from './types'

const STORAGE_KEY = 'ai-learning:ui-language'

/**
 * The UI language is mirrored to `localStorage` so the correct language can be
 * applied synchronously on the very first render — before IndexedDB opens and
 * the user profile is read. The authoritative copy lives on the user profile
 * (`UserProfile.uiLanguage`) in IndexedDB; this mirror only prevents a flash of
 * the wrong language at boot.
 */
export function readStoredUILanguage(): UILanguage {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_UI_LANGUAGE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isUILanguage(raw) ? raw : DEFAULT_UI_LANGUAGE
  } catch {
    return DEFAULT_UI_LANGUAGE
  }
}

function writeStored(language: UILanguage): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, language)
  } catch {
    /* storage unavailable (private mode) — the in-memory value still works */
  }
}

function applyToDom(language: UILanguage): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
}

interface I18nState {
  language: UILanguage
}

interface I18nActions {
  setLanguage: (language: UILanguage) => void
  /** Apply a language coming from the persisted profile without re-persisting. */
  syncFromProfile: (language: UILanguage) => void
}

export type I18nStore = I18nState & I18nActions

export const useI18nStore = create<I18nStore>((set, get) => ({
  language: readStoredUILanguage(),

  setLanguage(language) {
    if (get().language === language) return
    applyToDom(language)
    writeStored(language)
    set({ language })
  },

  syncFromProfile(language) {
    if (get().language === language) return
    applyToDom(language)
    writeStored(language)
    set({ language })
  },
}))

/** Non-reactive read for use inside services and formatters. */
export function getUILanguage(): UILanguage {
  return useI18nStore.getState().language
}

export function setUILanguage(language: UILanguage): void {
  useI18nStore.getState().setLanguage(language)
}

/** Applies the current language to `<html lang>` — call once at boot. */
export function initUILanguage(): UILanguage {
  const language = getUILanguage()
  applyToDom(language)
  return language
}

/** Test helper — clears the persisted mirror and returns to the default. */
export function resetUILanguageForTesting(): void {
  try {
    window.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  useI18nStore.setState({ language: DEFAULT_UI_LANGUAGE })
  applyToDom(DEFAULT_UI_LANGUAGE)
}

export { STORAGE_KEY as UI_LANGUAGE_STORAGE_KEY }
