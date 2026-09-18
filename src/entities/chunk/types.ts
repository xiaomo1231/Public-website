import type { ChunkContentType } from '../document/types'

export interface DocumentChunk {
  id: string
  documentId: string
  projectId: string
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
  createdAt: number
}

export interface NewChunkInput {
  documentId: string
  projectId: string
  pageNumber?: number
  section?: string
  contentType: ChunkContentType
  text: string
  sourceReference: string
  order: number
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