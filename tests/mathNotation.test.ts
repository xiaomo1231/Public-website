import { describe, expect, it } from 'vitest'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { extractSymbolsFromMarkdown } from '@/shared/lib/latexSymbols'

const run = (text: string): string => normalizeMathNotation(text).text

/** pdf.js / Adobe Symbol Private Use Area code points. */
const PUA_INTERSECTION = '\uF0C7' // ∩
const PUA_UNION = '\uF0C8' // ∪
const PUA_ELEMENT = '\uF0CE' // ∈
const PUA_ARBITRARY = '\uE000' // arbitrary synthetic assignment, unrecoverable

describe('normalizeMathNotation — untouched input', () => {
  it('leaves ordinary English prose alone', () => {
    const text = 'The derivative measures the rate of change of a function.'
    expect(run(text)).toBe(text)
  })

  it('leaves ordinary Chinese prose alone', () => {
    const text = '这是一段普通的课程说明，没有任何公式。'
    expect(run(text)).toBe(text)
  })

  it('leaves existing LaTeX untouched', () => {
    const text = '\\[\\int_0^\\infty e^{-x^2} dx\\] and \\(\\frac{a}{b}\\)'
    expect(run(text)).toBe(text)
  })

  it('does not rewrite a minus sign used in ordinary prose', () => {
    // U+2212 outside maths is a visible minus, not a broken character.
    expect(run('pages 10\u221220')).toBe('pages 10\u221220')
  })

  it('leaves fenced code blocks verbatim', () => {
    const text = '```\nconst s = A \u2229 B\n```'
    expect(run(text)).toBe(text)
  })

  it('leaves inline code spans verbatim', () => {
    const text = 'Use `A \u2229 B` as the sample.'
    expect(run(text)).toBe(text)
  })

  it('does not mistake a currency sign for a maths delimiter', () => {
    const text = 'The book costs $5 and A \u2229 B is the intersection.'
    expect(run(text)).toBe('The book costs $5 and A \\(\\cap\\) B is the intersection.')
  })

  it('converts inside a paired $…$ span', () => {
    expect(run('We have $A \u2229 B$ here.')).toBe('We have $A \\cap B$ here.')
  })
})

describe('normalizeMathNotation — Unicode maths to LaTeX', () => {
  it('converts symbols inside a maths delimiter without adding delimiters', () => {
    expect(run('Set \\(X \u2229 Y\\)')).toBe('Set \\(X \\cap Y\\)')
    expect(run('\\[X \u222A Y\\]')).toBe('\\[X \\cup Y\\]')
    expect(run('\\(x \u2208 A\\)')).toBe('\\(x \\in A\\)')
    expect(run('\\(A \u2286 B\\)')).toBe('\\(A \\subseteq B\\)')
    expect(run('\\(x \u2264 y\\)')).toBe('\\(x \\le y\\)')
    expect(run('\\(x \u2265 y\\)')).toBe('\\(x \\ge y\\)')
    expect(run('\\(x \u2260 y\\)')).toBe('\\(x \\neq y\\)')
  })

  it('wraps a bare symbol in prose so it still typesets', () => {
    expect(run('Let A \u2229 B be the intersection.')).toBe(
      'Let A \\(\\cap\\) B be the intersection.',
    )
  })

  it('converts Greek letters', () => {
    expect(run('\\(\u03B1 + \u03B2\\)')).toBe('\\(\\alpha + \\beta\\)')
  })

  it('converts a minus inside maths but not in prose', () => {
    expect(run('\\(10 \u2212 20\\)')).toBe('\\(10 - 20\\)')
  })

  it('turns a square root with a parenthesised argument into \\sqrt{...}', () => {
    expect(run('\\(\u221A(x\u00B2 + 1)\\)')).toBe('\\(\\sqrt{x^{2} + 1}\\)')
  })
})

