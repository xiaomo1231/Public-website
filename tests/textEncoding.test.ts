import { describe, expect, it } from 'vitest'
import {
  detectSuspiciousUnicode,
  hasPrivateUse,
  isPrivateUseCodePoint,
  isSymbolFontCodePoint,
  normalizeExtractedText,
  repairSymbolFontText,
} from '@/infrastructure/files/textEncoding'

/** Every symbol a maths course is likely to contain. */
const MATH_SYMBOLS = '√ ∞ ∑ ∫ ∂ ≤ ≥ ≠ ≈ → ↔ ∈ ∉ ⊂ ⊆ ∪ ∩ ∀ ∃ ∅ ∇ ± × ÷ ∏ ⋅ ∝ ≡'

/** pdf.js's synthetic Private Use Area code points. */
const PUA_SAMPLE = '\uF0C8 \uF0C6 \uE000 \uE001'

describe('normalizeExtractedText', () => {
  it('leaves ordinary prose untouched', () => {
    const text = 'The derivative measures the rate of change of a function.'
    expect(normalizeExtractedText(text)).toBe(text)
  })

  it('preserves every maths symbol', () => {
    expect(normalizeExtractedText(MATH_SYMBOLS)).toBe(MATH_SYMBOLS)
  })

  it('preserves Greek letters', () => {
    const greek = 'α β γ δ ε ζ η θ λ μ π ρ σ τ φ χ ψ ω Δ Σ Π Ω'
    expect(normalizeExtractedText(greek)).toBe(greek)
  })

  it('preserves subscripts and superscripts', () => {
    const text = 'x² + y³ + a₁ + b₂ = H₂O'
    expect(normalizeExtractedText(text)).toBe(text)
  })

  it('preserves mixed Chinese and maths', () => {
    const text = 'Let x ≥ 0，求 √(x² + 1)。'
    expect(normalizeExtractedText(text)).toBe(text)
  })

  it('preserves LaTeX source verbatim', () => {
    const latex = '\\[\\int_0^\\infty e^{-x^2} dx\\]'
    expect(normalizeExtractedText(latex)).toBe(latex)
  })

  it('preserves markdown and code fences', () => {
    const md = '# Heading\n\n- item\n\n```ts\nconst x = 1\n```'
    expect(normalizeExtractedText(md)).toBe(md)
  })

  it('preserves Private Use Area characters rather than guessing at them', () => {
    // This is the whole point: an unmappable glyph is kept, never dropped.
    expect(normalizeExtractedText(PUA_SAMPLE)).toBe(PUA_SAMPLE)
  })

  it('preserves the replacement character and question marks', () => {
    const text = 'value = ? and \uFFFD here'
    expect(normalizeExtractedText(text)).toBe(text)
  })

  it('normalises line endings', () => {
    expect(normalizeExtractedText('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('strips control characters but keeps tabs and newlines', () => {
    expect(normalizeExtractedText('a\u0000b\u0007c\td\ne')).toBe('abc\td\ne')
    expect(normalizeExtractedText('a\u0000b\u0007c')).toBe('abc')
    expect(normalizeExtractedText('x\u009fy')).toBe('xy')
  })

  it('applies NFC composition', () => {
    // e + combining acute -> é
    expect(normalizeExtractedText('e\u0301')).toBe('\u00e9')
  })

  it('is idempotent', () => {
    const messy = 'a\r\n\u0000b\u0007 e\u0301 \uF0C8 √'
    const once = normalizeExtractedText(messy)
    expect(normalizeExtractedText(once)).toBe(once)
  })

  it('handles the empty string', () => {
    expect(normalizeExtractedText('')).toBe('')
  })
})

describe('detectSuspiciousUnicode', () => {
  it('reports clean text as clean', () => {
    const report = detectSuspiciousUnicode('A perfectly ordinary sentence, 中文也没有问题。')
    expect(report.suspicious).toBe(false)
    expect(report.privateUse).toBe(0)
    expect(report.codePoints).toEqual([])
  })

  it('does not flag maths symbols as suspicious', () => {
    const report = detectSuspiciousUnicode(`Let x ≥ 0，求 √(x² + 1)。${MATH_SYMBOLS}`)
    expect(report.suspicious).toBe(false)
  })

  it('detects Private Use Area characters and reports their code points', () => {
    const report = detectSuspiciousUnicode('set \uF0C7 union \uF0C8')
    expect(report.suspicious).toBe(true)
    expect(report.privateUse).toBe(2)
    expect(report.codePoints).toEqual([0xf0c7, 0xf0c8])
  })

  it('detects the supplementary PUA plane', () => {
    const report = detectSuspiciousUnicode('x\u{F0001}y')
    expect(report.suspicious).toBe(true)
    expect(report.privateUse).toBe(1)
  })

  it('detects the replacement character', () => {
    const report = detectSuspiciousUnicode('broken \uFFFD text')
    expect(report.suspicious).toBe(true)
    expect(report.replacement).toBe(1)
  })

  it('detects runs of question marks', () => {
    const report = detectSuspiciousUnicode('value = ??? and ???? here')
    expect(report.suspicious).toBe(true)
    expect(report.questionRuns).toBe(2)
  })

  it('does not treat one or two question marks as a run', () => {
    expect(detectSuspiciousUnicode('what? really?? ok').questionRuns).toBe(0)
  })

  it('detects control characters', () => {
    const report = detectSuspiciousUnicode('a\u0000b\u001fc')
    expect(report.suspicious).toBe(true)
    expect(report.control).toBe(2)
  })

  it('tracks white squares separately without treating them as a strong signal', () => {
    // U+25A1 is a legitimate character (geometry), so it is reported but does
    // not on its own mark a document as broken.
    const report = detectSuspiciousUnicode('a square □ and another □')
    expect(report.missingGlyphBox).toBe(2)
    expect(report.suspicious).toBe(false)
  })

  it('caps the reported code points so logs stay small', () => {
    const many = Array.from({ length: 60 }, (_, i) => String.fromCodePoint(0xe000 + i)).join('')
    const report = detectSuspiciousUnicode(many)
    expect(report.privateUse).toBe(60)
    expect(report.codePoints.length).toBeLessThanOrEqual(24)
  })

  it('never returns document text, only code points', () => {
    const secret = 'CONFIDENTIAL \uF0C8'
    const report = detectSuspiciousUnicode(secret)
    expect(JSON.stringify(report)).not.toContain('CONFIDENTIAL')
  })
})

describe('private use helpers', () => {
  it('classifies the BMP PUA range', () => {
    expect(isPrivateUseCodePoint(0xe000)).toBe(true)
    expect(isPrivateUseCodePoint(0xf0c8)).toBe(true)
    expect(isPrivateUseCodePoint(0xf8ff)).toBe(true)
    expect(isPrivateUseCodePoint(0xdfff)).toBe(false)
    expect(isPrivateUseCodePoint(0xf900)).toBe(false)
  })

  it('classifies the supplementary PUA planes', () => {
    expect(isPrivateUseCodePoint(0xf0000)).toBe(true)
    expect(isPrivateUseCodePoint(0x100000)).toBe(true)
    expect(isPrivateUseCodePoint(0x10fffd)).toBe(true)
    expect(isPrivateUseCodePoint(0x110000)).toBe(false)
  })

  it('detects PUA anywhere in a string', () => {
    expect(hasPrivateUse('clean text')).toBe(false)
    expect(hasPrivateUse('clean \uE000 text')).toBe(true)
  })

  it('recognises the Symbol font code point window', () => {
    expect(isSymbolFontCodePoint(0xf020)).toBe(true)
    expect(isSymbolFontCodePoint(0xf0ff)).toBe(true)
    expect(isSymbolFontCodePoint(0xf100)).toBe(false)
    expect(isSymbolFontCodePoint(0xe000)).toBe(false)
  })
})

describe('repairSymbolFontText (opt-in, standard Adobe Symbol encoding)', () => {
  it('maps the set-theory and calculus operators', () => {
    // U+F0xx is the PUA form of Symbol byte 0xXX.
    expect(repairSymbolFontText('\uF0C6')).toBe('∅') // emptyset
    expect(repairSymbolFontText('\uF0C7')).toBe('∩') // intersection
    expect(repairSymbolFontText('\uF0C8')).toBe('∪') // union
    expect(repairSymbolFontText('\uF0CE')).toBe('∈') // element
    expect(repairSymbolFontText('\uF0B6')).toBe('∂') // partialdiff
    expect(repairSymbolFontText('\uF0F2')).toBe('∫') // integral
    expect(repairSymbolFontText('\uF0E5')).toBe('∑') // summation
    expect(repairSymbolFontText('\uF0D6')).toBe('√') // radical
    expect(repairSymbolFontText('\uF0A5')).toBe('∞') // infinity
    expect(repairSymbolFontText('\uF0A3')).toBe('≤') // lessequal
    expect(repairSymbolFontText('\uF0B3')).toBe('≥') // greaterequal
    expect(repairSymbolFontText('\uF0B9')).toBe('≠') // notequal
    expect(repairSymbolFontText('\uF0AE')).toBe('→') // arrowright
  })

  it('maps Greek letters', () => {
    expect(repairSymbolFontText('\uF061')).toBe('α')
    expect(repairSymbolFontText('\uF070')).toBe('π')
    expect(repairSymbolFontText('\uF053')).toBe('Σ')
    expect(repairSymbolFontText('\uF057')).toBe('Ω')
  })

  it('leaves ordinary text untouched', () => {
    const text = 'Plain ASCII and 中文 and √ ∞'
    expect(repairSymbolFontText(text)).toBe(text)
  })

  it('leaves PUA code points outside the Symbol window untouched', () => {
    // Synthetic pdf.js assignments start at U+E000 and are arbitrary, so they
    // must not be fed through the Symbol table.
    expect(repairSymbolFontText('\uE000\uE001')).toBe('\uE000\uE001')
    expect(repairSymbolFontText('\uF100')).toBe('\uF100')
  })

  it('is idempotent', () => {
    const once = repairSymbolFontText('\uF0C7 \uF0C8')
    expect(repairSymbolFontText(once)).toBe(once)
  })

  it('handles the empty string', () => {
    expect(repairSymbolFontText('')).toBe('')
  })
})

describe('quote integrity', () => {
  it('does not alter a chunk of course text that a quiz quote is taken from', () => {
    const chunk =
      'The derivative of f at x is defined as the limit\nof the difference quotient. For x² the result is 2x.'
    const quote = 'the limit\nof the difference quotient'
    const normalizedChunk = normalizeExtractedText(chunk)
    expect(normalizedChunk).toContain(normalizeExtractedText(quote))
  })

  it('keeps a quote containing maths symbols findable', () => {
    const chunk = 'For any sets A ∪ B we have |A ∪ B| ≤ |A| + |B|.'
    const quote = '|A ∪ B| ≤ |A| + |B|'
    expect(normalizeExtractedText(chunk)).toContain(normalizeExtractedText(quote))
  })

  it('preserves undecodable characters so the surrounding quote still matches', () => {
    const chunk = 'Let \uF0C7 denote intersection. The union is \uF0C8.'
    const quote = 'Let \uF0C7 denote intersection.'
    expect(normalizeExtractedText(chunk)).toContain(normalizeExtractedText(quote))
  })
})
