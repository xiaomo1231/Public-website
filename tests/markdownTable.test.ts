import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks } from '@/shared/lib/markdownText'
import {
  TABLE_LIMITS,
  parseDelimiterRow,
  splitTableRow,
  tryParseTable,
} from '@/shared/lib/markdownTable'

const noTerminator = (): boolean => false

describe('splitTableRow', () => {
  it('splits a standard row with outer pipes', () => {
    expect(splitTableRow('| a | b | c |')).toEqual(['a', 'b', 'c'])
  })

  it('splits a row without outer pipes', () => {
    expect(splitTableRow('a | b | c')).toEqual(['a', 'b', 'c'])
  })

  it('keeps empty cells', () => {
    expect(splitTableRow('| a |  | c |')).toEqual(['a', '', 'c'])
  })

  it('unescapes an escaped pipe', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
  })

  it('does not split on a pipe inside inline code', () => {
    expect(splitTableRow('| `a|b` | c |')).toEqual(['`a|b`', 'c'])
  })

  it('does not split on a pipe inside inline math', () => {
    expect(splitTableRow('| $|x|$ | y |')).toEqual(['$|x|$', 'y'])
  })
})

describe('parseDelimiterRow', () => {
  it('parses every alignment', () => {
    expect(parseDelimiterRow('| :--- | :---: | ---: |')).toEqual(['left', 'center', 'right'])
    expect(parseDelimiterRow('--- | ---')).toEqual(['left', 'left'])
  })

  it('accepts a single-column delimiter with outer pipes', () => {
    expect(parseDelimiterRow('| --- |')).toEqual(['left'])
  })

  it.each(['-- | --', 'abc | abc', '::: | :::', '---', 'no delimiter', '--'])(
    'rejects %s',
    (line) => {
      expect(parseDelimiterRow(line)).toBeNull()
    },
  )
})

describe('tryParseTable', () => {
  it('parses a standard truth table', () => {
    const table = tryParseTable(
      [
        '| P | Q | P∧Q |',
        '| :---: | :---: | :---: |',
        '| T | T | T |',
        '| T | F | F |',
        '| F | T | F |',
        '| F | F | F |',
      ],
      0,
      noTerminator,
    )
    expect(table?.header).toEqual(['P', 'Q', 'P∧Q'])
    expect(table?.align).toEqual(['center', 'center', 'center'])
    expect(table?.rows).toEqual([
      ['T', 'T', 'T'],
      ['T', 'F', 'F'],
      ['F', 'T', 'F'],
      ['F', 'F', 'F'],
    ])
    expect(table?.nextIndex).toBe(6)
  })

  it('parses a table without outer pipes', () => {
    const table = tryParseTable(['a | b', '--- | ---', '1 | 2'], 0, noTerminator)
    expect(table?.header).toEqual(['a', 'b'])
    expect(table?.rows).toEqual([['1', '2']])
  })

  it('pads short rows and truncates extra cells', () => {
    const table = tryParseTable(
      ['| a | b |', '| --- | --- |', '| 1 |', '| 1 | 2 | 3 |'],
      0,
      noTerminator,
    )
    expect(table?.rows).toEqual([
      ['1', ''],
      ['1', '2'],
    ])
  })

  it('stops at a blank line', () => {
    const table = tryParseTable(
      ['| a | b |', '| --- | --- |', '| 1 | 2 |', '', '| x | y |'],
      0,
      noTerminator,
    )
    expect(table?.nextIndex).toBe(3)
  })

  it('stops at a terminator', () => {
    const isTerminator = (line: string): boolean => line.startsWith('#')
    const table = tryParseTable(
      ['| a | b |', '| --- | --- |', '| 1 | 2 |', '# Heading'],
      0,
      isTerminator,
    )
    expect(table?.nextIndex).toBe(3)
  })

  it('rejects a missing or invalid delimiter', () => {
    expect(tryParseTable(['| a | b |', '| 1 | 2 |'], 0, noTerminator)).toBeNull()
    expect(tryParseTable(['| a | b |', '| -- | -- |'], 0, noTerminator)).toBeNull()
    expect(tryParseTable(['| a | b |', '| abc | abc |'], 0, noTerminator)).toBeNull()
  })

  it('rejects a column mismatch', () => {
    expect(tryParseTable(['| a | b | c |', '| --- | --- |'], 0, noTerminator)).toBeNull()
  })

  it('rejects a lone pipe sentence', () => {
    expect(
      tryParseTable(['The expression |x| means absolute value.', 'not a delimiter'], 0, noTerminator),
    ).toBeNull()
  })

  it('accepts a single-column table with outer pipes', () => {
    const table = tryParseTable(['| a |', '| --- |', '| 1 |'], 0, noTerminator)
    expect(table?.header).toEqual(['a'])
    expect(table?.rows).toEqual([['1']])
  })

  it('rejects a table over the column limit', () => {
    const columns = Array.from({ length: TABLE_LIMITS.maxColumns + 1 }, (_, i) => `c${i}`)
    const header = `| ${columns.join(' | ')} |`
    const delimiter = `| ${columns.map(() => '---').join(' | ')} |`
    expect(tryParseTable([header, delimiter], 0, noTerminator)).toBeNull()
  })

  it('rejects a table over the row limit', () => {
    const rows = Array.from({ length: TABLE_LIMITS.maxRows + 1 }, () => '| 1 |')
    expect(tryParseTable(['| a |', '| --- |', ...rows], 0, noTerminator)).toBeNull()
  })
})

