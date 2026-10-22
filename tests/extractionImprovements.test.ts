import { describe, expect, it } from 'vitest'
import { extractDocx, parseMammothHtml } from '@/infrastructure/files/docxExtractor'
import { extractPptx, extractPptxSlideImages } from '@/infrastructure/files/pptxExtractor'
import { chunksFromDocx, chunksFromText, splitSentences } from '@/infrastructure/files/chunking'
import { repairSymbolFontText, SYMBOL_FONT_MAP } from '@/infrastructure/files/textEncoding'
import { escapeTableCell, toMarkdownTable, tryParseTable } from '@/shared/lib/markdownTable'
import { makeTestDocx } from './fixtures/makeTestDocx'
import { makeTestPptx } from './fixtures/makeTestPptx'

const ctx = {
  documentId: 'doc-1',
  projectId: 'project-1',
  documentName: 'notes.docx',
  type: 'docx' as const,
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
const p = (text: string) => `<w:p>${run(text)}</w:p>`
const cell = (text: string, props = '') =>
  `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ''}${text ? p(text) : '<w:p/>'}</w:tc>`

describe('DOCX extraction — tables, lists, entities', () => {
  it('extracts a table as a Markdown pipe table with merged cells kept aligned', async () => {
    const table = `<w:tbl>
      <w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>
      <w:tr>${cell('Drug')}${cell('Dose | route')}${cell('Note')}</w:tr>
      <w:tr>${cell('Aspirin', '<w:vMerge w:val="restart"/>')}${cell('81 mg &lt; 100 mg', '<w:gridSpan w:val="2"/>')}</w:tr>
      <w:tr>${cell('', '<w:vMerge/>')}${cell('oral')}${cell('daily')}</w:tr>
    </w:tbl>`
    const blob = await makeTestDocx({ headings: ['Doses'], paragraphs: [], bodyXml: table })
    const result = await extractDocx(blob)
    const block = result.blocks.find((b) => b.type === 'table')!
    expect(block.rows).toEqual([
      ['Drug', 'Dose | route', 'Note'],
      ['Aspirin', '81 mg < 100 mg', ''],
      ['', 'oral', 'daily'],
    ])
    expect(block.text.split('\n')).toEqual([
      '| Drug | Dose \\| route | Note |',
      '| --- | --- | --- |',
      '| Aspirin | 81 mg < 100 mg |  |',
      '|  | oral | daily |',
    ])

    const chunks = chunksFromDocx(ctx, result.blocks)
    const tableChunk = chunks.find((c) => c.contentType === 'table')!
    expect(tableChunk.text).toBe(block.text)
    // The stored chunk renders as a real table, with the escaped pipe intact.
    const parsed = tryParseTable(tableChunk.text.split('\n'), 0, () => false)
    expect(parsed?.header).toHaveLength(3)
    expect(parsed?.header[1]).toMatch(/Dose \\?\| route/)
    expect(parsed?.rows).toHaveLength(2)
  })

  it('puts each list item on its own line with its bullet or number', async () => {
    const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`
    const item = (numId: number, text: string) =>
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`
    const blob = await makeTestDocx({
      headings: ['Lists'],
      paragraphs: [],
      numberingXml: numbering,
      bodyXml: [
        item(1, 'Alpha'),
        item(1, 'Beta'),
        p('Between'),
        item(2, 'First'),
        item(2, 'Second'),
      ].join(''),
    })
    const result = await extractDocx(blob)
    const lists = result.blocks.filter((b) => b.type === 'list').map((b) => b.text)
    expect(lists).toEqual(['• Alpha\n• Beta', '1. First\n2. Second'])
  })

  it('decodes HTML character references instead of storing them literally', async () => {
    const blob = await makeTestDocx({
      headings: ['A &amp; B'],
      paragraphs: ['x < y && y > z, "quoted" & \u03b1'],
    })
    const result = await extractDocx(blob)
    expect(result.blocks[0]!.text).toBe('A &amp; B')
    expect(result.blocks[1]!.text).toBe('x < y && y > z, "quoted" & \u03b1')
    expect(result.blocks.map((b) => b.text).join(' ')).not.toMatch(
      /&(lt|gt|amp|quot|#x?\w+);(?! B)/,
    )
  })

  it('handles nested lists, ordered start numbers, rowspan and entities in raw HTML', () => {
    const blocks = parseMammothHtml(
      '<ol start="3"><li>Three<ul><li>child &#x3B1;</li></ul></li><li>Four</li></ol>' +
        '<table><tr><th rowspan="2">A</th><th>B</th></tr><tr><td>c</td></tr></table>' +
        '<p>Line one<br />Line &lt;two&gt;</p>',
    )
    expect(blocks[0]).toEqual({ type: 'list', text: '3. Three\n  • child \u03b1\n4. Four' })
    expect(blocks[1]!.rows).toEqual([
      ['A', 'B'],
      ['', 'c'],
    ])
    expect(blocks[2]).toEqual({ type: 'paragraph', text: 'Line one\nLine <two>' })
  })
})

describe('Markdown table serialization', () => {
  it('escapes pipes and flattens line breaks in cells', () => {
    expect(escapeTableCell('a | b\nc')).toBe('a \\| b c')
  })

  it('pads short rows and drops an all-empty table', () => {
    expect(toMarkdownTable([['h1', 'h2'], ['x']])).toBe('| h1 | h2 |\n| --- | --- |\n| x |  |')
    expect(toMarkdownTable([[''], ['']])).toBe('')
  })
})

describe('PPTX extraction — notes and slide order', () => {
  it('resolves speaker notes through each slide relationships file', async () => {
    const blob = await makeTestPptx({
      slides: [
        { title: 'One', body: 'First body', notes: 'Notes for one', notesFileNumber: 2 },
        { title: 'Two', body: 'Second body' },
        { title: 'Three', body: 'Third body', notes: 'Notes for three', notesFileNumber: 1 },
      ],
    })
    const result = await extractPptx(blob)
    expect(result.slides.map((s) => s.notes)).toEqual(['Notes for one', '', 'Notes for three'])
  })

  it('orders slides by the presentation slide list, numbering by position', async () => {
    const blob = await makeTestPptx({
      slides: [
        { title: 'File one', body: 'a', notes: 'n1' },
        { title: 'File two', body: 'b' },
        { title: 'File three', body: 'c', images: [{ name: 'pic.png' }] },
      ],
      order: [3, 1, 2],
    })
    const result = await extractPptx(blob)
    expect(result.slides.map((s) => [s.slideNumber, s.title, s.notes])).toEqual([
      [1, 'File three', ''],
      [2, 'File one', 'n1'],
      [3, 'File two', ''],
    ])
    // Images use the same numbering, so figures stay on the right slide.
    const images = await extractPptxSlideImages(blob)
    expect(images.map((image) => image.slideNumber)).toEqual([1])
  })

  it('leaves slide parts that are not in the deck out', async () => {
    const blob = await makeTestPptx({
      slides: [
        { title: 'Kept', body: 'a' },
        { title: 'Orphan', body: 'b' },
      ],
      order: [1],
    })
    const result = await extractPptx(blob)
    expect(result.slides.map((s) => s.title)).toEqual(['Kept'])
  })
})

describe('chunking — CJK sentences', () => {
  it('splits on CJK terminators without a following space', () => {
    const sentences = splitSentences('第一句。第二句！第三句？第四句；最后')
    expect(sentences.map((s) => s.text)).toEqual([
      '第一句。',
      '第二句！',
      '第三句？',
      '第四句；',
      '最后',
    ])
    expect(sentences.slice(1).every((s) => s.joiner === '')).toBe(true)
  })

  it('never splits inside a formula', () => {
    const sentences = splitSentences('设 $a。b$ 为常数。然后 $$x！y$$ 成立。')
    expect(sentences.map((s) => s.text)).toEqual(['设 $a。b$ 为常数。', '然后 $$x！y$$ 成立。'])
  })

  it('keeps long Chinese text within the chunk limit and loses nothing', () => {
    const sentence = '矩阵的特征值是特征多项式的根，它描述了线性变换在特征向量方向上的伸缩比例。'
    const text = sentence.repeat(60)
    const chunks = chunksFromText(ctx, text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(800)
    // Joined without inserted spaces; every sentence survives.
    const joined = chunks.map((c) => c.text).join('')
    expect(joined).not.toMatch(/。 /)
    expect(joined.split(sentence).length - 1).toBeGreaterThanOrEqual(60)
  })

  it('splits a long run with no terminator at a comma, outside maths', () => {
    const text = `${'这是一个没有句号的很长的从句，'.repeat(80)}$x+y$`
    const chunks = chunksFromText(ctx, text)
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(800)
    expect(chunks.at(-1)!.text.endsWith('$x+y$')).toBe(true)
  })

  it('keeps English splitting unchanged', () => {
    const sentences = splitSentences('Pi is 3.14 here. Next one! e.g. done')
    expect(sentences.map((s) => s.text)).toEqual(['Pi is 3.14 here.', 'Next one!', 'e.g.', 'done'])
  })

  it('splits an over-long Markdown table by rows, repeating the header', () => {
    const rows = [['Term', 'Definition']]
    for (let i = 0; i < 40; i++) rows.push([`term ${i}`, `definition number ${i} `.repeat(3)])
    const chunks = chunksFromDocx(ctx, [
      { type: 'table', text: toMarkdownTable(rows), rows },
      { type: 'table', text: toMarkdownTable([['A'], ['b']]), rows: [['A'], ['b']] },
    ])
    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks) {
      expect(chunk.contentType).toBe('table')
      expect(chunk.text.length).toBeLessThanOrEqual(800)
      expect(chunk.text.split('\n')[1]).toMatch(/^\| --- \|/)
    }
    // The second, separate table is not merged into the first.
    expect(chunks.at(-1)!.text).toBe('| A |\n| --- |\n| b |')
  })
})

describe('Symbol font repair — large delimiter pieces', () => {
  it('maps right bracket and brace pieces to right glyphs', () => {
    expect(SYMBOL_FONT_MAP[0xf9]).toBe('\u23a4')
    expect(SYMBOL_FONT_MAP[0xfa]).toBe('\u23a5')
    expect(SYMBOL_FONT_MAP[0xfb]).toBe('\u23a6')
    expect(SYMBOL_FONT_MAP[0xfc]).toBe('\u23ab')
    expect(SYMBOL_FONT_MAP[0xfd]).toBe('\u23ac')
    expect(SYMBOL_FONT_MAP[0xfe]).toBe('\u23ad')
  })

  it('maps the left pieces and the extenders that were missing', () => {
    expect(repairSymbolFontText('\uf0e6\uf0e7\uf0e8')).toBe('\u239b\u239c\u239d')
    expect(repairSymbolFontText('\uf0e9\uf0ea\uf0eb')).toBe('\u23a1\u23a2\u23a3')
    expect(repairSymbolFontText('\uf0ec\uf0ed\uf0ee\uf0ef')).toBe('\u23a7\u23a8\u23a9\u23aa')
    expect(repairSymbolFontText('\uf0f3\uf0f4\uf0f5')).toBe('\u2320\u23ae\u2321')
    // 0xF0 is not part of the encoding and stays untouched.
    expect(repairSymbolFontText('\uf0f0')).toBe('\uf0f0')
  })
})
