/**
 * UI internationalization primitives.
 *
 * `UILanguage` is the language of the **application interface only**. It is
 * deliberately separate from the course/document language used by the AI
 * Tutor, course analysis and translation features (see
 * `CourseAnalysis.language` and `UserProfile.language`).
 */
export type { TranslationKey } from './locales/en'

export type UILanguage = 'en' | 'zh-CN'

export const UI_LANGUAGES: readonly UILanguage[] = ['en', 'zh-CN'] as const

/** BCP-47 tags handed to `Intl.*` formatters. */
export const LOCALE_TAGS: Record<UILanguage, string> = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
}

/** Native display name of each language, shown in the selector. */
export const LANGUAGE_LABELS: Record<UILanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

/** Values that can be interpolated into a translated string. */
export type TranslationParams = Record<string, string | number>

export const DEFAULT_UI_LANGUAGE: UILanguage = 'en'

export function isUILanguage(value: unknown): value is UILanguage {
  return value === 'en' || value === 'zh-CN'
}
