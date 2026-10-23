import type {
  ChunkContentType,
  DocumentType,
  LearningMaterialType,
} from '@/entities/document/types'
import type { DocumentChunk, NewChunkInput } from '@/entities/chunk/types'
import { buildSourceReference } from '@/entities/chunk/types'
import { mergeLayoutWarnings, type LayoutWarning } from '@/entities/chunk/layoutWarnings'
import { toMarkdownTable } from '@/shared/lib/markdownTable'
import { markedAnswerLine, type MarkedOption } from './markedOptions'

/** Section of the chunks that list an answer key's marked options. */
export const MARKED_ANSWERS_SECTION = 'Marked answers (from highlighted options)'

/**
 * Generic text chunker.
 * Splits text into ~MAX tokens worth of characters, trying to break on
 * sentence boundaries. Honours existing heading-prefixed sections when present.
 */
const MAX_CHUNK_CHARS = 800
const OVERLAP_CHARS = 80

interface ChunkLine {
  contentType: ChunkContentType
  text: string
  pageNumber?: number
  section?: string
  layoutWarnings?: LayoutWarning[]
}

/** What joins a sentence to the previous one: a line break, a space, or nothing (CJK). */
type Joiner = '' | ' ' | '\n'

interface Sentence {
  text: string
  joiner: Joiner
}

/** The joiner a run of whitespace stands for: a line break survives as one. */
function joinerFor(whitespace: string): Joiner {
  if (!whitespace) return ''
  return whitespace.includes('\n') ? '\n' : ' '
}

/** Inline (`$…$`) and display (`$$…$$`) maths spans; never split inside. */
function mathSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  const re = /\$\$[\s\S]+?\$\$|(?<!\\)\$[^$\n]+?(?<!\\)\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) spans.push([m.index, m.index + m[0].length])
  return spans
}

function insideSpan(spans: Array<[number, number]>, index: number): boolean {
  return spans.some(([start, end]) => index > start && index < end)
}

const ASCII_TERMINATOR = /[.!?]/
const CJK_TERMINATOR = /[。！？；]/
/** Closing quotes / brackets that stay with the sentence they end. */
const CLOSERS = /[」』”’）)】〉》"']/

/**
 * Split text into sentences. A line break always ends one (and is kept as the
 * joiner); Latin terminators only end a sentence when whitespace follows; CJK
 * terminators (。！？；) end one even without a following space, since Chinese
 * text has none. Nothing inside a `$…$` / `$$…$$` formula is ever a boundary.
 */
export function splitSentences(text: string): Sentence[] {
  const spans = mathSpans(text)
  const out: Sentence[] = []
  let start = 0
  let pendingJoiner: Joiner = ''
  const push = (end: number, next: number) => {
    const piece = text.slice(start, end).trim()
    if (piece) {
      out.push({ text: piece, joiner: out.length === 0 ? '' : pendingJoiner })
      pendingJoiner = joinerFor(text.slice(end, next))
    } else if (text.slice(end, next).includes('\n')) {
      pendingJoiner = '\n'
    }
    start = next
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (insideSpan(spans, i)) {
      i++
      continue
    }
    if (ch === '\n') {
      let next = i
      while (next < text.length && /\s/.test(text[next]!)) next++
      push(i, next)
      i = next
      continue
    }
    const cjk = CJK_TERMINATOR.test(ch)
    if (cjk || ASCII_TERMINATOR.test(ch)) {
      let end = i + 1
      while (end < text.length && (CJK_TERMINATOR.test(text[end]!) || CLOSERS.test(text[end]!)))
        end++
      let next = end
      while (next < text.length && /\s/.test(text[next]!)) next++
      if (next > end || (cjk && end < text.length)) {
        push(end, next)
        i = next
        continue
      }
      i = end
      continue
    }
    i++
  }
  push(text.length, text.length)
  return out
}

/** Preferred break characters for a sentence longer than a whole chunk. */
const SOFT_BREAK = /[，、,：:\s]/

/**
 * Split one over-long sentence (no terminator for > max chars) at the last
 * comma / space before the limit, else at the limit — never inside maths.
 */