describe('normalizeMathNotation — Private Use Area recovery', () => {
  it('recovers Symbol-font PUA to canonical LaTeX', () => {
    expect(run('A ' + PUA_INTERSECTION + ' B')).toBe('A \\(\\cap\\) B')
    expect(run('A ' + PUA_UNION + ' B')).toBe('A \\(\\cup\\) B')
    expect(run('x ' + PUA_ELEMENT + ' A')).toBe('x \\(\\in\\) A')
  })

  it('recovers Symbol-font PUA inside a maths delimiter', () => {
    expect(run('\\(X ' + PUA_UNION + ' Y\\)')).toBe('\\(X \\cup Y\\)')
  })

  it('marks unrecoverable PUA instead of keeping or guessing at it', () => {
    const result = normalizeMathNotation('value ' + PUA_ARBITRARY + ' here')
    expect(result.text).toBe('value [?] here')
    expect(result.unresolved).toBe(1)
    expect(result.text).not.toContain(PUA_ARBITRARY)
  })

  it('never lets a Private Use Area character survive', () => {
    const dirty = 'A ' + PUA_INTERSECTION + ' B ' + PUA_UNION + ' C ' + PUA_ARBITRARY
    const out = run(dirty)
    expect(out).not.toMatch(/[\uE000-\uF8FF]/)
  })

  it('reports how much it converted', () => {
    expect(normalizeMathNotation('A \u2229 B \u222A C').converted).toBe(2)
  })
})

describe('normalizeMathNotation — symmetric difference', () => {
  it('turns the Unicode formula into the canonical LaTeX statement', () => {
    const source = '\\(A \u25B3 B = (A \u2212 B) \u222A (B \u2212 A)\\)'
    const out = run(source)

    expect(out).toContain('\\triangle')
    expect(out).toContain('\\cup')
    expect(out).not.toContain('\u25B3')
    expect(out).not.toContain('\u222A')
    // The rendered maths is the symmetric-difference identity.
    expect(out).toContain('A \\triangle B = (A - B) \\cup (B - A)')
  })

  it('recovers a formula whose union operator was a Private Use Area glyph', () => {
    const damaged = 'A \u25B3 B = (A - B) ' + PUA_UNION + ' (B - A)'
    const out = run(damaged)

    expect(out).not.toMatch(/[\uE000-\uF8FF]/)
    expect(out).toContain('\\triangle')
    expect(out).toContain('\\cup')
  })

  it('recovers a damaged PDF line and leaves no Private Use Area glyph', () => {
    // What a broken PDF font yields: circled-plus and union as Private Use Area
    // code points, with U+2212 minus signs, in a scrambled order.
    const damaged = '\uF0C5 ( ) ( ) A B B A \u2212 \uF0C8 \u2212'
    const result = normalizeMathNotation(damaged)

    expect(result.text).not.toMatch(/[\uE000-\uF8FF]/)
    expect(result.unresolved).toBe(0)
    // U+F0C8 is the Symbol-font union glyph; U+F0C5 the circled plus.
    expect(result.text).toContain('\\cup')
    expect(result.text).toContain('\\oplus')
  })

  it('feeds the canonical LaTeX into the symbols panel', () => {
    const lesson = '\\(A \u25B3 B = (A \\setminus B) \u222A (B \\setminus A)\\)'
    const commands = extractSymbolsFromMarkdown(run(lesson)).map((s) => s.latex)

    expect(commands).toContain('\\triangle')
    expect(commands).toContain('\\cup')
    expect(commands).toContain('\\setminus')
  })
})

describe('normalizeMathNotation — invariants', () => {
  it('is idempotent', () => {
    const dirty = 'A ' + PUA_UNION + ' B and \\(x \u2228 y\\) and ' + PUA_ARBITRARY
    const once = normalizeMathNotation(dirty)
    const twice = normalizeMathNotation(once.text)
    expect(twice.text).toBe(once.text)
    expect(twice.unresolved).toBe(0)
  })

  it('handles the empty string', () => {
    expect(normalizeMathNotation('')).toEqual({ text: '', converted: 0, unresolved: 0 })
  })

  it('keeps CJK, LaTeX and maths together without corrupting either', () => {
    const text = '集合 \\(A \u2229 B\\) 表示交集。'
    expect(run(text)).toBe('集合 \\(A \\cap B\\) 表示交集。')
  })
})
