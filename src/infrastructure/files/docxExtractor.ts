import mammoth from 'mammoth'
import { toMarkdownTable } from '@/shared/lib/markdownTable'

export interface DocxExtractedBlock {
  type: 'heading' | 'paragraph' | 'table' | 'list'
  level?: number
  /**
   * Plain text. Lists: one line per item (`• item` / `1. item`, nested items
   * indented). Tables: a Markdown pipe table built from `rows`.
   */
  text: string
  /** Rows when type === 'table' (plain text cells; merged cells expanded). */
  rows?: string[][]
}

export interface DocxExtractionResult {
  blocks: DocxExtractedBlock[]
  textLength: number
  warnings: string[]
  metadata: { title?: string; author?: string }
}

const HEADING = /^h([1-6])$/
/** Upper bound for a cell's colspan / rowspan; guards against hostile values. */
const MAX_SPAN = 50

function tagOf(el: Element): string {
  return el.tagName.toLowerCase()
}

/**
 * Inline text of an element, with `<br>` as a line break. Nested lists and
 * tables are skipped — they become their own lines / blocks.
 */
function inlineText(el: Element, skipNested = true): string {
  let out = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? ''
    } else if (node.nodeType === 1) {
      const child = node as Element
      const tag = tagOf(child)
      if (tag === 'br') out += '\n'
      else if (skipNested && (tag === 'ul' || tag === 'ol' || tag === 'table')) continue
      else if (tag === 'p' || HEADING.test(tag))
        out += `${out && !out.endsWith('\n') ? '\n' : ''}${inlineText(child, skipNested)}\n`
      else out += inlineText(child, skipNested)
    }
  }
  return out
}

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** One line per list item; ordered lists keep their numbers, nesting is indented. */
function listLines(list: Element, depth: number): string[] {
  const ordered = tagOf(list) === 'ol'
  let number = Number(list.getAttribute('start') ?? '1')
  if (!Number.isFinite(number)) number = 1
  const lines: string[] = []
  for (const item of Array.from(list.children)) {
    if (tagOf(item) !== 'li') continue
    const text = tidy(inlineText(item)).replace(/\n/g, ' ')
    const marker = ordered ? `${number}.` : '•'
    number += 1
    if (text) lines.push(`${'  '.repeat(depth)}${marker} ${text}`)
    for (const nested of Array.from(item.children)) {
      const tag = tagOf(nested)
      if (tag === 'ul' || tag === 'ol') lines.push(...listLines(nested, depth + 1))
    }
  }
  return lines
}

function span(el: Element, name: 'colspan' | 'rowspan'): number {
  const value = Number(el.getAttribute(name) ?? '1')
  return Number.isFinite(value) && value >= 1 ? Math.min(MAX_SPAN, Math.floor(value)) : 1
}

/**
 * Table rows as plain text. A merged cell's text goes in its first (top-left)
 * position and the positions it also covers are left empty, so every row keeps
 * the table's column alignment.
 */
function tableRows(table: Element): string[][] {
  const rows: string[][] = []
  // Columns still covered by a rowspan from an earlier row: column → rows left.
  const covered = new Map<number, number>()
  const trs = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
  for (const tr of trs) {
    const row: string[] = []
    let column = 0
    const skipCovered = () => {
      while ((covered.get(column) ?? 0) > 0) {
        row[column] = ''
        column += 1
      }
    }
    for (const cell of Array.from(tr.children)) {
      const tag = tagOf(cell)
      if (tag !== 'td' && tag !== 'th') continue
      skipCovered()
      const colspan = span(cell, 'colspan')
      const rowspan = span(cell, 'rowspan')
      row[column] = tidy(inlineText(cell, false)).replace(/\n/g, ' ')
      for (let k = 0; k < colspan; k++) {
        if (k > 0) row[column + k] = ''
        if (rowspan > 1) covered.set(column + k, rowspan)
      }
      column += colspan
    }
    skipCovered()
    // This row consumed one row of every rowspan that covers it.
    for (const [col, left] of [...covered]) {
      if (left <= 1) covered.delete(col)
      else covered.set(col, left - 1)
    }
    rows.push(Array.from({ length: row.length }, (_, i) => row[i] ?? ''))
  }
  return rows
}

/**
 * Turn mammoth's HTML into blocks. Parsed with the browser's HTML parser, so
 * character references (`&lt;`, `&amp;`, `&#x3B1;`) are decoded once.
 */
export function parseMammothHtml(html: string): DocxExtractedBlock[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks: DocxExtractedBlock[] = []
  for (const el of Array.from(doc.body.children)) {
    const tag = tagOf(el)
    const heading = HEADING.exec(tag)
    if (heading) {
      const text = tidy(inlineText(el)).replace(/\n/g, ' ')
      if (text) blocks.push({ type: 'heading', level: Number(heading[1]), text })
    } else if (tag === 'ul' || tag === 'ol') {
      const text = listLines(el, 0).join('\n')
      if (text) blocks.push({ type: 'list', text })
    } else if (tag === 'table') {
      const rows = tableRows(el)
      const text = toMarkdownTable(rows)
      if (text) blocks.push({ type: 'table', text, rows })
    } else {
      const text = tidy(inlineText(el, false))
      if (text) blocks.push({ type: 'paragraph', text })
    }
  }
  return blocks
}

/**
 * Extract content from a DOCX Blob.
 */
export async function extractDocx(blob: Blob): Promise<DocxExtractionResult> {
  const arrayBuffer = await blob.arrayBuffer()
  const warnings: string[] = []
  let html = ''
  let title: string | undefined
  let author: string | undefined
  try {
    // mammoth's unzip.openZip looks at `.buffer` (Node Buffer) or `.path`.
    // We pass the ArrayBuffer under both keys so it works in browsers too.
    const result = await mammoth.convertToHtml({
      arrayBuffer,
      buffer: Buffer.from(arrayBuffer),
    } as Parameters<typeof mammoth.convertToHtml>[0])
    html = result.value
    warnings.push(...result.messages.map((m) => `mammoth: ${m.message}`))
  } catch (err) {
    throw new Error(`DOCX conversion failed: ${(err as Error).message}`)
  }

  const blocks = parseMammothHtml(html)
  const textLength = blocks.reduce((acc, b) => acc + b.text.length, 0)

  // Find a likely title: first heading
  const firstHeading = blocks.find((b) => b.type === 'heading')
  if (firstHeading) title = firstHeading.text

  return {
    blocks,
    textLength,
    warnings,
    metadata: { title, author },
  }
}
