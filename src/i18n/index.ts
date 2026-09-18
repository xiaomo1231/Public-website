import { useCallback } from 'react'
import { useI18nStore, getUILanguage } from './store'
import { translate } from './translate'
import type { TranslationKey } from './locales/en'
import type { TranslationParams, UILanguage } from './types'

export type { TranslationKey } from './locales/en'
export {
  DEFAULT_UI_LANGUAGE,
  LANGUAGE_LABELS,
  LOCALE_TAGS,
  UI_LANGUAGES,
  isUILanguage,
  type TranslationParams,
  type UILanguage,
} from './types'
export {
  getUILanguage,
  initUILanguage,
  readStoredUILanguage,
  resetUILanguageForTesting,
  setUILanguage,
  useI18nStore,
  UI_LANGUAGE_STORAGE_KEY,
} from './store'
export { translate, CATALOGS, resetMissingKeyWarnings } from './translate'
export {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from './format'
export { en } from './locales/en'
export { zhCN } from './locales/zh-CN'

/**
 * Imperative translation for non-React code (services, stores, repositories).
 *
 * React components must use `useTranslation()` instead, otherwise they will not
 * re-render when the language changes.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  return translate(getUILanguage(), key, params)
}

export interface UseTranslationResult {
  t: (key: TranslationKey, params?: TranslationParams) => string
  language: UILanguage
  setLanguage: (language: UILanguage) => void
}

/**
 * Subscribe a component to the current UI language. The returned `t` is
 * re-created whenever the language changes, so every translated string in the
 * component re-renders immediately on switch.
 */
export function useTranslation(): UseTranslationResult {
  const language = useI18nStore((s) => s.language)
  const setLanguage = useI18nStore((s) => s.setLanguage)

  const translateForLanguage = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(language, key, params),
    [language],
  )

  return { t: translateForLanguage, language, setLanguage }
}
