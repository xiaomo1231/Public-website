import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks, splitInline } from '@/shared/lib/markdownText'

describe('splitInline', () => {
  it('leaves plain text alone', () => {
    expect(splitInline('just words')).toEqual([{ kind: 'text', value: 'just words' }])
  })

  it('extracts inline LaTeX written as \\( … \\)', () => {
    const spans = splitInline('The intersection \\(X \\cap Y\\) of two sets.')
    expect(spans).toContainEqual({ kind: 'math', value: 'X \\cap Y', display: false })
  })

  it('extracts inline LaTeX written as $ … $', () => {
    const spans = splitInline('We write $x^2 + y^2$ here.')
    expect(spans).toContainEqual({ kind: 'math', value: 'x^2 + y^2', display: false })
  })

  it('extracts display LaTeX written as \\[ … \\]', () => {
    const spans = splitInline('\\[\\int_0^\\infty e^{-x^2} dx\\]')
    expect(spans).toContainEqual({
      kind: 'math',
      value: '\\int_0^\\infty e^{-x^2} dx',
      display: true,
    })
  })

  it('extracts display LaTeX written as $$ … $$', () => {
    const spans = splitInline('$$\\frac{a}{b}$$')
    expect(spans).toContainEqual({ kind: 'math', value: '\\frac{a}{b}', display: true })
  })

  it('parses bold, italic and code', () => {
    expect(splitInline('**bold**')).toEqual([{ kind: 'strong', value: 'bold' }])
    expect(splitInline('*italic*')).toEqual([{ kind: 'em', value: 'italic' }])
    expect(splitInline('`code`')).toEqual([{ kind: 'code', value: 'code' }])
  })

  it('does not mistake spaced asterisks for italics', () => {
    expect(splitInline('a * b * c')).toEqual([{ kind: 'text', value: 'a * b * c' }])
  })

  it('leaves LaTeX inside code spans untouched', () => {
    expect(splitInline('`\\cap`')).toEqual([{ kind: 'code', value: '\\cap' }])
  })

  it('handles a lone currency sign as prose', () => {
    expect(splitInline('costs $ 5')).toEqual([{ kind: 'text', value: 'costs $ 5' }])
  })

  it('mixes Chinese prose with LaTeX', () => {
    const spans = splitInline('集合的交集记作 \\(A \\cap B\\)。')
    expect(spans[0]).toEqual({ kind: 'text', value: '集合的交集记作 ' })
    expect(spans[1]).toEqual({ kind: 'math', value: 'A \\cap B', display: false })
    expect(spans[2]).toEqual({ kind: 'text', value: '。' })
  })
})

describe('parseMarkdownBlocks', () => {
  it('parses headings by level', () => {
    const blocks = parseMarkdownBlocks('# One\n\n## Two\n\n### Three')
    expect(blocks.map((b) => (b.kind === 'heading' ? b.level : null))).toEqual([1, 2, 3])
  })

  it('parses a paragraph', () => {
    const blocks = parseMarkdownBlocks('Just a sentence.')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('paragraph')
  })

  it('keeps a single newline inside a paragraph', () => {
    const blocks = parseMarkdownBlocks('line one\nline two')
    expect(blocks).toHaveLength(1)
    const spans = blocks[0]!.kind === 'paragraph' ? blocks[0]!.spans : []
    expect(spans[0]).toEqual({ kind: 'text', value: 'line one\nline two' })
  })

  it('parses unordered lists', () => {
    const blocks = parseMarkdownBlocks('- one\n- two\n- three')
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false })
    if (blocks[0]!.kind === 'list') expect(blocks[0]!.items).toHaveLength(3)
  })

  it('parses ordered lists', () => {
    const blocks = parseMarkdownBlocks('1. one\n2. two')
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true })
  })

  it('parses blockquotes', () => {
    const blocks = parseMarkdownBlocks('> quoted text')
    expect(blocks[0]).toMatchObject({ kind: 'quote' })
  })

  it('parses fenced code blocks verbatim', () => {
    const blocks = parseMarkdownBlocks('```\nconst x = 1\n```')
    expect(blocks[0]).toEqual({ kind: 'code', value: 'const x = 1' })
  })

  it('parses a line that is only display maths', () => {
    const blocks = parseMarkdownBlocks('\\[X \\cap Y = \\{c\\}\\]')
    expect(blocks[0]).toEqual({ kind: 'math', value: 'X \\cap Y = \\{c\\}' })
  })

  it('parses a lesson-shaped document', () => {
    const lesson = [
      '## Overview',
      '',
      'The intersection of two sets is written \\(X \\cap Y\\).',
      '',
      '## Example',
      '',
      '\\[',
      'X \\cap Y = \\{c\\}',
      '\\]',
      '',
      'Common mistakes:',
      '',
      '- Confusing \\(\\cap\\) with \\(\\cup\\)',
      '- Forgetting the complement \\(\\overline{Y}\\)',
    ].join('\n')

    const blocks = parseMarkdownBlocks(lesson)
    const kinds = blocks.map((b) => b.kind)
    expect(kinds).toContain('heading')
    expect(kinds).toContain('paragraph')
    expect(kinds).toContain('list')

    // The block maths survives as a single block.
    expect(blocks.some((b) => b.kind === 'math' && b.value.includes('X \\cap Y'))).toBe(true)
  })

  it('handles an empty document', () => {
    expect(parseMarkdownBlocks('')).toEqual([])
    expect(parseMarkdownBlocks('   \n\n  ')).toEqual([])
  })

  it('does not crash on unbalanced LaTeX', () => {
    expect(() => parseMarkdownBlocks('unclosed \\(x + 1')).not.toThrow()
    expect(() => parseMarkdownBlocks('\\frac{a}{')).not.toThrow()
  })
})
