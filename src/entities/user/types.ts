import type { UILanguage } from '@/i18n/types'

export type UserLanguage = 'auto' | 'zh' | 'en'

/**
 * Language of generated questions, explanations of mistakes and tutor
 * questions: Chinese with key terms in English (the default — Chinese students
 * often study from English textbooks), the textbook's own language, or English.
 */
export type QuestionLanguage = 'zh_terms' | 'source' | 'en'

export const QUESTION_LANGUAGES: QuestionLanguage[] = ['zh_terms', 'source', 'en']
export const DEFAULT_QUESTION_LANGUAGE: QuestionLanguage = 'zh_terms'

/** The concrete language for content when the preference follows the textbook. */
export function resolveContentLanguage(
  preference: QuestionLanguage | undefined,
  sourceLanguage: 'zh' | 'en' | 'mixed',
): 'zh' | 'en' | 'mixed' {
  const choice = preference ?? DEFAULT_QUESTION_LANGUAGE
  if (choice === 'source') return sourceLanguage
  return choice === 'en' ? 'en' : 'zh'
}
export type UserTheme = 'light' | 'dark' | 'system'

/**
 * Persisted appearance palette. The definitions (labels + source colours) live
 * in `features/theme/colorThemes.ts`; the union lives here because it is part
 * of the stored profile.
 */
export type UserColorTheme = 'default' | 'pinkAqua' | 'warmOrange' | 'academic'

/**
 * Interface style: the structure, type and surfaces of the whole app.
 * `lecture` — paper surfaces, serif headings, top navigation, reading first.
 * `lab` — hairlines, a millimetre grid, mono readouts, a side rail.
 * Independent of the mode and the palette (the palette only sets the accent).
 */
export type UserUiStyle = 'lecture' | 'lab'
export const UI_STYLES: readonly UserUiStyle[] = ['lecture', 'lab']
export const DEFAULT_UI_STYLE: UserUiStyle = 'lecture'

export interface UserProfile {
  id: 'singleton'
  name: string
  /**
   * Language used for **translation targets and course content**. This is NOT
   * the interface language —see `uiLanguage`.
   */
  language: UserLanguage
  /** Appearance mode: Light / Dark / System. */
  theme: UserTheme
  /**
   * Appearance palette, independent of `theme`. Absent on profiles written
   * before color themes existed, in which case the original palette is used.
   */
  colorTheme?: UserColorTheme
  /** Interface style; absent means `DEFAULT_UI_STYLE`. */
  uiStyle?: UserUiStyle
  /**
   * Language of the **application interface**. Persisted locally alongside the
   * rest of the profile; absent on profiles written before i18n existed, in
   * which case the app falls back to English.
   */
  uiLanguage?: UILanguage
  /** Language of generated questions; absent means `DEFAULT_QUESTION_LANGUAGE`. */
  questionLanguage?: QuestionLanguage
  /** Vocabulary: current book, new words per day, how reviews are practised. */
  vocabBookId?: string
  vocabDailyNew?: number
  vocabReviewMode?: 'auto' | 'recognize' | 'spell' | 'dictation'
  unlockedAt?: number
  inviteCode?: string
}

export interface UpdateUserInput {
  name?: string
  language?: UserLanguage
  theme?: UserTheme
  colorTheme?: UserColorTheme
  uiStyle?: UserUiStyle
  uiLanguage?: UILanguage
  questionLanguage?: QuestionLanguage
  vocabBookId?: string
  vocabDailyNew?: number
  vocabReviewMode?: 'auto' | 'recognize' | 'spell' | 'dictation'
}
