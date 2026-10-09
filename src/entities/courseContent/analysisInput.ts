import type { DocumentChunk } from '../chunk/types'
import { buildCandidateChunkLabel } from './topicDependency'

/**
 * The analyzer input, split into requests.
 *
 * One request used to carry the first 200 chunks of each document, cut to
 * 50 000 characters, so a long textbook was analysed from its opening chapters
 * only. Now every chunk is sent: the material is cut into parts of at most
 * `ANALYSIS_SEGMENT_CHARS`, preferably at chapter boundaries, each part is
 * analysed on its own and the results are merged.
 *
 * Pure: no storage, no AI.
 */

/** Characters of formatted chunk text sent to the analyzer in one request. */
export const ANALYSIS_SEGMENT_CHARS = 40_000

/** The old single-request limits, used to recognise analyses that missed material. */
export const LEGACY_ANALYSIS_CHARS = 50_000
export const LEGACY_CHUNKS_PER_DOCUMENT = 200

export interface AnalysisInputDocument {
  id: string
  name: string
  /** In reading order. */
  chunks: DocumentChunk[]
}

export interface AnalysisSegment {
  /** The documents in this part, each with the run of chunks taken from it. */
  documents: AnalysisInputDocument[]
  /** Short human label for the part, e.g. "Ch 3 – Ch 5". */
  label: string
  /** Chapters the part covers (for merging topics that a chapter split shares). */
  chapterIds: string[]
  /** Formatted size in characters. */
  chars: number
}

/** How one chunk appears in the analyzer input. */
export type ChunkFormatter = (chunk: DocumentChunk) => string

const SEPARATOR = 2 // "\n\n" between passages

interface Piece {
  doc: AnalysisInputDocument
  chunks: DocumentChunk[]
  chars: number
}

/** Consecutive runs of `items` sharing `key`. */
function runsBy<T>(items: T[], key: (item: T) => string): T[][] {
  const runs: T[][] = []
  for (const item of items) {
    const last = runs.at(-1)
    if (last && key(last[0]!) === key(item)) last.push(item)
    else runs.push([item])
  }
  return runs
}

/**
 * Cut one chapter run into pieces that fit the budget: whole chapter if it
 * fits, otherwise by section, otherwise by chunk.
 */
function fit(
  doc: AnalysisInputDocument,
  chunks: DocumentChunk[],
  size: (chunk: DocumentChunk) => number,
  budget: number,
  bySection: boolean,
): Piece[] {
  const chars = chunks.reduce((total, chunk) => total + size(chunk), 0)
  if (chars <= budget) return [{ doc, chunks, chars }]
  if (bySection) {
    return runsBy(chunks, (chunk) => chunk.sectionId ?? '').flatMap((run) => fit(doc, run, size, budget, false))
  }
  const pieces: Piece[] = []
  let current: Piece = { doc, chunks: [], chars: 0 }
  for (const chunk of chunks) {
    if (current.chunks.length > 0 && current.chars + size(chunk) > budget) {
      pieces.push(current)
      current = { doc, chunks: [], chars: 0 }
    }
    current.chunks.push(chunk)
    current.chars += size(chunk)
  }
  if (current.chunks.length > 0) pieces.push(current)
  return pieces
}

function chapterLabel(chunk: DocumentChunk): string | undefined {
  if (chunk.chapterNumber) return `Ch ${chunk.chapterNumber}`
  return chunk.chapterTitle || (chunk.pageNumber !== undefined ? `p${chunk.pageNumber}` : undefined)
}

/**
 * Split the analysis input into parts of at most `budget` characters, keeping
 * chapters together whenever they fit. A course that fits in one request
 * yields exactly one part.
 */
export function planAnalysisSegments(
  documents: AnalysisInputDocument[],
  format: ChunkFormatter,
  budget: number = ANALYSIS_SEGMENT_CHARS,
): AnalysisSegment[] {
  const size = (chunk: DocumentChunk) => format(chunk).length + SEPARATOR
  const pieces = documents.flatMap((doc) =>
    runsBy(doc.chunks, (chunk) => chunk.chapterId ?? '').flatMap((run) => fit(doc, run, size, budget, true)),
  )

  const groups: Piece[][] = []
  let current: Piece[] = []
  let chars = 0
  for (const piece of pieces) {
    if (current.length > 0 && chars + piece.chars > budget) {
      groups.push(current)
      current = []
      chars = 0
    }
    current.push(piece)
    chars += piece.chars
  }
  if (current.length > 0) groups.push(current)

  return groups.map((group, index) => {
    // Adjacent pieces of the same document form one document entry.
    const docs: AnalysisInputDocument[] = []
    for (const piece of group) {
      const last = docs.at(-1)
      if (last && last.id === piece.doc.id) last.chunks.push(...piece.chunks)
      else docs.push({ id: piece.doc.id, name: piece.doc.name, chunks: [...piece.chunks] })
    }
    const all = docs.flatMap((doc) => doc.chunks)
    const first = all[0] ? chapterLabel(all[0]) : undefined
    const last = all.at(-1) ? chapterLabel(all.at(-1)!) : undefined
    return {
      documents: docs,
      label: first ? (last && last !== first ? `${first} – ${last}` : first) : `Part ${index + 1}`,
      chapterIds: [...new Set(all.map((chunk) => chunk.chapterId).filter((id): id is string => Boolean(id)))],
      chars: group.reduce((total, piece) => total + piece.chars, 0),
    }
  })
}

/** The analyzer text for one part: each document under its id heading. */
export function segmentText(segment: AnalysisSegment, format: ChunkFormatter): string {
  return segment.documents
    .map((doc) => `=== ${doc.id} ===\n${doc.chunks.map(format).join('\n\n')}`)
    .join('\n\n')
}

/**
 * Whether the old single request (first 200 chunks per document, then the
 * first 50 000 characters) would have left material out. An analysis written
 * before parts existed is only incomplete for such courses.
 */
export function legacyInputWasTruncated(documents: AnalysisInputDocument[]): boolean {
  let chars = 0
  for (const doc of documents) {
    if (doc.chunks.length > LEGACY_CHUNKS_PER_DOCUMENT) return true
    chars += doc.id.length + 9
    for (const chunk of doc.chunks) chars += buildCandidateChunkLabel(chunk).length + 3 + chunk.text.length + SEPARATOR
  }
  return chars > LEGACY_ANALYSIS_CHARS
}
