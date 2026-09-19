import { describe, expect, it } from 'vitest'
import {
  asPseudoHeading,
  classifyTeachingBlock,
  normalizeHeadingText,
} from '@/shared/lib/teachingBlocks'
import { parseLessonSections, promotePseudoHeadings } from '@/shared/lib/lessonDocument'
import { parseMarkdownBlocks } from '@/shared/lib/markdownText'

describe('classifyTeachingBlock', () => {
  it('recognises the formal teaching blocks', () => {
    expect(classifyTeachingBlock('Definition')?.kind).toBe('definition')
    expect(classifyTeachingBlock('Key Idea')?.kind).toBe('keyIdea')
    expect(classifyTeachingBlock('Example')?.kind).toBe('example')
    expect(classifyTeachingBlock('Worked Example')?.kind).toBe('workedExample')
    expect(classifyTeachingBlock('Important')?.kind).toBe('important')
    expect(classifyTeachingBlock('Warning')?.kind).toBe('warning')
    expect(classifyTeachingBlock('Note')?.kind).toBe('note')
    expect(classifyTeachingBlock('Common Mistake')?.kind).toBe('commonMistake')
  })

  it('recognises the structural sections', () => {
    expect(classifyTeachingBlock('Explanation')?.kind).toBe('explanation')
    expect(classifyTeachingBlock('Intuition')?.kind).toBe('intuition')
    expect(classifyTeachingBlock('Summary')?.kind).toBe('summary')
    expect(classifyTeachingBlock('Overview')?.kind).toBe('overview')
  })

  it('marks formal blocks as boxed and structural sections as plain', () => {
    expect(classifyTeachingBlock('Definition')?.boxed).toBe(true)
    expect(classifyTeachingBlock('Example')?.boxed).toBe(true)
    expect(classifyTeachingBlock('Common Mistake')?.boxed).toBe(true)
    expect(classifyTeachingBlock('Summary')?.boxed).toBe(false)
    expect(classifyTeachingBlock('Explanation')?.boxed).toBe(false)
  })

  it('matches case-insensitively and ignores a trailing colon', () => {
    expect(classifyTeachingBlock('definition')?.kind).toBe('definition')
    expect(classifyTeachingBlock('DEFINITION')?.kind).toBe('definition')
    expect(classifyTeachingBlock('Definition:')?.kind).toBe('definition')
  })

  it('recognises the Chinese section titles', () => {
    expect(classifyTeachingBlock('定义')?.kind).toBe('definition')
    expect(classifyTeachingBlock('核心概念')?.kind).toBe('keyIdea')
    expect(classifyTeachingBlock('示例')?.kind).toBe('example')
    expect(classifyTeachingBlock('常见错误')?.kind).toBe('commonMistake')
    expect(classifyTeachingBlock('总结')?.kind).toBe('summary')
  })

  it('returns nothing for ordinary headings', () => {
    expect(classifyTeachingBlock('Sets and Set Operations')).toBeUndefined()
    expect(classifyTeachingBlock('The chain rule')).toBeUndefined()
    expect(classifyTeachingBlock('')).toBeUndefined()
  })

  it('gives every block an i18n label key and an icon', () => {
    for (const heading of ['Definition', 'Example', 'Note', 'Warning', 'Summary']) {
      const spec = classifyTeachingBlock(heading)
      expect(spec?.labelKey).toMatch(/^teach\./)
      expect(spec?.icon).toBeDefined()
    }
  })
})

describe('normalizeHeadingText', () => {
  it('strips emphasis, hashes, colons and extra whitespace', () => {
    expect(normalizeHeadingText('**Intuition:**')).toBe('intuition')
    expect(normalizeHeadingText('## Key   Idea')).toBe('key idea')
    expect(normalizeHeadingText('  Definition:  ')).toBe('definition')
  })
})

describe('asPseudoHeading', () => {
  it('promotes a bold label that names a teaching block', () => {
    expect(asPseudoHeading('**Intuition:**')).toBe('Intuition')
    expect(asPseudoHeading('**Key Idea**')).toBe('Key Idea')
    expect(asPseudoHeading('**Example:**')).toBe('Example')
  })

  it('leaves ordinary bold text alone', () => {
    expect(asPseudoHeading('**sets** are collections')).toBeUndefined()
    expect(asPseudoHeading('The **universal set** contains everything')).toBeUndefined()
  })

  it('does not promote multi-line content', () => {
    expect(asPseudoHeading('**Intuition:**\nmore text')).toBeUndefined()
  })

  it('handles empty input', () => {
    expect(asPseudoHeading('')).toBeUndefined()
    expect(asPseudoHeading('   ')).toBeUndefined()
  })
})

describe('promotePseudoHeadings', () => {
  it('turns a bold pseudo-heading paragraph into a real heading', () => {
    const blocks = promotePseudoHeadings(parseMarkdownBlocks('**Intuition:**\n\nThe idea is simple.'))
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 2 })
  })

  it('leaves real headings and normal paragraphs untouched', () => {
    const blocks = promotePseudoHeadings(
      parseMarkdownBlocks('## Real Heading\n\nA paragraph with **bold** words.'),
    )
    expect(blocks[0]?.kind).toBe('heading')
    expect(blocks[1]?.kind).toBe('paragraph')
  })
})

describe('parseLessonSections', () => {
  const lesson = [
    '# Set Operations',
    '',
    'Sets can be combined in several ways.',
    '',
    '## Definition',
    '',
    'The intersection of two sets contains the shared elements.',
    '',
    '## Example',
    '',
    'Let \\(X = \\{a,c,e\\}\\).',
    '',
    '\\[',
    'X \\cap Y = \\{c\\}',
    '\\]',
    '',
    '## Common Mistake',
    '',
    'Do not confuse \\(X - Y\\) with \\(Y - X\\).',
    '',
    '## Summary',
    '',
    'Intersection keeps what is shared.',
  ].join('\n')

  it('groups each teaching block with the content that follows it', () => {
    const sections = parseLessonSections(lesson)
    const kinds = sections.map((s) => s.spec?.kind)

    expect(kinds).toContain('definition')
    expect(kinds).toContain('example')
    expect(kinds).toContain('commonMistake')
    expect(kinds).toContain('summary')
  })

  it('keeps the maths inside the block that introduced it', () => {
    const example = parseLessonSections(lesson).find((s) => s.spec?.kind === 'example')
    expect(example).toBeDefined()
    expect(example!.blocks.some((b) => b.kind === 'math')).toBe(true)
  })

  it('leaves prose before the first block in an untyped section', () => {
    const [first] = parseLessonSections(lesson)
    expect(first?.spec).toBeUndefined()
    expect(first?.blocks.some((b) => b.kind === 'heading')).toBe(true)
  })

  it('closes a block at the next heading of the same level', () => {
    const sections = parseLessonSections(lesson)
    const definition = sections.find((s) => s.spec?.kind === 'definition')
    // The definition must not swallow the example that follows it.
    expect(definition!.blocks.some((b) => b.kind === 'heading')).toBe(false)
  })

  it('promotes bold pseudo-headings before grouping', () => {
    const sections = parseLessonSections('**Intuition:**\n\nThe idea is simple.')
    expect(sections[0]?.spec?.kind).toBe('intuition')
  })

  it('renders an unrecognised heading as a plain section', () => {
    const sections = parseLessonSections('## A Normal Heading\n\nBody text.')
    expect(sections[0]?.spec).toBeUndefined()
    expect(sections[0]?.blocks[0]?.kind).toBe('heading')
  })

  it('handles an empty lesson', () => {
    expect(parseLessonSections('')).toEqual([])
  })
})
