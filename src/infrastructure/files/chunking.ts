import type { ChunkContentType, DocumentType, LearningMaterialType } from '@/entities/document/types'
import type { DocumentChunk, NewChunkInput } from '@/entities/chunk/types'
import { buildSourceReference } from '@/entities/chunk/types'

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
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?。！？\n])\s+/).map((s) => s.trim()).filter(Boolean)
}

function pack(lines: ChunkLine[]): ChunkLine[] {
  const out: ChunkLine[] = []
  let buffer: ChunkLine | null = null
  for (const line of lines) {
    if (
      buffer &&
      buffer.contentType === line.contentType &&
      buffer.pageNumber === line.pageNumber &&
      buffer.section === line.section &&
      buffer.text.length + line.text.length + 1 <= MAX_CHUNK_CHARS
    ) {
      buffer.text += '\n' + line.text
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
    const sentences = splitSentences(piece.text)
    let acc = ''
    let current: ChunkLine = { ...piece, text: '' }
    for (const sentence of sentences) {
      if ((acc + sentence).length > MAX_CHUNK_CHARS && acc) {
        current.text = acc.trim()
        final.push(current)
        acc = sentence.slice(-OVERLAP_CHARS) // tiny overlap
        current = { ...piece, text: '' }
      } else {
        acc += (acc ? ' ' : '') + sentence
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
  pages: Array<{ pageNumber: number; text: string; headings: Array<{ text: string }> }>,
): NewChunkInput[] {
  const lines: ChunkLine[] = []
  let section: string | undefined
  for (const page of pages) {
    const rawLines = page.text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    for (const raw of rawLines) {
      const isHeading = page.headings.some((h) => h.text === raw)
      // A heading updates the running section *as it is encountered*, so the
      // packer never merges a section's tail with the next section's body.
      if (isHeading) section = raw
      lines.push({
        contentType: isHeading ? 'heading' : 'paragraph',
        text: raw,
        pageNumber: page.pageNumber,
        section,
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
      ...(line.pageNumber !== undefined ? { pageNumber: line.pageNumber } : {}),
      ...(line.section !== undefined ? { section: line.section } : {}),
    }),
    order: idx,
  }))
}

export function chunksFromDocx(
  ctx: ChunkerContext,
  blocks: Array<{ type: 'heading' | 'paragraph' | 'table' | 'list'; level?: number; text: string; rows?: string[][] }>,
): NewChunkInput[] {
  const lines: ChunkLine[] = []
  let section: string | undefined
  for (const block of blocks) {
    if (block.type === 'heading') {
      section = block.text
      lines.push({ contentType: 'heading', text: block.text, section })
    } else if (block.type === 'paragraph' || block.type === 'list') {
      lines.push({ contentType: block.type === 'list' ? 'list' : 'paragraph', text: block.text, section })
    } else if (block.type === 'table') {
      const rowsText = (block.rows ?? []).map((r) => r.join(' | ')).join('\n')
      lines.push({ contentType: 'table', text: rowsText, section })
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
  slides: Array<{ slideNumber: number; title?: string; body: string; notes: string; tables: string[][][]; imageCount: number }>,
): NewChunkInput[] {
  const lines: ChunkLine[] = []
  for (const slide of slides) {
    if (slide.title) lines.push({ contentType: 'heading', text: slide.title, pageNumber: slide.slideNumber, section: slide.title })
    if (slide.body) lines.push({ contentType: 'paragraph', text: slide.body, pageNumber: slide.slideNumber, section: slide.title })
    if (slide.notes) lines.push({ contentType: 'note', text: slide.notes, pageNumber: slide.slideNumber, section: slide.title })
    for (const table of slide.tables) {
      lines.push({
        contentType: 'table',
        text: table.map((r) => r.join(' | ')).join('\n'),
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