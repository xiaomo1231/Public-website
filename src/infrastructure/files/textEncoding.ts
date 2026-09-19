/**
 * Text-encoding hygiene for extracted course material.
 *
 * ## Where the odd characters come from
 *
 * `pdf.js` builds a synthetic font for every embedded font whose PDF has no
 * usable `ToUnicode` CMap. Glyphs it cannot map to a real Unicode value are
 * assigned code points from the Private Use Area, starting at U+E000
 * (`PRIVATE_USE_AREAS = [[0xE000, 0xF8FF], [0x100000, 0x10FFFD]]` in pdf.js).
 * Those code points end up in `getTextContent().items[].str`, get chunked, are
 * sent to the AI and are rendered in the UI.
 *
 * The assignment is *arbitrary and per-font* — the same glyph in two documents
 * gets two different code points. So there is no way to recover the original
 * character from the code point alone, and guessing (e.g. "U+F0C8 is Symbol
 * 0xC8, therefore ⊃") would silently corrupt text that is actually Wingdings,
 * a CJK subset, or anything else.
 *
 * ## What this module does
 *
 * 1. `normalizeExtractedText` — safe, lossless cleanup (line endings, control
 *    characters, Unicode NFC). It never touches Private Use Area code points,
 *    U+FFFD, `?`, `□`, maths symbols, CJK or LaTeX.
 * 2. `detectSuspiciousUnicode` — reports what looks wrong so the pipeline can
 *    warn the user. Detection never rewrites anything.
 * 3. `repairSymbolFontText` — a table-driven transform for the *standard Adobe
 *    Symbol encoding*, applied only when the caller has confirmed the font.
 *    It is deliberately not part of the automatic pipeline.
 */

/**
 * Private Use Area ranges. Kept in sync with pdf.js's own `PRIVATE_USE_AREAS`
 * so that anything pdf.js can synthesise is covered.
 */
const PRIVATE_USE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
]

/**
 * Every Unicode control character (`Cc`), which covers C0, DEL and C1 without
 * hand-written ranges. Tab and newline are kept — see `keepMeaningfulControl`.
 */
const CONTROL_CHAR = /\p{Cc}/gu

function keepMeaningfulControl(char: string): string {
  return char === '\t' || char === '\n' ? char : ''
}

/** C0 controls, DEL and C1 controls. */
function isControlCodePoint(codePoint: number): boolean {
  return (
    (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a) ||
    codePoint === 0x7f ||
    (codePoint >= 0x80 && codePoint <= 0x9f)
  )
}

const REPLACEMENT_CHAR = 0xfffd
const MISSING_GLYPH_BOX = 0x25a1

/** At most this many distinct code points are reported, to keep logs small. */
const MAX_REPORTED_CODE_POINTS = 24

/** A run of this many `?` in a row is almost certainly substituted text. */
const QUESTION_RUN_MIN = 3

export function isPrivateUseCodePoint(codePoint: number): boolean {
  return PRIVATE_USE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)
}

export interface SuspiciousUnicodeReport {
  /** True when a *strong* signal was found (PUA, U+FFFD, control, `???`). */
  suspicious: boolean
  /** Private Use Area characters — the pdf.js synthetic-font signature. */
  privateUse: number
  /** U+FFFD replacement characters — a decode failure. */
  replacement: number
  /** Disallowed control characters. */
  control: number
  /** Number of `???`-style runs. */
  questionRuns: number
  /**
   * U+25A1 white squares. Tracked but not treated as a strong signal: it is a
   * legitimate character (e.g. geometry) that fonts also use for "no glyph".
   */
  missingGlyphBox: number
  /** Distinct suspicious code points, ascending. Safe to log — no content. */
  codePoints: number[]
}

/**
 * Inspect extracted text for characters that usually indicate a broken font
 * encoding. Read-only: callers decide what to do with the result.
 */
