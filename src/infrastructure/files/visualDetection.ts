import { hasPrivateUse } from './textEncoding'
import type { VisualSourceType } from '@/entities/visualSource/types'

/**
 * Deciding whether extracted text is really an unreliable transcription of a
 * picture.
 *
 * This is deliberately *not* "contains a weird character" or "is short". A
 * single signal produces false positives: normal maths text like `A ∩ B` is
 * short and full of symbols, and a page title is short too. The classifier
 * therefore combines independent signals and requires several of them, or the
 * one unambiguous signal (Private Use Area glyphs, which only appear when a
 * font's glyphs could not be mapped to Unicode at all).
 */

/** Characters that carry mathematical / structural meaning rather than words. */
const SYMBOL_PATTERN = /[+\-−=<>≤≥≠≈∩∪∈∉⊆⊂⊇⊃∅△∆()[\]{}|/\\^_*.,;:∑∫∂√∞→←↔±×÷·]/
const LETTER_PATTERN = /[A-Za-z\u4e00-\u9fff\u0400-\u04ff]/
/** The `[?]` marker the maths normaliser leaves for unrecoverable glyphs. */
const UNRESOLVED_MARKER = '[?]'

export interface VisualTextSignals {
  tokenCount: number
  /** Private Use Area characters — an unmapped font glyph. */
  privateUse: boolean
  /** Number of `[?]` markers left by the maths normaliser. */
  unresolvedMarkers: number
  /** Letters (Latin/CJK/Cyrillic) as a share of non-space characters. */
  letterRatio: number
  /** Maths / punctuation symbols as a share of non-space characters. */
  symbolRatio: number
  /** Share of tokens that are a single character. */
  isolatedTokenRatio: number
}

export function analyzeVisualText(text: string): VisualTextSignals {
  const trimmed = (text ?? '').trim()
  const tokens = trimmed.length > 0 ? trimmed.split(/\s+/) : []
  const nonSpace = trimmed.replace(/\s/g, '')
  const total = nonSpace.length || 1

  let letters = 0
  let symbols = 0
  for (const char of nonSpace) {
    if (LETTER_PATTERN.test(char)) letters++
    else if (SYMBOL_PATTERN.test(char)) symbols++
  }

  const isolated = tokens.filter((token) => [...token].length <= 1).length
  const unresolvedMarkers = trimmed.split(UNRESOLVED_MARKER).length - 1

  return {
    tokenCount: tokens.length,
    privateUse: hasPrivateUse(trimmed),
    unresolvedMarkers,
    letterRatio: letters / total,
    symbolRatio: symbols / total,
    isolatedTokenRatio: tokens.length > 0 ? isolated / tokens.length : 0,
  }
}

/**
 * True when the text is much more likely to be a broken transcription of a
 * figure than prose or a real formula.
 *
 * - Any Private Use Area glyph is decisive: the PDF font had no Unicode mapping.
 * - A `[?]` marker means the maths normaliser already gave up on a glyph.
 * - Otherwise several independent signals must agree (many single-character
 *   tokens, symbol-heavy, letter-poor) *and* the text must be long enough to be
 *   more than a trivial formula like `A ∩ B`.
 */
export function looksLikeUnreliableVisualText(text: string): boolean {
  const signals = analyzeVisualText(text)
  if (signals.privateUse) return true
  if (signals.unresolvedMarkers > 0) return true
  if (signals.letterRatio > 0.6) return false
  return (
    signals.tokenCount >= 6 &&
    signals.symbolRatio >= 0.3 &&
    signals.letterRatio <= 0.5 &&
    signals.isolatedTokenRatio >= 0.5
  )
}

/**
 * Best-effort category for a preserved figure. When nothing is known the type
 * is `unknown` — the caption must not invent what the picture shows.
 */
export function classifyVisualType(text: string, hasEmbeddedImage: boolean): VisualSourceType {
  const lower = (text ?? '').toLowerCase()
  if (/\bvenn\b|diagram|figure|示意|图\b/.test(lower)) return 'diagram'
  if (/chart|graph|plot|曲线图|图表/.test(lower)) return 'chart'
  if (/table|表格/.test(lower)) return 'table_image'
  const signals = analyzeVisualText(text)
  if (signals.symbolRatio >= 0.35 && signals.letterRatio <= 0.5) return 'math_image'
  return hasEmbeddedImage ? 'illustration' : 'unknown'
}
