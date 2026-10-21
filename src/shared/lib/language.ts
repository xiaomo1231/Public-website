import type { TranslationKey } from '@/i18n'

/**
 * Helpers for courses taught in a foreign language (German, Hungarian, …):
 * language codes, diacritics and a graded comparison of a typed answer with
 * the expected form. Pure functions, no storage.
 */

/** The primary subtag of a BCP-47 code, lower-case ('de-AT' → 'de'); undefined when empty. */
export function primaryLanguage(code: string | null | undefined): string | undefined {
  if (typeof code !== 'string') return undefined
  const primary = code.trim().toLowerCase().split(/[-_]/)[0]
  return primary && /^[a-z]{2,8}$/.test(primary) ? primary : undefined
}

/** English, or no language given (books and courses before languages existed). */
export function isEnglish(code: string | null | undefined): boolean {
  const primary = primaryLanguage(code)
  return !primary || primary === 'en'
}

/**
 * The language a project's course teaches (`Project.targetLanguage`, only
 * meaningful for a `language` course), read defensively from the project
 * row. Undefined when unset, invalid or for another subject.
 */
export function targetLanguageOf(project: object | null | undefined): string | undefined {
  if (!project) return undefined
  const { subject, targetLanguage } = project as { subject?: unknown; targetLanguage?: unknown }
  if (subject !== undefined && subject !== 'language') return undefined
  return typeof targetLanguage === 'string' ? primaryLanguage(targetLanguage) : undefined
}

/** The name of a language in the reader's language ('hu' → '匈牙利语'); the code when unknown. */
export function languageName(code: string, displayLanguage: string): string {
  try {
    return new Intl.DisplayNames([displayLanguage], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Letters without their accents and other combining marks (ő → o, Ä → A). ß stays ß. */
export function stripDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
}

/** German spelling equivalences: ß ↔ ss, ä ↔ ae, ö ↔ oe, ü ↔ ue (lower-case input). */
function foldGermanVariants(text: string): string {
  return text.replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
}

/** How a typed answer relates to the expected form. */
export type TargetComparison = 'exact' | 'accent' | 'case' | 'variant' | 'wrong'

/** Spaces collapsed, outer punctuation dropped, canonical composition. */
function tidy(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')
}

/**
 * Compare an answer with the expected form in the course's language:
 *  - `exact`   the same text (spacing and outer punctuation aside)
 *  - `case`    differs only in capitalisation (German nouns are capitalised)
 *  - `accent`  differs in accents / umlauts (Hungarian ó ö ő, German ä → a)
 *  - `variant` a known spelling equivalence (German ß ↔ ss, ä ↔ ae, ö ↔ oe, ü ↔ ue)
 *  - `wrong`   anything else
 */
export function compareTargetText(
  expected: string,
  answer: string,
  language?: string,
): TargetComparison {
  const want = tidy(expected)
  const got = tidy(answer)
  if (!got) return 'wrong'
  if (want === got) return 'exact'
  const wantLower = want.toLowerCase()
  const gotLower = got.toLowerCase()
  if (wantLower === gotLower) return 'case'
  if (primaryLanguage(language) === 'de') {
    if (foldGermanVariants(wantLower) === foldGermanVariants(gotLower)) return 'variant'
  }
  if (stripDiacritics(wantLower) === stripDiacritics(gotLower)) return 'accent'
  return 'wrong'
}

/** A comparison that is not exact but close: the spelling needs a correction. */
export function isNearTarget(outcome: TargetComparison): outcome is 'accent' | 'case' | 'variant' {
  return outcome === 'accent' || outcome === 'case' || outcome === 'variant'
}

/**
 * Translation key of the hint for an outcome (`{answer}` is the expected form).
 * A German variant is named precisely: ß written as ss, or an umlaut as ae/oe/ue.
 */
export function targetHintKey(
  outcome: TargetComparison,
  expected = '',
  answer = '',
): TranslationKey | null {
  if (outcome === 'accent') return 'language.hint.accent'
  if (outcome === 'case') return 'language.hint.case'
  if (outcome === 'variant') {
    return /ß/i.test(expected) && /ss/i.test(answer)
      ? 'language.hint.eszett'
      : 'language.hint.umlaut'
  }
  return null
}