function splitLongSentence(sentence: Sentence, max: number): Sentence[] {
  if (sentence.text.length <= max) return [sentence]
  const out: Sentence[] = []
  let rest = sentence.text
  let restSpans = mathSpans(rest)
  let joiner = sentence.joiner
  while (rest.length > max) {
    let cut = -1
    for (let k = max; k > max / 2; k--) {
      if (SOFT_BREAK.test(rest[k - 1]!) && !insideSpan(restSpans, k)) {
        cut = k
        break
      }
    }
    if (cut < 0) {
      cut = max
      const span = restSpans.find(([start, end]) => cut > start && cut < end)
      // A formula straddling the limit moves whole to the next piece; one that
      // starts the piece stays whole even if it is longer than the limit.
      if (span) cut = span[0] > 0 ? span[0] : span[1]
    }
    const head = rest.slice(0, cut)
    const tail = rest.slice(cut)
    if (head.trim()) out.push({ text: head.trim(), joiner })
    joiner = joinerFor(`${/\s*$/.exec(head)![0]}${/^\s*/.exec(tail)![0]}`)
    rest = tail.trimStart()
    restSpans = mathSpans(rest)
  }
  if (rest.trim()) out.push({ text: rest.trim(), joiner })
  return out
}

/** A Markdown pipe-table header: a row followed by a `| --- |` separator. */
const TABLE_SEPARATOR = /^\|(?:\s*:?-{3,}:?\s*\|)+\s*$/

/**
 * Split an over-long table by rows. Each piece repeats the header row (and its
 * separator) so every chunk is still a readable table; rows are never cut.
 */
function splitTable(piece: ChunkLine): ChunkLine[] {
  const lines = piece.text.split('\n')
  const header = lines.length > 2 && TABLE_SEPARATOR.test(lines[1]!) ? lines.slice(0, 2) : []
  const rows = lines.slice(header.length)
  const out: ChunkLine[] = []
  let current: string[] = []
  const size = (list: string[]) => [...header, ...list].join('\n').length
  for (const row of rows) {
    if (current.length > 0 && size([...current, row]) > MAX_CHUNK_CHARS) {
      out.push({ ...piece, text: [...header, ...current].join('\n') })
      current = []
    }
    current.push(row)
  }
  if (current.length > 0) out.push({ ...piece, text: [...header, ...current].join('\n') })
  return out
}

function pack(lines: ChunkLine[]): ChunkLine[] {
  const out: ChunkLine[] = []
  let buffer: ChunkLine | null = null
  for (const line of lines) {
    if (
      buffer &&
      // Two tables merged would read as one table with mismatched columns.
      line.contentType !== 'table' &&
      buffer.contentType === line.contentType &&
      buffer.pageNumber === line.pageNumber &&
      buffer.section === line.section &&
      buffer.text.length + line.text.length + 1 <= MAX_CHUNK_CHARS
    ) {
      buffer.text += '\n' + line.text
      const merged = mergeLayoutWarnings(buffer.layoutWarnings, line.layoutWarnings)
      if (merged) buffer.layoutWarnings = merged
    } else {
      if (buffer) out.push(buffer)
      buffer = { ...line }
    }
  }
  if (buffer) out.push(buffer)
  // Split overly long lines by sentence
  const final: ChunkLine[] = []
  for (const piece of out) {
    if (piece.text.length <= MAX_CHUNK_CHARS) {
      final.push(piece)
      continue
    }
    if (piece.contentType === 'table' && piece.text.trimStart().startsWith('|')) {
      final.push(...splitTable(piece))
      continue
    }
    const sentences = splitSentences(piece.text).flatMap((sentence) =>
      splitLongSentence(sentence, MAX_CHUNK_CHARS - OVERLAP_CHARS - 1),
    )
    let acc = ''
    let current: ChunkLine = { ...piece, text: '' }
    for (const sentence of sentences) {
      if ((acc + sentence.text).length > MAX_CHUNK_CHARS && acc) {
        current.text = acc.trim()
        final.push(current)
        // A tiny overlap from the chunk just closed, then the WHOLE sentence:
        // keeping only the sentence's tail would lose the rest of it.
        acc = `${acc.slice(-OVERLAP_CHARS).trimStart()}${sentence.joiner}${sentence.text}`
        current = { ...piece, text: '' }
      } else {
        acc += (acc ? sentence.joiner : '') + sentence.text
      }
    }
    if (acc) {
      current.text = acc.trim()
      final.push(current)
    }
  }
  return final
}

export interface ChunkerContext {
  documentId: string
  projectId: string
  documentName: string
  type: DocumentType
  /** Carried onto every chunk so retrieval can separate the three roles. */
  materialType?: LearningMaterialType
}

