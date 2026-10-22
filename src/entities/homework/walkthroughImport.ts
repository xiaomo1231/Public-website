/**
 * Local checks for an imported walkthrough (pure: no storage, no AI).
 *
 * The model re-typesets the author's text; it must not write its own. A
 * section is accepted only when most of its words and numbers can be found in
 * the extracted file — LaTeX commands, spacing, Unicode forms (⾏ / ½ / −) and
 * subscripts are normalised away first, so a faithful re-typesetting passes
 * while an invented section or changed values do not.
 */

/** Share of a body's tokens that must appear in the source. */
export const MIN_TOKEN_COVERAGE = 0.6
/** Share of a body's distinct numbers that must appear in the source. */
export const MIN_NUMBER_COVERAGE = 0.8
/** Fewer distinct numbers than this are not judged on their own. */
const MIN_NUMBERS_TO_JUDGE = 4

/** NFKC + lower case, minus signs unified, LaTeX command names removed. */
export function normalizeImportText(value: string): string {
  return (
    value
      .normalize('NFKC')
      .toLowerCase()
      // \frac, \left, \begin{array}… are typesetting, not content.
      .replace(/\\[a-z]+/g, ' ')
      .replace(/[−‒–—﹣－]/g, '-')
      // 1⁄5 (NFKC of ⅕) reads as 1/5.
      .replace(/⁄/g, '/')
  )
}

const CJK = /[㐀-鿿豈-﫿]/

/** Latin words (≥2 letters), numbers and CJK character pairs of a normalised text. */
export function importTokens(normalized: string): { words: string[]; numbers: string[] } {
  const words: string[] = []
  const numbers: string[] = []
  for (const match of normalized.matchAll(/[a-z]{2,}|\d+(?:\.\d+)?/g)) {
    const token = match[0]
    if (/^\d/.test(token)) numbers.push(token)
    else words.push(token)
  }
  // CJK has no spaces: compare adjacent character pairs.
  const cjk = [...normalized].filter((char) => CJK.test(char))
  for (let index = 0; index + 1 < cjk.length; index++) words.push(cjk[index]! + cjk[index + 1]!)
  return { words, numbers }
}

export interface SourceIndex {
  words: ReadonlySet<string>
  numbers: ReadonlySet<string>
  /** The normalised source with all whitespace removed (for quote checks). */
  compact: string
}

export function buildSourceIndex(sourceText: string): SourceIndex {
  const normalized = normalizeImportText(sourceText)
  const tokens = importTokens(normalized)
  return {
    words: new Set(tokens.words),
    numbers: new Set(tokens.numbers),
    compact: normalized.replace(/\s+/g, ''),
  }
}

export interface DerivationCheck {
  /** Share of the body's tokens found in the source (0–1). */
  tokenCoverage: number
  /** Share of the body's distinct numbers found in the source (0–1). */
  numberCoverage: number
  ok: boolean
  reason?: 'empty' | 'not-in-source' | 'numbers-changed'
}

/**
 * Whether `body` is the source's text re-typeset rather than new writing.
 * Very short bodies (a line) are judged by their tokens like any other.
 */
export function checkDerivedFromSource(body: string, source: SourceIndex): DerivationCheck {
  const tokens = importTokens(normalizeImportText(body))
  const all = [...tokens.words, ...tokens.numbers]
  if (all.length === 0) return { tokenCoverage: 0, numberCoverage: 0, ok: false, reason: 'empty' }
  const found = all.filter((token) =>
    /^\d/.test(token) ? source.numbers.has(token) : source.words.has(token),
  ).length
  const tokenCoverage = found / all.length
  const distinct = [...new Set(tokens.numbers)]
  const numberCoverage =
    distinct.length === 0
      ? 1
      : distinct.filter((number) => source.numbers.has(number)).length / distinct.length
  if (tokenCoverage < MIN_TOKEN_COVERAGE)
    return { tokenCoverage, numberCoverage, ok: false, reason: 'not-in-source' }
  if (distinct.length >= MIN_NUMBERS_TO_JUDGE && numberCoverage < MIN_NUMBER_COVERAGE)
    return { tokenCoverage, numberCoverage, ok: false, reason: 'numbers-changed' }
  return { tokenCoverage, numberCoverage, ok: true }
}

/**
 * Whether a reported issue quotes something that is really there (in the
 * imported section or in the source). Unfindable quotes are dropped: a note
 * pointing at text nobody wrote would only confuse.
 */
export function issueQuoteFound(quote: string, body: string, source: SourceIndex): boolean {
  const compact = normalizeImportText(quote).replace(/\s+/g, '')
  if (!compact) return false
  if (normalizeImportText(body).replace(/\s+/g, '').includes(compact)) return true
  if (source.compact.includes(compact)) return true
  // A quote re-typeset differently from the body: accept when its tokens are there.
  const tokens = importTokens(normalizeImportText(quote))
  const all = [...tokens.words, ...tokens.numbers]
  if (all.length < 2) return false
  const found = all.filter((token) =>
    /^\d/.test(token) ? source.numbers.has(token) : source.words.has(token),
  ).length
  return found / all.length >= 0.8
}
