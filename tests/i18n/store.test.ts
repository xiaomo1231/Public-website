import { beforeEach, describe, expect, it } from 'vitest'
import {
  getUILanguage,
  initUILanguage,
  readStoredUILanguage,
  resetUILanguageForTesting,
  setUILanguage,
  UI_LANGUAGE_STORAGE_KEY,
  useI18nStore,
} from '@/i18n/store'
import { translate } from '@/i18n/translate'
import { DEFAULT_UI_LANGUAGE } from '@/i18n/types'

describe('UI language store', () => {
  beforeEach(() => {
    resetUILanguageForTesting()
  })

  it('defaults to English on first launch', () => {
    expect(DEFAULT_UI_LANGUAGE).toBe('en')
    expect(getUILanguage()).toBe('en')
    expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBeNull()
  })

  it('switches language immediately', () => {
    setUILanguage('zh-CN')
    expect(getUILanguage()).toBe('zh-CN')
    expect(translate(getUILanguage(), 'nav.settings')).toBe('设置')

    setUILanguage('en')
    expect(getUILanguage()).toBe('en')
    expect(translate(getUILanguage(), 'nav.settings')).toBe('Settings')
  })

  it('persists the choice to localStorage', () => {
    setUILanguage('zh-CN')
    expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe('zh-CN')

    setUILanguage('en')
    expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe('en')
  })

  it('restores the persisted choice on boot (simulated reload)', () => {
    setUILanguage('zh-CN')
    // A fresh page load reads the mirror synchronously, before IndexedDB opens.
    expect(readStoredUILanguage()).toBe('zh-CN')
    expect(initUILanguage()).toBe('zh-CN')
  })

  it('ignores a corrupt stored value and falls back to English', () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'klingon')
    expect(readStoredUILanguage()).toBe('en')
  })

  it('applies the language to <html lang>', () => {
    setUILanguage('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
    setUILanguage('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('syncFromProfile adopts the persisted profile value', () => {
    useI18nStore.getState().syncFromProfile('zh-CN')
    expect(getUILanguage()).toBe('zh-CN')
    expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe('zh-CN')
  })

  it('is a no-op when setting the language already in use', () => {
    const before = useI18nStore.getState().language
    setUILanguage(before)
    expect(useI18nStore.getState().language).toBe(before)
  })

  it('notifies subscribers so React components can re-render', () => {
    const seen: string[] = []
    const unsubscribe = useI18nStore.subscribe((state) => seen.push(state.language))
    setUILanguage('zh-CN')
    setUILanguage('en')
    unsubscribe()
    expect(seen).toEqual(['zh-CN', 'en'])
  })
})
