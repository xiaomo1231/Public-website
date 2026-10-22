/**
 * 「跟随考试语言（中文辅助）」: content written primarily in the language the
 * course is examined in (detected from its past exams / materials), with key
 * terms and hard sentences glossed in Simplified Chinese, so the student
 * learns to read the real exam.
 *
 * The mode travels through the existing language plumbing as a language key
 * `exam:<code>` (`exam:de`, `exam:en`, …). Prompts that accept it replace
 * their language line with `examLanguageInstruction(code)`; every other
 * language value produces the prompt exactly as before (byte-identical, no
 * version change). Caches that fold the language (tutor lessons, walkthroughs)
 * store the key as a language of its own, so other modes are not invalidated.
 */

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'exam-language' as const

/** The exam-language mode with its resolved language, e.g. `exam:de`. */
export type ExamLanguageKey = `exam:${string}`

/** `exam:<code>` for a BCP-47 primary tag. */
export function examLanguageKey(code: string): ExamLanguageKey {
  return `exam:${code.trim().toLowerCase()}`
}

export function isExamLanguageKey(value: unknown): value is ExamLanguageKey {
  return typeof value === 'string' && /^exam:[a-z]{2,8}$/.test(value)
}

/** The exam language of an `exam:<code>` key; undefined for any other value. */
export function examLanguageOf(value: unknown): string | undefined {
  return isExamLanguageKey(value) ? value.slice(5) : undefined
}

const NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  hu: 'Hungarian',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  la: 'Latin',
  pl: 'Polish',
  cs: 'Czech',
  ro: 'Romanian',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  sv: 'Swedish',
  tr: 'Turkish',
}

/** The English name of a language code (prompts are written in English). */
export function examLanguageName(code: string): string {
  return NAMES[code] ?? code
}

/**
 * The language instruction for the exam-language mode (no trailing period;
 * callers put it where their own language name would go).
 */
export function examLanguageInstruction(code: string): string {
  const name = examLanguageName(code)
  return `${name}, the language this course is examined in, so the student learns to read the real exam. Keep the wording, technical terms and notation in ${name}. Add a short Simplified Chinese gloss in parentheses after each key technical term at its first mention and after any sentence a learner may find hard to read, e.g. "pivot (主元)". Do not translate everything: the Chinese is a reading aid only. Verbatim quotes stay in their original language`
}

/** A full "Write in …." style line for prompts whose line has its own prefix. */
export function examLanguageLine(prefix: string, code: string): string {
  return `${prefix} ${examLanguageInstruction(code)}.`
}
