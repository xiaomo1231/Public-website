/**
 * Course Structure — the textbook's own chapter/section hierarchy.
 *
 * This is the *structural* source of truth. It is detected from signals the
 * document actually has (numbering, heading markers, page positions), not
 * invented by the model. Tutor Topics, notes, transcripts, practice questions
 * and quizzes all reference it rather than re-guessing the outline.
 *
 * Nodes are stored flat with a `parentId` so the tree can be any depth.
 */

export type CourseStructureNodeType = 'part' | 'unit' | 'chapter' | 'section' | 'subsection'

export type StructureConfidence = 'high' | 'medium' | 'low'

export interface CourseStructureNode {
  id: string
  structureId: string
  projectId: string
  parentId?: string
  type: CourseStructureNodeType
  /** The number as printed, e.g. "3" or "3.2". Never renumbered. */
  number?: string
  title: string
  order: number
  /** 0 = top level. */
  depth: number
  sourcePageStart?: number
  sourcePageEnd?: number
  sourceChunkIds: string[]
  confidence: StructureConfidence
}

export interface CourseStructure {
  id: string
  projectId: string
  sourceDocumentId: string
  title: string
  confidence: StructureConfidence
  /** Bumped whenever the detected tree changes. */
  version: number
  createdAt: number
  updatedAt: number
}

/** Used when a document has no reliable chapter structure at all. */
export const UNSTRUCTURED_TITLE = 'General Course Material'

export function isStructured(structure: CourseStructure | undefined): boolean {
  return Boolean(structure && structure.confidence !== 'low')
}