export function chunksFromPdf(
  ctx: ChunkerContext,
  pages: Array<{
    pageNumber: number
    text: string
    headings: Array<{ text: string }>
    /** Per `text.split('\n')` line: table block id and layout warnings. */
    lineFlags?: Array<{ table?: number; warnings?: LayoutWarning[] } | null>
    /** No text layer: `text` is OCR of the rendered page. */
    ocr?: { confidence: number }
    /** Options marked by a stamp / highlight over their letter (an MC answer key). */
    markedOptions?: MarkedOption[]
  }>,
): NewChunkInput[] {
  const lines: ChunkLine[] = []
  let section: string | undefined
  for (const page of pages) {
    if (page.ocr) {
      // Recognised from a picture: every line is low confidence.
      for (const raw of page.text.split('\n')) {
        const text = raw.trim()
        if (!text) continue
        lines.push({
          contentType: 'ocr',
          text,
          pageNumber: page.pageNumber,
          section,
          layoutWarnings: ['ocr'],
        })
      }
      continue
    }
    const split = page.text.split('\n')
    // Flags are only trusted when they line up with the text exactly.
    const flags = page.lineFlags?.length === split.length ? page.lineFlags : undefined
    let table: { id: number; line: ChunkLine } | undefined
    split.forEach((line, index) => {
      const raw = line.trim()
      if (!raw) return
      const flag = flags?.[index] ?? undefined
      const warnings = flag?.warnings?.length ? [...flag.warnings] : undefined
      if (flag?.table !== undefined) {
        // Rows of one Markdown table stay together as a single table line.
        if (table && table.id === flag.table) {
          table.line.text += '\n' + raw
          table.line.layoutWarnings = mergeLayoutWarnings(table.line.layoutWarnings, warnings)
          return
        }
        const tableLine: ChunkLine = {
          contentType: 'table',
          text: raw,
          pageNumber: page.pageNumber,
          section,
          ...(warnings ? { layoutWarnings: warnings } : {}),
        }
        table = { id: flag.table, line: tableLine }
        lines.push(tableLine)
        return
      }
      table = undefined
      const isHeading = page.headings.some((h) => h.text === raw)
      // A heading updates the running section *as it is encountered*, so the
      // packer never merges a section's tail with the next section's body.
      if (isHeading) section = raw
      lines.push({
        contentType: isHeading ? 'heading' : 'paragraph',
        text: raw,
        pageNumber: page.pageNumber,
        section,
        ...(warnings ? { layoutWarnings: warnings } : {}),
      })
    })
  }
  // The marked options of an answer key, after all pages: one labelled line
  // per question ("Answer 7: (c) 1.25; lower"), so the answer parser pairs
  // each with its question and the paper's own text is not taken as answers.
  for (const page of pages) {
    for (const mark of page.markedOptions ?? []) {
      lines.push({
        contentType: 'paragraph',
        text: markedAnswerLine(mark),
        pageNumber: page.pageNumber,
        section: MARKED_ANSWERS_SECTION,
      })
    }
  }
  const packed = pack(lines)
  return packed.map((line, idx) => ({
    documentId: ctx.documentId,
    projectId: ctx.projectId,
    materialType: ctx.materialType,
    ...(line.pageNumber !== undefined ? { pageNumber: line.pageNumber } : {}),
    ...(line.section !== undefined ? { section: line.section } : {}),
    ...(line.layoutWarnings?.length ? { layoutWarnings: line.layoutWarnings } : {}),
    contentType: line.contentType,
    text: line.text,
    sourceReference: buildSourceReference({
      documentName: ctx.documentName,
      ...(line.pageNumber !== undefined ? { pageNumber: line.pageNumber } : {}),
      ...(line.section !== undefined ? { section: line.section } : {}),
    }),
    order: idx,
  }))
}

