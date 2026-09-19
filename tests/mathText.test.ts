import { describe, expect, it } from 'vitest'
import { splitMathSegments, splitParagraphs } from '@/shared/lib/mathText'

describe('splitMathSegments', () => {
  it('returns plain text untouched', () => {
    expect(splitMathSegments('just words')).toEqual([{ kind: 'text', value: 'just words' }])
  })

  it('extracts inline $…$ math', () => {
    const segments = splitMathSegments('Euler: $e^{i\\pi} + 1 = 0$ holds.')
    expect(segments).toEqual([
      { kind: 'text', value: 'Euler: ' },
      { kind: 'math', value: 'e^{i\\pi} + 1 = 0', display: false },
      { kind: 'text', value: ' holds.' },
    ])
  })

  it('extracts display $$…$$ math', () => {
    const segments = splitMathSegments('$$\\int_0^1 x dx$$')
    expect(segments).toEqual([
      { kind: 'math', value: '\\int_0^1 x dx', display: true },
    ])
  })

  it('extracts \\[…\\] display math', () => {
    const segments = splitMathSegments('\\[\\int_0^\\infty e^{-x^2} dx\\]')
    expect(segments).toEqual([
      { kind: 'math', value: '\\int_0^\\infty e^{-x^2} dx', display: true },
    ])
  })

  it('extracts \\(…\\) inline math', () => {
    const segments = splitMathSegments('area \\(\\pi r^2\\) here')
    expect(segments[1]).toEqual({ kind: 'math', value: '\\pi r^2', display: false })
  })

  it('does not treat a lone currency sign as math', () => {
    // `$` followed by a space, or a single `$`, is prose.
    expect(splitMathSegments('costs $ 5 and $10 total')).toEqual([
      { kind: 'text', value: 'costs $ 5 and $10 total' },
    ])
  })

  it('does not let inline math span a newline', () => {
    const segments = splitMathSegments('a $x\ny$ b')
    expect(segments.every((s) => s.kind === 'text')).toBe(true)
  })

  it('handles several spans in one paragraph', () => {
    const segments = splitMathSegments('$a$ and $b$')
    expect(segments.filter((s) => s.kind === 'math')).toHaveLength(2)
  })

  it('handles text with no math at the edges', () => {
    const segments = splitMathSegments('$x$')
    expect(segments).toEqual([{ kind: 'math', value: 'x', display: false }])
  })

  it('handles the empty string', () => {
    expect(splitMathSegments('')).toEqual([])
  })
})

describe('splitParagraphs', () => {
  it('splits on blank lines', () => {
    expect(splitParagraphs('one\n\ntwo\n\nthree')).toEqual(['one', 'two', 'three'])
  })

  it('treats a single newline as a soft break, not a paragraph break', () => {
    expect(splitParagraphs('line one\nline two')).toEqual(['line one\nline two'])
  })

  it('keeps CJK content intact', () => {
    const text = '第一段。\n\n第二段。'
    expect(splitParagraphs(text)).toEqual(['第一段。', '第二段。'])
  })

  it('drops blank blocks', () => {
    expect(splitParagraphs('a\n\n\n\n\nb')).toEqual(['a', 'b'])
  })

  it('handles empty and whitespace-only input', () => {
    expect(splitParagraphs('')).toEqual([])
    expect(splitParagraphs('   \n\n  ')).toEqual([])
  })
})