describe('parseMarkdownBlocks — tables', () => {
  it('produces a table block for a truth table', () => {
    const blocks = parseMarkdownBlocks(
      [
        '| P | Q | P∧Q |',
        '| :---: | :---: | :---: |',
        '| T | T | T |',
        '| T | F | F |',
      ].join('\n'),
    )
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('expected a table block')
    expect(table.header).toHaveLength(3)
    expect(table.rows).toHaveLength(2)
    expect(table.align).toEqual(['center', 'center', 'center'])
  })

  it('keeps a lone |x| as a paragraph', () => {
    const blocks = parseMarkdownBlocks('The expression |x| means absolute value.')
    expect(blocks.some((block) => block.kind === 'table')).toBe(false)
    expect(blocks[0]?.kind).toBe('paragraph')
  })

  it('does not parse a table inside a code fence', () => {
    const blocks = parseMarkdownBlocks(['```', '| a | b |', '| --- | --- |', '```'].join('\n'))
    expect(blocks.some((block) => block.kind === 'table')).toBe(false)
    expect(blocks[0]?.kind).toBe('code')
  })

  it('does not parse a table inside display math', () => {
    const blocks = parseMarkdownBlocks(['\\[', '| a | b |', '| --- | --- |', '\\]'].join('\n'))
    expect(blocks.some((block) => block.kind === 'table')).toBe(false)
  })

  it('keeps a table inside its section', () => {
    const blocks = parseMarkdownBlocks(
      ['## Example', '', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
    )
    expect(blocks[0]?.kind).toBe('heading')
    expect(blocks.some((block) => block.kind === 'table')).toBe(true)
  })

  it('renders inline math and code inside cells', () => {
    const blocks = parseMarkdownBlocks(
      ['| E | M |', '| --- | --- |', '| $A \\cap B$ | `x && y` |'].join('\n'),
    )
    const table = blocks.find((block) => block.kind === 'table')
    if (table?.kind !== 'table') throw new Error('expected a table block')
    expect(table.rows[0]?.[0]?.some((span) => span.kind === 'math')).toBe(true)
    expect(table.rows[0]?.[1]?.some((span) => span.kind === 'code')).toBe(true)
  })

  it('is deterministic', () => {
    const text = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(parseMarkdownBlocks(text)).toEqual(parseMarkdownBlocks(text))
  })
})
