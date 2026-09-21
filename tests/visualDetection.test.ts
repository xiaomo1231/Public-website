import { describe, expect, it } from 'vitest'
import {
  analyzeVisualText,
  classifyVisualType,
  looksLikeUnreliableVisualText,
} from '@/infrastructure/files/visualDetection'

/** A broken PDF font: circled-plus and union as Private Use Area code points. */
const PUA_VENN = '\uF0C5 ( ) ( ) A B B A \u2212 \uF0C8 \u2212'

describe('looksLikeUnreliableVisualText', () => {
  it('Case A — normal prose is not visual', () => {
    expect(looksLikeUnreliableVisualText('A set is a collection of distinct objects.')).toBe(false)
  })

  it('Case B — garbled Private Use Area OCR is visual', () => {
    expect(looksLikeUnreliableVisualText(PUA_VENN)).toBe(true)
  })

  it('Case C — a normal mathematical expression is not visual', () => {
    expect(looksLikeUnreliableVisualText('A \u2229 B')).toBe(false)
    expect(
      looksLikeUnreliableVisualText('For any sets A and B, A \u2229 B is the intersection.'),
    ).toBe(false)
  })

  it('Case D — an unresolved glyph marker is visual', () => {
    expect(looksLikeUnreliableVisualText('[?] ( ) A B \u2212')).toBe(true)
  })

  it('does not flag a short normal sentence that contains a symbol', () => {
    expect(looksLikeUnreliableVisualText('The union A \u222A B.')).toBe(false)
  })

  it('flags a long scrambled symbol soup even without Private Use Area glyphs', () => {
    expect(looksLikeUnreliableVisualText('( ) ( ) A B B A \u2212 \u222A \u2212')).toBe(true)
  })

  it('treats empty text as not visual', () => {
    expect(looksLikeUnreliableVisualText('')).toBe(false)
    expect(looksLikeUnreliableVisualText('   ')).toBe(false)
  })
})

describe('analyzeVisualText', () => {
  it('reports the individual signals', () => {
    const signals = analyzeVisualText(PUA_VENN)
    expect(signals.privateUse).toBe(true)
    expect(signals.tokenCount).toBeGreaterThan(6)
    expect(signals.isolatedTokenRatio).toBe(1)
  })

  it('reports prose as letter-heavy', () => {
    const signals = analyzeVisualText('A set is a collection of distinct objects.')
    expect(signals.letterRatio).toBeGreaterThan(0.6)
    expect(signals.symbolRatio).toBeLessThan(0.3)
  })
})

describe('classifyVisualType', () => {
  it('recognises a Venn diagram from the surrounding words', () => {
    expect(classifyVisualType('Venn diagram of A and B', true)).toBe('diagram')
  })

  it('recognises a chart', () => {
    expect(classifyVisualType('Bar chart of the results', true)).toBe('chart')
  })

  it('falls back to illustration when only an image is known', () => {
    expect(classifyVisualType('some text', true)).toBe('illustration')
  })

  it('falls back to unknown when nothing is known', () => {
    expect(classifyVisualType('some text', false)).toBe('unknown')
  })
})
