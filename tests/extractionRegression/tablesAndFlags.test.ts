import { describe, expect, it } from 'vitest'
import { layoutTextItems } from '@/infrastructure/files/pdfLayout'
import { chunksFromPdf } from '@/infrastructure/files/chunking'
import {
  layoutWarningsOf,
  mergeLayoutWarnings,
  needsVisualProofread,
} from '@/entities/chunk/layoutWarnings'
import { item } from './helpers'

const ctx = { documentId: 'd', projectId: 'p', documentName: 'Salts.pdf', type: 'pdf' as const }

function row(y: number, cells: Array<[string, number, number]>) {
  return cells.map(([text, x, w]) => item(text, x, y, w, 12))
}

describe('extraction regression — tables and low-confidence flags', () => {
  it('aligned-table: rows of short cells in clear columns become a Markdown table', () => {
    const lines = layoutTextItems([
      ...row(200, [
        ['Salt', 10, 30],
        ['Colour', 200, 40],
      ]),
      ...row(185, [
        ['Sodium chloride', 10, 80],
        ['White', 200, 30],
      ]),
      ...row(170, [
        ['Copper sulfate', 10, 75],
        ['Blue', 200, 25],
      ]),
      ...row(155, [
        ['Iron(III) oxide', 10, 78],
        ['Red-brown', 200, 50],
      ]),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]!.table).toBe(true)
    expect(lines[0]!.text).toBe(
      [
        '| Salt | Colour |',
        '| --- | --- |',
        '| Sodium chloride | White |',
        '| Copper sulfate | Blue |',
        '| Iron(III) oxide | Red-brown |',
      ].join('\n'),
    )
  })

  it('two-column-prose: long aligned text columns are not a table', () => {
    const long = 'a fairly long line of running prose in a column'
    const lines = layoutTextItems([
      ...row(200, [
        [long, 10, 250],
        [long, 300, 250],
      ]),
      ...row(185, [
        [long, 10, 250],
        [long, 300, 250],
      ]),
      ...row(170, [
        [long, 10, 250],
        [long, 300, 250],
      ]),
    ])
    expect(lines.every((line) => !line.table)).toBe(true)
    expect(lines).toHaveLength(3)
  })

  it('numeric-grid: a grid of bare numbers is flagged as a possible matrix, not tabulated', () => {
    const lines = layoutTextItems([
      ...row(200, [
        ['1', 40, 6],
        ['2', 80, 6],
        ['3', 120, 6],
      ]),
      ...row(185, [
        ['4', 40, 6],
        ['5', 80, 6],
        ['6', 120, 6],
      ]),
    ])
    expect(lines.every((line) => !line.table)).toBe(true)
    expect(lines.map((line) => line.text)).toEqual(['1 2 3', '4 5 6'])
    expect(lines.every((line) => line.warnings?.includes('matrix'))).toBe(true)
  })

  it('big-delimiters: bracket pieces of a lost matrix flag the line, text unchanged', () => {
    const lines = layoutTextItems([item('A = ⎡1 2⎤', 10, 100, 60, 12)])
    expect(lines[0]!.text).toBe('A = ⎡1 2⎤')
    expect(lines[0]!.warnings).toEqual(['matrix'])
  })

  it('table-chunks: table lines become one `table` chunk; flags reach the chunk', () => {
    const chunks = chunksFromPdf(ctx, [
      {
        pageNumber: 1,
        text: 'Intro line\n| A | B |\n| --- | --- |\n| 1 | 2 |\ny = k m + 1',
        headings: [],
        lineFlags: [null, { table: 0 }, { table: 0 }, { table: 0 }, { warnings: ['fraction'] }],
      },
    ])
    const table = chunks.find((chunk) => chunk.contentType === 'table')
    expect(table?.text).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
    const flagged = chunks.filter((chunk) => needsVisualProofread(chunk))
    expect(flagged).toHaveLength(1)
    expect(flagged[0]!.text).toContain('y = k m + 1')
    expect(layoutWarningsOf(chunks)).toEqual(['fraction'])
  })

  it('misaligned-flags: flags that do not line up with the text are ignored', () => {
    const chunks = chunksFromPdf(ctx, [
      { pageNumber: 1, text: 'one\ntwo', headings: [], lineFlags: [{ warnings: ['table'] }] },
    ])
    expect(chunks.some((chunk) => chunk.layoutWarnings)).toBe(false)
  })

  it('warning-helpers: merge is deduplicated and stable; unknown values are dropped', () => {
    expect(mergeLayoutWarnings(['table'], ['fraction', 'table'])).toEqual(['fraction', 'table'])
    expect(mergeLayoutWarnings(undefined, [])).toBeUndefined()
    expect(
      layoutWarningsOf({ layoutWarnings: ['superscript', 'bogus' as never, 'matrix'] }),
    ).toEqual(['superscript', 'matrix'])
    expect(needsVisualProofread([{}, { layoutWarnings: [] }])).toBe(false)
  })
})
