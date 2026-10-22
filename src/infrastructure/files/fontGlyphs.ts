import { SYMBOL_FONT_MAP, isSymbolFontCodePoint } from './textEncoding'

/**
 * Per-font glyph repair for extracted PDF text.
 *
 * Symbolic fonts without a `ToUnicode` CMap come out of pdf.js as Private Use
 * Area code points `U+F020`–`U+F0FF` (the font byte + 0xF000). The same code
 * point means different glyphs in different fonts — U+F06C is `λ` in Symbol
 * but a round bullet in Wingdings — so a repair is only applied when the
 * item's own font name says which table to use. Without a font name nothing
 * is rewritten.
 */

export type FontEncodingKind =
  'symbol' | 'wingdings' | 'wingdings2' | 'wingdings3' | 'webdings' | 'other'

/** Classify a PDF base font name (`BCDOEE+SymbolMT`, `Wingdings-Regular`, `Wingdings2`). */
export function classifyFontName(name: string | undefined): FontEncodingKind | undefined {
  if (!name) return undefined
  const base = name
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '')
  if (/^wingdings-?3/.test(base)) return 'wingdings3'
  if (/^wingdings-?2/.test(base)) return 'wingdings2'
  if (/^wingdings/.test(base)) return 'wingdings'
  if (/^webdings/.test(base)) return 'webdings'
  // "Symbol", "SymbolMT", "Symbol-Bold" — not "SymbolNeu"-style lookalikes
  // with their own encodings, and not "MT-Extra" / "Symbola".
  if (/^symbol(?:mt|ps)?(?:-(?:bold|italic|regular))?$/.test(base)) return 'symbol'
  return 'other'
}

/**
 * Wingdings glyphs that appear in course slides, by font byte. Only glyphs
 * whose meaning is unambiguous are listed; anything else stays as it was
 * (or becomes a plain bullet when it is a lone list marker).
 */
export const WINGDINGS_MAP: Readonly<Record<number, string>> = {
  0x6c: '●',
  0x6e: '■',
  0x6f: '□',
  0x71: '❑',
  0x72: '❒',
  0x75: '◆',
  0x76: '❖',
  0x77: '⬥',
  0x9f: '•',
  0xa1: '○',
  0xa7: '▪',
  0xd8: '➢',
  0xe8: '➔',
  0xf0: '⇨',
  0xfb: '✗',
  0xfc: '✓',
  0xfd: '☒',
  0xfe: '☑',
}

export const WINGDINGS2_MAP: Readonly<Record<number, string>> = {
  0x4f: '✗',
  0x50: '✓',
}

export const WINGDINGS3_MAP: Readonly<Record<number, string>> = {}

export const WEBDINGS_MAP: Readonly<Record<number, string>> = {
  0x61: '✓',
  0x72: '✗',
}

const PUA_RUN = /[-]/

/**
 * Repair the Private Use Area glyphs of one text item, using its font.
 * `standalone` marks an item that is nothing but the glyph (a list marker):
 * an unknown dingbat there is read as a bullet instead of being kept as an
 * unreadable code point.
 */
export function repairFontPrivateUse(text: string, kind: FontEncodingKind | undefined): string {
  if (!kind || kind === 'other' || !PUA_RUN.test(text)) return text
  const table =
    kind === 'symbol'
      ? SYMBOL_FONT_MAP
      : kind === 'wingdings'
        ? WINGDINGS_MAP
        : kind === 'wingdings2'
          ? WINGDINGS2_MAP
          : kind === 'wingdings3'
            ? WINGDINGS3_MAP
            : WEBDINGS_MAP
  const standalone = [...text.trim()].length === 1
  let out = ''
  for (const char of text) {
    const cp = char.codePointAt(0)!
    if (!isSymbolFontCodePoint(cp)) {
      out += char
      continue
    }
    const mapped = table[cp - 0xf000]
    if (mapped !== undefined) out += mapped
    else if (kind !== 'symbol' && standalone) out += '•'
    else out += char
  }
  return out
}

/** Mathematical Alphanumeric Symbols, plus the italic h kept in Letterlike Symbols. */
const MATH_ALNUM = /[\u{1D400}-\u{1D7FF}ℎ]/u
const MATH_ALNUM_GLOBAL = /[\u{1D400}-\u{1D7FF}ℎ]/gu
const MATH_DIGIT = '[\\u{1D7CE}-\\u{1D7FF}]'
/** `𝟕. 𝟒𝟐`: a decimal point between two maths digits, with a stray space. */
const MATH_DECIMAL_SPACE = new RegExp(`(${MATH_DIGIT})\\.[ \\u00a0]+(?=${MATH_DIGIT})`, 'gu')

export function hasMathAlphanumerics(text: string): boolean {
  return MATH_ALNUM.test(text)
}

/**
 * Fold bold / italic / double-struck maths letters and digits (`𝟏𝟎`, `𝑣`,
 * `𝜶`) to the plain characters they style. NFKC is applied to that block
 * only — everything else (superscripts, ligatures, CJK) is left alone. A space
 * after a decimal point between two maths digits (`𝟕. 𝟒𝟐`) is an export
 * artefact and is removed first.
 */
export function foldMathAlphanumerics(text: string): string {
  if (!MATH_ALNUM.test(text)) return text
  return text
    .replace(MATH_DECIMAL_SPACE, '$1.')
    .replace(MATH_ALNUM_GLOBAL, (char) => char.normalize('NFKC'))
}

/**
 * PowerPoint's PDF export can paint every maths-italic glyph twice in the same
 * place (`𝑣𝑣` for one `𝑣`). Collapse only maths-alphanumeric runs made
 * of exactly two identical glyphs, and only when the evidence is geometric:
 * the item's own width says two letters were squeezed into one letter's
 * width, or (`confirmed`) another item in the same font on the page did.
 */
export function collapseDoubledMathGlyphs(
  text: string,
  width: number | undefined,
  height: number | undefined,
  confirmed = false,
): string {
  if (!MATH_ALNUM.test(text)) return text
  const chars = [...text]
  let pairs = 0
  const collapsed: string[] = []
  for (let i = 0; i < chars.length;) {
    const char = chars[i]!
    let run = 1
    while (chars[i + run] === char) run++
    if (run === 2 && MATH_ALNUM.test(char)) {
      pairs++
      collapsed.push(char)
    } else {
      for (let k = 0; k < run; k++) collapsed.push(char)
    }
    i += run
  }
  if (pairs === 0) return text
  if (confirmed) return collapsed.join('')
  if (!width || !height || height <= 2) return text
  const visible = (list: string[]) => list.filter((char) => char.trim() !== '').length
  // Each painted glyph would be implausibly narrow if they were all distinct.
  const perGlyph = width / visible(chars)
  const perCollapsed = width / visible(collapsed)
  if (perGlyph >= height * 0.33 || perCollapsed < height * 0.25) return text
  return collapsed.join('')
}
