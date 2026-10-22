import type { UILanguage } from '@/i18n/types'
import type { PomodoroSettings } from '@/entities/focus/pomodoro'
import type { HandwritingRecognitionMode } from '@/entities/handwriting/types'
import { examLanguageKey, type ExamLanguageKey } from '@/infrastructure/ai/prompts/exam-language/v1'

export type UserLanguage = 'auto' | 'zh' | 'en'

/**
 * Language of generated questions, explanations of mistakes and tutor
 * questions: Chinese with key terms in English (the default — Chinese students
 * often study from English textbooks), the textbook's own language, or English.
 */
export type QuestionLanguage = 'zh_terms' | 'source' | 'en' | 'exam'

export const QUESTION_LANGUAGES: QuestionLanguage[] = ['zh_terms', 'source', 'en', 'exam']
export const DEFAULT_QUESTION_LANGUAGE: QuestionLanguage = 'zh_terms'

/**
 * Teaching / content language: Chinese, English, bilingual, or the
 * 「跟随考试语言（中文辅助）」 key `exam:<code>` (see prompts/exam-language).
 */
export type ContentLanguage = 'zh' | 'en' | 'mixed' | ExamLanguageKey

/**
 * The `exam:<code>` key of the exam-language mode, or `null` when the mode
 * does not apply: another preference, no detected exam language, or a
 * Chinese exam (then content is simply Chinese).
 */
export function examModeKey(
  preference: QuestionLanguage | undefined,
  examLanguage: string | undefined,
): ExamLanguageKey | null {
  if (preference !== 'exam' || !examLanguage || examLanguage === 'zh') return null
  return examLanguageKey(examLanguage)
}

/**
 * A content language for helpers that know only zh / en / mixed (figure
 * labels, image searches): the exam mode reads as bilingual.
 */
export function plainContentLanguage(language: ContentLanguage): 'zh' | 'en' | 'mixed' {
  return language === 'zh' || language === 'en' || language === 'mixed' ? language : 'mixed'
}

/**
 * The concrete language for content when the preference follows the textbook.
 * The exam mode gives `exam:<code>` (a Chinese or undetected exam → Chinese
 * with key terms, like the default).
 */
export function resolveContentLanguage(
  preference: QuestionLanguage | undefined,
  sourceLanguage: 'zh' | 'en' | 'mixed',
  examLanguage?: string,
): ContentLanguage {
  const choice = preference ?? DEFAULT_QUESTION_LANGUAGE
  if (choice === 'exam') return examModeKey(choice, examLanguage) ?? 'zh'
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

/**
 * How passages with questions are marked in a homework walkthrough (saved
 * notes and conversations tucked into the text): `link` — accent text +
 * underline; `highlighter` — a translucent background.
 */
export type NoteMarkStyle = 'link' | 'highlighter'
export const NOTE_MARK_STYLES: readonly NoteMarkStyle[] = ['link', 'highlighter']
export const DEFAULT_NOTE_MARK_STYLE: NoteMarkStyle = 'link'

/**
 * Fill colour of the highlighter mark style. `theme` follows the palette's
 * accent; the others are fixed hues with tuned light / dark values (see
 * `[data-note-color]` in globals.css).
 */
export type NoteHighlightColor =
  'yellow' | 'green' | 'pink' | 'blue' | 'orange' | 'purple' | 'theme'
export const NOTE_HIGHLIGHT_COLORS: readonly NoteHighlightColor[] = [
  'yellow',
  'green',
  'pink',
  'blue',
  'orange',
  'purple',
  'theme',
]
export const DEFAULT_NOTE_HIGHLIGHT_COLOR: NoteHighlightColor = 'yellow'

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
  /** Walkthrough question marks; absent means `DEFAULT_NOTE_MARK_STYLE`. */
  noteMarkStyle?: NoteMarkStyle
  /** Highlighter fill colour; absent means `DEFAULT_NOTE_HIGHLIGHT_COLOR`. */
  noteHighlightColor?: NoteHighlightColor
  /**
   * Show the AI usage / balance readout in the lab side rail and the lecture
   * account menu. Absent means off (the settings breakdown is always shown).
   */
  showUsageReadout?: boolean
  /** Vocabulary: current book, new words per day, how reviews are practised. */
  vocabBookId?: string
  vocabDailyNew?: number
  vocabReviewMode?: 'auto' | 'recognize' | 'spell' | 'dictation'
  /** Homework walkthrough: the version sections show by default (普通 / 详细). */
  walkthroughLevel?: 'standard' | 'detailed'
  /** 手写识别方式; absent means `DEFAULT_HANDWRITING_RECOGNITION_MODE` (自动). */
  handwritingRecognition?: HandwritingRecognitionMode
  /**
   * Pomodoro timer settings (lengths, cycle, sound, dim, shown). Absent or
   * partial fields fall back to `DEFAULT_POMODORO` via `normalizePomodoroSettings`.
   * The running timer itself is per-tab session state, not stored here.
   */
  pomodoro?: Partial<PomodoroSettings>
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
  noteMarkStyle?: NoteMarkStyle
  noteHighlightColor?: NoteHighlightColor
  showUsageReadout?: boolean
  vocabBookId?: string
  vocabDailyNew?: number
  vocabReviewMode?: 'auto' | 'recognize' | 'spell' | 'dictation'
  walkthroughLevel?: 'standard' | 'detailed'
  handwritingRecognition?: HandwritingRecognitionMode
  pomodoro?: Partial<PomodoroSettings>
}
