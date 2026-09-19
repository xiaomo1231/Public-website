import { describe, expect, it } from 'vitest'
import {
  collectMathFragments,
  extractLatexSymbols,
  extractSymbolsFromMarkdown,
  isKnownSymbol,
  symbolKey,
} from '@/shared/lib/latexSymbols'

/** Convenience: the commands found, without the leading backslash. */
function commands(text: string): string[] {
  return extractLatexSymbols(text).map((symbol) => symbol.latex)
}

describe('extractLatexSymbols', () => {
  it('extracts set-theory operators', () => {
    expect(commands('A \\cap B and A \\cup B')).toEqual(['\\cap', '\\cup'])
    expect(commands('x \\in A')).toEqual(['\\in'])
    expect(commands('x \\notin A')).toEqual(['\\notin'])
    expect(commands('A \\subseteq B')).toEqual(['\\subseteq'])
  })

  it('extracts calculus operators', () => {
    expect(commands('\\sum_{i=1}^{n} i')).toContain('\\sum')
    expect(commands('\\int_0^\\infty e^{-x^2} dx')).toEqual(['\\int', '\\infty'])
    expect(commands('\\frac{a}{b}')).toEqual(['\\frac'])
    expect(commands('\\sqrt{x}')).toEqual(['\\sqrt'])
    expect(commands('\\partial f')).toEqual(['\\partial'])
  })

  it('extracts relations', () => {
    expect(commands('x \\le y \\ge z \\neq w')).toEqual(['\\le', '\\ge', '\\neq'])
  })

  it('keeps the argument of a command that takes one', () => {
    const [symbol] = extractLatexSymbols('\\overline{Y}')
    expect(symbol?.latex).toBe('\\overline')
    expect(symbol?.displayLatex).toBe('\\overline{Y}')
  })

  it('deduplicates a symbol used many times', () => {
    const text = Array.from({ length: 15 }, () => 'A \\cap B').join('. ')
    const found = extractLatexSymbols(text)
    expect(found.filter((s) => s.latex === '\\cap')).toHaveLength(1)
  })

  it('does not invent symbols that are not used', () => {
    const found = commands('The derivative is a rate of change.')
    expect(found).toEqual([])
  })

  it('reports only the symbols actually present', () => {
    const found = commands('A \\cap B and A \\cup B')
    expect(found).not.toContain('\\sum')
    expect(found).not.toContain('\\int')
  })

  it('ignores structural and formatting commands', () => {
    const found = commands('\\left( x \\right) \\text{hello} \\begin{matrix} \\end{matrix}')
    expect(found).toEqual([])
  })

  it('does not treat set braces as commands', () => {
    expect(commands('\\{a,b,c\\}')).toEqual([])
    expect(commands('X = \\{a, c, e\\}')).toEqual([])
  })

  it('does not treat subscripts or superscripts as commands', () => {
    expect(commands('x^2 + y_i')).toEqual([])
  })

  it('still surfaces unknown commands so nothing is silently dropped', () => {
    const found = extractLatexSymbols('\\varnothing and \\sqcup')
    expect(found.map((s) => s.latex)).toEqual(['\\varnothing', '\\sqcup'])
    // Humanised fallback name rather than an empty label.
    expect(found[0]?.name).toBe('Varnothing')
  })

  it('gives known symbols a readable name and a representative expression', () => {
    const [cap] = extractLatexSymbols('A \\cap B')
    expect(cap?.name).toBe('Intersection')
    expect(cap?.displayLatex).toBe('A \\cap B')
  })

  it('handles a full set-theory lesson', () => {
    const lesson = [
      '\\[',
      'U = \\{a,b,c,d,e,f\\}',
      '\\]',
      '\\[',
      'X \\cap Y = \\{c\\}',
      '\\]',
      '\\[',
      '\\overline{Y} = \\{a,e,f\\}',
      '\\]',
      '\\[',
      'X - Y = \\{a,e\\}',
      '\\]',
    ].join('\n')

    const found = commands(lesson)
    expect(found).toContain('\\cap')
    expect(found).toContain('\\overline')

    for (const symbol of extractLatexSymbols(lesson)) {
      // Display forms are LaTeX source for the renderer...
      expect(symbol.displayLatex).toContain('\\')
      // ...never a pre-baked Unicode glyph or a font-dependent PUA character.
      expect(/[\uE000-\uF8FF]/.test(symbol.displayLatex)).toBe(false)
      expect(/[\u2229\u222A\u2208]/.test(symbol.displayLatex)).toBe(false)
    }
  })

  it('is idempotent', () => {
    const once = extractLatexSymbols('A \\cap B, \\overline{Y}')
    const twice = extractLatexSymbols(once.map((s) => s.displayLatex).join(' '))
    expect(twice.map((s) => s.latex).sort()).toEqual(once.map((s) => s.latex).sort())
  })

  it('handles empty and command-free text', () => {
    expect(extractLatexSymbols('')).toEqual([])
    expect(extractLatexSymbols('plain prose')).toEqual([])
  })
})

