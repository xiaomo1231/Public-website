import mammoth from 'mammoth'

export interface DocxExtractedBlock {
  type: 'heading' | 'paragraph' | 'table' | 'list'
  level?: number
  text: string
  /** Raw HTML for tables (inner HTML of <table>) */
  html?: string
  /** Rows when type === 'table' (best-effort plain text) */
  rows?: string[][]
}

export interface DocxExtractionResult {
  blocks: DocxExtractedBlock[]
  textLength: number
  warnings: string[]
  metadata: { title?: string; author?: string }
}

interface ParseState {
  blocks: DocxExtractedBlock[]
  warnings: string[]
  inTable: number
}

function handleTag(state: ParseState, tag: string, attrs: Record<string, string>): string {
  const lower = tag.toLowerCase()
  if (lower === 'h1' || lower === 'h2' || lower === 'h3' || lower === 'h4' || lower === 'h5' || lower === 'h6') {
    state.blocks.push({ type: 'heading', level: Number(lower[1]), text: '' })
    return ''
  }
  if (lower === 'p') {
    state.blocks.push({ type: 'paragraph', text: '' })
    return ''
  }
  if (lower === 'table') {
    state.inTable++
    state.blocks.push({ type: 'table', text: '', rows: [], html: '<table>' })
    return ''
  }
  if (lower === 'ul' || lower === 'ol') {
    state.blocks.push({ type: 'list', text: '' })
    return ''
  }
  if (lower === 'tr' && state.inTable > 0) {
    const tbl = state.blocks[state.blocks.length - 1]
    if (tbl && tbl.type === 'table') tbl.rows!.push([])
    return ''
  }
  if (lower === 'td' || lower === 'th') {
    /* handled in text path */
    return ''
  }
  if (lower === 'br') return '\n'
  if (lower === 'li') return '\n• '
  void attrs
  return ''
}

function handleText(state: ParseState, text: string): void {
  const current = state.blocks[state.blocks.length - 1]
  if (!current) return
  current.text += text
  if (current.type === 'table' && current.html !== undefined) {
    // crude HTML preservation
    current.html += escapeHtml(text)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function handleCloseTag(state: ParseState, tag: string): void {
  const lower = tag.toLowerCase()
  if (lower === 'table') {
    state.inTable = Math.max(0, state.inTable - 1)
    const tbl = state.blocks[state.blocks.length - 1]
    if (tbl && tbl.type === 'table' && tbl.html !== undefined) tbl.html += '</table>'
  }
}

/**
 * Very small streaming HTML parser tailored to mammoth's output.
 * Handles headings, paragraphs, tables, lists.
 */
function parseMammothHtml(html: string): DocxExtractedBlock[] {
  const state: ParseState = { blocks: [], warnings: [], inTable: 0 }
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tagRe.exec(html)) !== null) {
    const before = html.slice(cursor, match.index)
    if (before) handleText(state, before)
    const tag = match[1]!
    const attrs = parseAttrs(match[2] ?? '')
    if (match[0].startsWith('</')) {
      handleCloseTag(state, tag)
    } else if (!isSelfClosing(tag)) {
      handleTag(state, tag, attrs)
    }
    cursor = match.index + match[0].length
  }
  const tail = html.slice(cursor)
  if (tail) handleText(state, tail)

  return state.blocks.filter((b) => b.text.trim().length > 0 || (b.type === 'table' && (b.rows?.length ?? 0) > 0))
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) attrs[m[1]!.toLowerCase()] = m[2] ?? ''
  return attrs
}

function isSelfClosing(tag: string): boolean {
  return ['br', 'img', 'hr', 'meta', 'link'].includes(tag.toLowerCase())
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