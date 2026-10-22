import type { ChunkContentType, LearningMaterialType } from '../document/types'
import type { EvalRole } from '../evaluation/evalRole'
import type { LayoutWarning } from './layoutWarnings'

export interface DocumentChunk {
  id: string
  documentId: string
  projectId: string
  /** Denormalised from the document so retrieval can filter without a join. */
  materialType?: LearningMaterialType
  /** Denormalised `Document.evalRole` (held-out filtering without a join). */
  evalRole?: EvalRole
  pageNumber?: number
  section?: string
  contentType: ChunkContentType
  text: string
  /**
   * Human-readable source pointer, e.g.
   *   "Calculus.pdf · Page 12 · § Derivatives"
   * The AI Tutor (Phase 6) will cite this string verbatim.
   */
  sourceReference: string
  /** Position in the document; lower = earlier. */
  order: number
  /** Textbook structure the chunk belongs to (textbook documents only). */
  chapterId?: string
  sectionId?: string
  chapterNumber?: string
  sectionNumber?: string
  chapterTitle?: string
  sectionTitle?: string
  /**
   * Regions the extractor could not lay out reliably (a fraction, table,
   * exponent or matrix kept as raw text). Optional; see `layoutWarnings.ts`.
   */
  layoutWarnings?: LayoutWarning[]
  createdAt: number
}

export interface NewChunkInput {
  documentId: string
  projectId: string
  materialType?: LearningMaterialType
  pageNumber?: number
  section?: string
  contentType: ChunkContentType
  text: string
  sourceReference: string
  order: number
  chapterId?: string
  sectionId?: string
  chapterNumber?: string
  sectionNumber?: string
  chapterTitle?: string
  sectionTitle?: string
  layoutWarnings?: LayoutWarning[]
}

export function buildSourceReference(input: {
  documentName: string
  pageNumber?: number
  section?: string
  slideNumber?: number
}): string {
  const parts: string[] = [input.documentName]
  if (input.pageNumber !== undefined) parts.push(`Page ${input.pageNumber}`)
  if (input.slideNumber !== undefined) parts.push(`Slide ${input.slideNumber}`)
  if (input.section) parts.push(`§ ${input.section}`)
  return parts.join(' · ')
}