export function detectSuspiciousUnicode(text: string): SuspiciousUnicodeReport {
  const codePoints = new Set<number>()
  let privateUse = 0
  let replacement = 0
  let control = 0
  let missingGlyphBox = 0
  let questionRuns = 0

  let questionStreak = 0
  for (const char of text) {
    const cp = char.codePointAt(0)!
    if (isPrivateUseCodePoint(cp)) {
      privateUse++
      codePoints.add(cp)
    } else if (cp === REPLACEMENT_CHAR) {
      replacement++
      codePoints.add(cp)
    } else if (cp === MISSING_GLYPH_BOX) {
      missingGlyphBox++
      codePoints.add(cp)
    } else if (isControlCodePoint(cp)) {
      control++
      codePoints.add(cp)
    }

    if (cp === 0x3f) {
      questionStreak++
      if (questionStreak === QUESTION_RUN_MIN) questionRuns++
    } else {
      questionStreak = 0
    }
  }

  return {
    suspicious: privateUse > 0 || replacement > 0 || control > 0 || questionRuns > 0,
    privateUse,
    replacement,
    control,
    questionRuns,
    missingGlyphBox,
    codePoints: [...codePoints].sort((a, b) => a - b).slice(0, MAX_REPORTED_CODE_POINTS),
  }
}

/**
 * Lossless cleanup applied to every extracted text before it is chunked.
 *
 * Deliberately conservative: it only removes characters that cannot carry
 * meaning (control codes) and normalises line endings / Unicode composition.
 * Private Use Area code points, U+FFFD, `?`, maths symbols, CJK and LaTeX are
 * all preserved exactly, because removing or rewriting them would destroy data
 * we cannot reconstruct.
 *
 * Because chunks and quiz `quote`s are both derived from this output, quote
 * verification stays consistent.
 */
export function normalizeExtractedText(text: string): string {
  if (!text) return ''
  return text
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHAR, keepMeaningfulControl)
    .normalize('NFC')
}

/**
 * Standard Adobe Symbol font encoding for the byte range 0x20–0xFF.
 *
 * Only used by `repairSymbolFontText`, and only when the caller has confirmed
 * the PDF really uses the Symbol font. Other symbolic fonts (Wingdings,
 * Webdings, ZapfDingbats, CJK subsets) share the same code range but map to
 * completely different glyphs, so this table must never be applied blindly.
 */