describe('extractSymbolsFromMarkdown', () => {
  const commands = (markdown: string): string[] =>
    extractSymbolsFromMarkdown(markdown).map((symbol) => symbol.latex)

  it('extracts from inline and display maths', () => {
    const markdown = [
      'The intersection \\(X \\cap Y\\) is shared.',
      '',
      '\\[',
      'X \\cup Y = \\{a\\}',
      '\\]',
    ].join('\n')

    expect(commands(markdown).sort()).toEqual(['\\cap', '\\cup'])
  })

  it('extracts from list items', () => {
    const markdown = ['- \\(X \\cap Y\\)', '- \\(\\overline{Y}\\)'].join('\n')
    expect(commands(markdown).sort()).toEqual(['\\cap', '\\overline'])
  })

  it('ignores commands inside fenced code blocks', () => {
    const markdown = [
      '```python',
      'path = "C:\\\\Users\\\\test"',
      'pattern = "\\\\cap"',
      '```',
      '',
      'Real maths: \\(A \\cup B\\).',
    ].join('\n')

    expect(commands(markdown)).toEqual(['\\cup'])
  })

  it('ignores bare commands that are not delimited as maths', () => {
    // The lesson prompt requires all maths to be wrapped, so prose that merely
    // mentions a command name must not populate the panel.
    const markdown = 'Use the \\cap command and \\frac for fractions, then \\sqrt.'
    expect(commands(markdown)).toEqual([])
  })

  it('ignores commands inside inline code spans', () => {
    const markdown = 'Type `\\overline` to get \\(\\overline{Y}\\).'
    expect(commands(markdown)).toEqual(['\\overline'])
  })

  it('deduplicates a symbol repeated across the whole lesson', () => {
    const markdown = [
      '## A',
      '',
      '\\(A \\cap B\\)',
      '',
      '## B',
      '',
      '\\(C \\cap D\\) and \\(E \\cap F\\)',
    ].join('\n')

    const found = extractSymbolsFromMarkdown(markdown)
    expect(found.filter((s) => s.latex === '\\cap')).toHaveLength(1)
  })

  it('returns nothing for a lesson with no maths', () => {
    expect(extractSymbolsFromMarkdown('# Topic\n\nJust prose.')).toEqual([])
  })
})

describe('collectMathFragments', () => {
  it('keeps only the maths, in document order', () => {
    const markdown = 'Text \\(x^2\\).\n\n\\[\ny = mx + b\n\\]\n\nMore \\(z\\).'
    expect(collectMathFragments(markdown)).toEqual(['x^2', 'y = mx + b', 'z'])
  })

  it('skips code blocks entirely', () => {
    expect(collectMathFragments('```\n\\cap\n```')).toEqual([])
  })
})

describe('symbolKey / isKnownSymbol', () => {
  it('strips the leading backslash', () => {
    expect(symbolKey('\\cap')).toBe('cap')
  })

  it('knows the common course symbols', () => {
    expect(isKnownSymbol('\\cap')).toBe(true)
    expect(isKnownSymbol('\\int')).toBe(true)
    expect(isKnownSymbol('\\varnothing')).toBe(false)
  })
})
