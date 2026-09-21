import type { Document } from '../document/types'
import { resolveMaterialType } from '../document/types'
import type { DocumentChunk } from '../chunk/types'
import { fnv1a } from '@/shared/lib/hash'

/**
 * Fingerprints for the course-content freshness check.
 *
 * Both the analyzer (when it writes a result) and the repository (when it asks
 * whether that result is still current) go through these helpers, so the two
 * hashes are guaranteed to be computed the same way.
 */

/**
 * The documents a course analysis is built from: every ready textbook, falling
 * back to all ready documents when the project has no textbook at all.
 *
 * This mirrors the selection the analyzer performs, and must keep doing so.
 */
export function selectAnalysisDocuments(documents: Document[]): Document[] {
  const ready = documents.filter((doc) => doc.status === 'ready')
  const textbooks = ready.filter((doc) => resolveMaterialType(doc.materialType) === 'textbook')
  return textbooks.length > 0 ? textbooks : ready
}

/** One chunk as it contributes to the analysis input. */
export interface SourceChunkFingerprint {
  order: number
  text: string
  pageNumber?: number
  chapterId?: string
  sectionId?: string
}

export interface SourceDocumentFingerprint {
  id: string
  name: string
  sizeBytes: number
  chunks: SourceChunkFingerprint[]
}

/**
 * Fingerprint of the *analysis input* for one document.
 *
 * Deliberately built from chunk **content**, not from chunk ids or processing
 * timestamps: re-processing a document regenerates chunk ids and moves
 * `processedAt`, but if the extracted text is byte-identical then the analysis
 * input is unchanged and the stored analysis must stay fresh.
 *
 * This is a content fingerprint of the extracted chunks — not a cryptographic
 * hash of the original file. `order` is included so a reordering counts as a
 * change, and the page/chapter/section fields are included because they are
 * fed to the analyzer as prompt context.
 */
export function computeDocumentContentFingerprint(chunks: SourceChunkFingerprint[]): string {
  const ordered = chunks.slice().sort((a, b) => a.order - b.order)
  return fnv1a(
    ordered
      .map((chunk) =>
        [
          chunk.order,
          chunk.pageNumber ?? '',
          chunk.chapterId ?? '',
          chunk.sectionId ?? '',
          chunk.text,
        ].join('\u0001'),
      )
      .join('\u0002'),
  )
}

/**
 * Build a document fingerprint from the stored chunks.
 *
 * Shared by the repository (when checking freshness) and the analyzer (when
 * recording what a result was derived from), so the two can never disagree.
 */
export function toSourceDocumentFingerprint(
  document: Pick<Document, 'id' | 'name' | 'sizeBytes'>,
  chunks: DocumentChunk[],
): SourceDocumentFingerprint {
  return {
    id: document.id,
    name: document.name,
    sizeBytes: document.sizeBytes,
    chunks: chunks.map((chunk) => ({
      order: chunk.order,
      text: chunk.text,
      ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
      ...(chunk.chapterId ? { chapterId: chunk.chapterId } : {}),
      ...(chunk.sectionId ? { sectionId: chunk.sectionId } : {}),
    })),
  }
}

/**
 * Fingerprint of the textbook sources behind an analysis.
 *
 * `id` and `name` are part of the fingerprint because both reach the analyzer
 * (the document name is quoted in the prompt). Nothing time-based is included.
 */
export function computeAnalysisSourceHash(documents: SourceDocumentFingerprint[]): string {
  const parts = documents
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) =>
      [
        doc.id,
        doc.name,
        String(doc.sizeBytes),
        computeDocumentContentFingerprint(doc.chunks),
      ].join(':'),
    )
  return fnv1a(parts.join('|'))
}

/**
 * Fingerprint of a detected chapter/section tree.
 *
 * `structureId` is included so two structures with identical node shapes still
 * hash differently. Returns `''` for an empty tree so callers can tell
 * "no structure" apart from "a structure whose hash happens to be X".
 */
export function computeStructureHash(
  nodes: Array<{
    id: string
    type: string
    number?: string
    title: string
    structureId?: string
  }>,
): string {
  if (nodes.length === 0) return ''
  return fnv1a(
    nodes
      .map((node) =>
        [node.structureId ?? '', node.id, node.type, node.number ?? '', node.title].join(':'),
      )
      .join('|'),
  )
}