export const SYMBOL_FONT_MAP: Readonly<Record<number, string>> = {
  0x20: ' ', 0x21: '!', 0x22: '∀', 0x23: '#', 0x24: '∃', 0x25: '%', 0x26: '&',
  0x27: '∋', 0x28: '(', 0x29: ')', 0x2a: '∗', 0x2b: '+', 0x2c: ',', 0x2d: '−',
  0x2e: '.', 0x2f: '/', 0x30: '0', 0x31: '1', 0x32: '2', 0x33: '3', 0x34: '4',
  0x35: '5', 0x36: '6', 0x37: '7', 0x38: '8', 0x39: '9', 0x3a: ':', 0x3b: ';',
  0x3c: '<', 0x3d: '=', 0x3e: '>', 0x3f: '?', 0x40: '≅', 0x41: 'Α', 0x42: 'Β',
  0x43: 'Χ', 0x44: 'Δ', 0x45: 'Ε', 0x46: 'Φ', 0x47: 'Γ', 0x48: 'Η', 0x49: 'Ι',
  0x4a: 'ϑ', 0x4b: 'Κ', 0x4c: 'Λ', 0x4d: 'Μ', 0x4e: 'Ν', 0x4f: 'Ο', 0x50: 'Π',
  0x51: 'Θ', 0x52: 'Ρ', 0x53: 'Σ', 0x54: 'Τ', 0x55: 'Υ', 0x56: 'ς', 0x57: 'Ω',
  0x58: 'Ξ', 0x59: 'Ψ', 0x5a: 'Ζ', 0x5b: '[', 0x5c: '∴', 0x5d: ']', 0x5e: '⊥',
  0x5f: '_', 0x60: '‾', 0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x65: 'ε',
  0x66: 'φ', 0x67: 'γ', 0x68: 'η', 0x69: 'ι', 0x6a: 'ϕ', 0x6b: 'κ', 0x6c: 'λ',
  0x6d: 'μ', 0x6e: 'ν', 0x6f: 'ο', 0x70: 'π', 0x71: 'θ', 0x72: 'ρ', 0x73: 'σ',
  0x74: 'τ', 0x75: 'υ', 0x76: 'ϖ', 0x77: 'ω', 0x78: 'ξ', 0x79: 'ψ', 0x7a: 'ζ',
  0x7b: '{', 0x7c: '|', 0x7d: '}', 0x7e: '∼',
  0xa0: '€', 0xa1: 'ϒ', 0xa2: '′', 0xa3: '≤', 0xa4: '⁄', 0xa5: '∞', 0xa6: 'ƒ',
  0xa7: '♣', 0xa8: '♦', 0xa9: '♥', 0xaa: '♠', 0xab: '↔', 0xac: '←', 0xad: '↑',
  0xae: '→', 0xaf: '↓', 0xb0: '°', 0xb1: '±', 0xb2: '″', 0xb3: '≥', 0xb4: '×',
  0xb5: '∝', 0xb6: '∂', 0xb7: '•', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈',
  0xbc: '…', 0xbd: '⏐', 0xbe: '⎯', 0xbf: '↵', 0xc0: 'ℵ', 0xc1: 'ℑ', 0xc2: 'ℜ',
  0xc3: '℘', 0xc4: '⊗', 0xc5: '⊕', 0xc6: '∅', 0xc7: '∩', 0xc8: '∪', 0xc9: '⊃',
  0xca: '⊇', 0xcb: '⊄', 0xcc: '⊂', 0xcd: '⊆', 0xce: '∈', 0xcf: '∉', 0xd0: '∠',
  0xd1: '∇', 0xd2: '®', 0xd3: '©', 0xd4: '™', 0xd5: '∏', 0xd6: '√', 0xd7: '⋅',
  0xd8: '¬', 0xd9: '∧', 0xda: '∨', 0xdb: '⇔', 0xdc: '⇐', 0xdd: '⇑', 0xde: '⇒',
  0xdf: '⇓', 0xe0: '◊', 0xe1: '⟨', 0xe2: '®', 0xe3: '©', 0xe4: '™', 0xe5: '∑',
  0xf1: '⟩', 0xf2: '∫', 0xf3: '⌠', 0xf5: '⌡', 0xf6: '⎞', 0xf7: '⎟', 0xf8: '⎠',
  0xf9: '⎡', 0xfa: '⎢', 0xfb: '⎣', 0xfc: '⎧', 0xfd: '⎨', 0xfe: '⎩',
}

/** True when `codePoint` is the PUA form of a standard Symbol font byte. */
export function isSymbolFontCodePoint(codePoint: number): boolean {
  return codePoint >= 0xf020 && codePoint <= 0xf0ff
}

/** True when the text contains at least one Private Use Area character. */
export function hasPrivateUse(text: string): boolean {
  for (const char of text) {
    if (isPrivateUseCodePoint(char.codePointAt(0)!)) return true
  }
  return false
}

/**
 * Translate `U+F0xx` back through the standard Adobe Symbol encoding.
 *
 * Only correct when the PDF's font is genuinely the Symbol font — see the
 * module header. Code points outside the table are left untouched.
 */
export function repairSymbolFontText(text: string): string {
  if (!text) return ''
  let out = ''
  for (const char of text) {
    const cp = char.codePointAt(0)!
    const mapped = isSymbolFontCodePoint(cp) ? SYMBOL_FONT_MAP[cp - 0xf000] : undefined
    out += mapped ?? char
  }
  return out
}