export function chunksFromDocx(
  ctx: ChunkerContext,
  blocks: Array<{
    type: 'heading' | 'paragraph' | 'table' | 'list'
    level?: number
    text: string
    rows?: string[][]
  }>,
): NewChunkInput[] {
  const lines: ChunkLine[] = []
  let section: string | undefined
  for (const block of blocks) {
    if (block.type === 'heading') {
      section = block.text
      lines.push({ contentType: 'heading', text: block.text, section })
    } else if (block.type === 'paragraph' || block.type === 'list') {
      lines.push({
        contentType: block.type === 'list' ? 'list' : 'paragraph',
        text: block.text,
        section,
      })
    } else if (block.type === 'table') {
      // The extractor stores tables as Markdown pipe tables; fall back to the
      // rows for blocks produced by older code paths.
      const rowsText = block.text.trim()
        ? block.text
        : (block.rows ?? []).map((r) => r.join(' | ')).join('\n')
      if (rowsText.trim()) lines.push({ contentType: 'table', text: rowsText, section })
    }
  }
  const packed = pack(lines)
  return packed.map((line, idx) => ({
    documentId: ctx.documentId,
    projectId: ctx.projectId,
    materialType: ctx.materialType,
    ...(line.pageNumber !== undefined ? { pageNumber: line.pageNumber } : {}),
    ...(line.section !== undefined ? { section: line.section } : {}),
    contentType: line.contentType,
    text: line.text,
    sourceReference: buildSourceReference({
      documentName: ctx.documentName,
      ...(line.section !== undefined ? { section: line.section } : {}),
    }),
    order: idx,
  }))
}

export function chunksFromPptx(
  ctx: ChunkerContext,
  slides: Array<{
    slideNumber: number
    title?: string
    body: string
    notes: string
    tables: string[][][]
    imageCount: number
    /** Structured captions of diagrams drawn with shapes (see `pptxDrawing.ts`). */
    figures?: string[]
  }>,
): NewChunkInput[] {
  const lines: ChunkLine[] = []
  for (const slide of slides) {
    if (slide.title)
      lines.push({
        contentType: 'heading',
        text: slide.title,
        pageNumber: slide.slideNumber,
        section: slide.title,
      })
    if (slide.body)
      lines.push({
        contentType: 'paragraph',
        text: slide.body,
        pageNumber: slide.slideNumber,
        section: slide.title,
      })
    // A drawn diagram is described once, in its own caption chunk, so its
    // labels never read as stray lines of the slide text.
    for (const figure of slide.figures ?? []) {
      lines.push({
        contentType: 'caption',
        text: figure,
        pageNumber: slide.slideNumber,
        section: slide.title,
      })
    }
    if (slide.notes)
      lines.push({
        contentType: 'note',
        text: slide.notes,
        pageNumber: slide.slideNumber,
        section: slide.title,
      })
    for (const table of slide.tables) {
      const rows = table.filter((row) => row.some((cell) => cell.trim()))
      if (rows.length === 0) continue
      lines.push({
        contentType: 'table',
        text: toMarkdownTable(rows),
        pageNumber: slide.slideNumber,
        section: slide.title,
      })
    }
  }
  const packed = pack(lines)
  return packed.map((line, idx) => ({
    documentId: ctx.documentId,
    projectId: ctx.projectId,
    materialType: ctx.materialType,
    ...(line.pageNumber !== undefined ? { pageNumber: line.pageNumber } : {}),
    ...(line.section !== undefined ? { section: line.section } : {}),
    contentType: line.contentType,
    text: line.text,
    sourceReference: buildSourceReference({
      documentName: ctx.documentName,
      slideNumber: line.pageNumber,
      ...(line.section !== undefined ? { section: line.section } : {}),
    }),
    order: idx,
  }))
}

export function chunksFromOcr(
  ctx: ChunkerContext,
  result: { text: string; confidence: number; language: string },
): NewChunkInput[] {
  const lines: ChunkLine[] = result.text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({ contentType: 'ocr' as const, text }))
  const packed = pack(lines)
  return packed.map((line, idx) => ({
    documentId: ctx.documentId,
    projectId: ctx.projectId,
    materialType: ctx.materialType,
    contentType: 'ocr',
    text: line.text,
    sourceReference: buildSourceReference({ documentName: ctx.documentName }),
    order: idx,
  }))
}

export function chunksFromText(ctx: ChunkerContext, text: string): NewChunkInput[] {
  const lines: ChunkLine[] = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ contentType: 'paragraph' as const, text: t }))
  const packed = pack(lines)
  return packed.map((line, idx) => ({
    documentId: ctx.documentId,
    projectId: ctx.projectId,
    materialType: ctx.materialType,
    contentType: line.contentType,
    text: line.text,
    sourceReference: buildSourceReference({ documentName: ctx.documentName }),
    order: idx,
  }))
}

export function toStoredChunks(inputs: NewChunkInput[]): DocumentChunk[] {
  const now = Date.now()
  return inputs.map((input, idx) => ({
    id: crypto.randomUUID(),
    ...input,
    order: input.order ?? idx,
    createdAt: now,
  }))
}
