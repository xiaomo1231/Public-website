import type { CourseStructureNode, CourseStructureNodeType } from '../courseStructure/types'
import type { DocumentChunk } from '../chunk/types'

/**
 * Which part of the detected structure a set of source changes falls into.
 *
 * Used to decide whether a re-analysis can be scoped to a few chapters instead
 * of the whole textbook. The mapping is derived from data that already exists
 * (`CourseStructureNode.sourceChunkIds`, `DocumentChunk.chapterId/sectionId`);
 * nothing new is stored.
 */
export interface AffectedStructure {
  documentIds: string[]
  chapterIds: string[]
  sectionIds: string[]
}

export const EMPTY_AFFECTED_STRUCTURE: AffectedStructure = {
  documentIds: [],
  chapterIds: [],
  sectionIds: [],
}

const CHAPTER_TYPES: readonly CourseStructureNodeType[] = ['part', 'unit', 'chapter']

function isChapterType(type: CourseStructureNodeType): boolean {
  return CHAPTER_TYPES.includes(type)
}

/**
 * Map the difference between a stored structure and the currently stored chunks
 * back onto chapter / section ids.
 *
 * A node is "affected" when at least one of the chunk ids it was built from is
 * gone — which is exactly what happens when its document is re-processed, since
 * chunk ids are regenerated. Chunks that carry a chapter/section id the stored
 * tree has never seen mark a newly appearing chapter or section.
 */
export function detectAffectedStructure(
  nodes: CourseStructureNode[],
  chunks: DocumentChunk[],
): AffectedStructure {
  const liveChunkIds = new Set(chunks.map((chunk) => chunk.id))
  const knownNodeIds = new Set(nodes.map((node) => node.id))
  const chapterIds = new Set<string>()
  const sectionIds = new Set<string>()

  for (const node of nodes) {
    const chunkSetChanged = node.sourceChunkIds.some((id) => !liveChunkIds.has(id))
    if (!chunkSetChanged) continue
    if (isChapterType(node.type)) chapterIds.add(node.id)
    else if (node.type === 'section') sectionIds.add(node.id)
  }

  for (const chunk of chunks) {
    if (chunk.chapterId && !knownNodeIds.has(chunk.chapterId)) chapterIds.add(chunk.chapterId)
    if (chunk.sectionId && !knownNodeIds.has(chunk.sectionId)) sectionIds.add(chunk.sectionId)
  }

  const documentIds = new Set<string>()
  for (const chunk of chunks) {
    const matchesChapter = chunk.chapterId !== undefined && chapterIds.has(chunk.chapterId)
    const matchesSection = chunk.sectionId !== undefined && sectionIds.has(chunk.sectionId)
    if (matchesChapter || matchesSection) documentIds.add(chunk.documentId)
  }

  return {
    documentIds: [...documentIds].sort(),
    chapterIds: [...chapterIds].sort(),
    sectionIds: [...sectionIds].sort(),
  }
}

/** True when nothing in the structure is affected. */
export function isEmptyAffected(affected: AffectedStructure): boolean {
  return (
    affected.documentIds.length === 0 &&
    affected.chapterIds.length === 0 &&
    affected.sectionIds.length === 0
  )
}
