import type { Topic } from '@/entities/courseAnalysis/types'
import {
  UNSTRUCTURED_TITLE,
  type CourseStructure,
  type CourseStructureNode,
} from '@/entities/courseStructure/types'
import type { Document } from '@/entities/document/types'
import { isHeldOut } from '@/entities/evaluation/evalRole'
import {
  isReviewMaterial,
  REVIEW_MATERIAL_MAX_MINUTES,
  REVIEW_MATERIAL_MIN_MINUTES,
  reviewMaterialMinutes,
} from './materials'
import type { PlannedExamScope } from './types'

/**
 * What an exam covers when it is chosen by file or by chapter (考试范围 「按所选
 * 资料」 / 「按章节」). Both work before the course is analysed: the textbook
 * structure is detected at processing time, and a file without a structure
 * (slides, notes) counts as one chapter of its own. Once topics exist, the
 * topics in scope are the ones whose verified sources lie in those files /
 * chapters; until then the scheduler and the 复习提纲 work per chapter / file
 * (`ScopeUnit`). Pure.
 */

export type ChaptersScope = Extract<PlannedExamScope, { kind: 'chapters' }>

export type ChapterOptionKind = 'chapter' | 'section' | 'file'

/** One row of the 「按章节」 checklist. */
export interface ChapterOption {
  /** `chapter:<nodeId>`, `section:<nodeId>` or `file:<documentId>`. */
  key: string
  kind: ChapterOptionKind
  documentId: string
  documentName: string
  nodeId?: string
  /** The chapter a section belongs to. */
  parentKey?: string
  number?: string
  title: string
  pageStart?: number
  pageEnd?: number
  /** Chunks of the node and its descendants (empty for a whole file). */
  chunkIds: string[]
}

/** A chapter or file in scope, studied as one 复习资料 task while there are no topics. */
export interface ScopeUnit {
  /** Plan task ref: the document id (a whole file) or `chapter:<documentId>:<nodeId>`. */
  id: string
  title: string
  documentId: string
  nodeId?: string
  /** Chunks of the chapter; absent = the whole file. */
  chunkIds?: string[]
  minutes: number
}

const CHAPTER_NODE_TYPES = new Set<CourseStructureNode['type']>(['part', 'unit', 'chapter'])

export function chapterRef(documentId: string, nodeId: string): string {
  return `chapter:${documentId}:${nodeId}`
}

export function parseChapterRef(
  ref: string | undefined,
): { documentId: string; nodeId: string } | null {
  if (!ref?.startsWith('chapter:')) return null
  const [, documentId, nodeId] = ref.split(':')
  return documentId && nodeId ? { documentId, nodeId } : null
}

/** The draft key of a stored chapters scope (and back). */
export function chapterKeysOf(scope: ChaptersScope): string[] {
  return [
    ...scope.chapterIds.map((id) => `chapter:${id}`),
    ...(scope.sectionIds ?? []).map((id) => `section:${id}`),
    ...(scope.documentIds ?? []).map((id) => `file:${id}`),
  ]
}

export function chaptersScopeFromKeys(keys: readonly string[]): ChaptersScope {
  const pick = (prefix: string) =>
    keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
  const sectionIds = pick('section:')
  const documentIds = pick('file:')
  return {
    kind: 'chapters',
    chapterIds: pick('chapter:'),
    ...(sectionIds.length ? { sectionIds } : {}),
    ...(documentIds.length ? { documentIds } : {}),
  }
}

export function chaptersScopeSize(scope: ChaptersScope): number {
  return (
    scope.chapterIds.length + (scope.sectionIds?.length ?? 0) + (scope.documentIds?.length ?? 0)
  )
}

/** A file that can stand in the chapter list (a ready course file, not held out). */
export function isChapterSourceDocument(document: Document): boolean {
  return isReviewMaterial(document) && !isHeldOut(document)
}

function isUnstructured(nodes: readonly CourseStructureNode[]): boolean {
  return nodes.every((node) => node.title === UNSTRUCTURED_TITLE)
}

/**
 * The checklist: per course file, its detected chapters and sections; a file
 * without a usable structure is one row of its own (「整个文件」).
 */
export function chapterOptionsFrom(
  documents: readonly Document[],
  structures: ReadonlyArray<{ structure: CourseStructure; nodes: CourseStructureNode[] }>,
): ChapterOption[] {
  const byDocument = new Map(structures.map((row) => [row.structure.sourceDocumentId, row]))
  const out: ChapterOption[] = []
  for (const document of documents) {
    if (!isChapterSourceDocument(document)) continue
    const nodes = byDocument.get(document.id)?.nodes ?? []
    const usable = nodes.filter(
      (node) => CHAPTER_NODE_TYPES.has(node.type) || node.type === 'section',
    )
    if (usable.length === 0 || isUnstructured(nodes)) {
      out.push({
        key: `file:${document.id}`,
        kind: 'file',
        documentId: document.id,
        documentName: document.name,
        title: document.name,
        chunkIds: [],
      })
      continue
    }
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const children = new Map<string, CourseStructureNode[]>()
    for (const node of nodes) {
      if (!node.parentId) continue
      const list = children.get(node.parentId) ?? []
      list.push(node)
      children.set(node.parentId, list)
    }
    const subtree = (node: CourseStructureNode): CourseStructureNode[] => [
      node,
      ...(children.get(node.id) ?? []).flatMap(subtree),
    ]
    const chapterOf = (node: CourseStructureNode): CourseStructureNode | undefined => {
      let cursor = node.parentId ? byId.get(node.parentId) : undefined
      while (cursor) {
        if (CHAPTER_NODE_TYPES.has(cursor.type)) return cursor
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
      }
      return undefined
    }
    for (const node of [...usable].sort((a, b) => a.order - b.order)) {
      const all = subtree(node)
      const starts = all.map((n) => n.sourcePageStart).filter((p): p is number => !!p)
      const ends = all
        .map((n) => n.sourcePageEnd ?? n.sourcePageStart)
        .filter((p): p is number => !!p)
      const isChapter = CHAPTER_NODE_TYPES.has(node.type)
      const parent = isChapter ? undefined : chapterOf(node)
      out.push({
        key: `${isChapter ? 'chapter' : 'section'}:${node.id}`,
        kind: isChapter ? 'chapter' : 'section',
        documentId: document.id,
        documentName: document.name,
        nodeId: node.id,
        ...(parent ? { parentKey: `chapter:${parent.id}` } : {}),
        ...(node.number ? { number: node.number } : {}),
        title: node.title,
        ...(starts.length ? { pageStart: Math.min(...starts) } : {}),
        ...(ends.length ? { pageEnd: Math.max(...ends) } : {}),
        chunkIds: all.flatMap((n) => n.sourceChunkIds),
      })
    }
  }
  return out
}

/** Reading time of a chapter: ~3 minutes a page, else ~2 a chunk; 10–60 minutes. */
export function chapterMinutes(
  option: Pick<ChapterOption, 'pageStart' | 'pageEnd' | 'chunkIds'>,
): number {
  let minutes: number
  if (option.pageStart && option.pageEnd && option.pageEnd >= option.pageStart)
    minutes = (option.pageEnd - option.pageStart + 1) * 3
  else if (option.chunkIds.length > 0) minutes = option.chunkIds.length * 2
  else minutes = 20
  const rounded = Math.round(minutes / 5) * 5
  return Math.max(REVIEW_MATERIAL_MIN_MINUTES, Math.min(REVIEW_MATERIAL_MAX_MINUTES, rounded))
}

/** The chosen rows, in list order; a section whose chapter is chosen too is left out. */
export function selectedChapterOptions(
  scope: ChaptersScope,
  options: readonly ChapterOption[],
): ChapterOption[] {
  const keys = new Set(chapterKeysOf(scope))
  return options.filter(
    (option) => keys.has(option.key) && !(option.parentKey && keys.has(option.parentKey)),
  )
}

/** Units of a chapters scope (whole files use the file's own reading time). */
export function chapterUnits(
  scope: ChaptersScope,
  options: readonly ChapterOption[],
  documents: readonly Document[],
): ScopeUnit[] {
  const docById = new Map(documents.map((doc) => [doc.id, doc]))
  return selectedChapterOptions(scope, options).flatMap((option): ScopeUnit[] => {
    if (option.kind === 'file') {
      const doc = docById.get(option.documentId)
      if (!doc) return []
      return [
        { id: doc.id, title: doc.name, documentId: doc.id, minutes: reviewMaterialMinutes(doc) },
      ]
    }
    const number = option.number ? `${option.number} ` : ''
    return [
      {
        id: chapterRef(option.documentId, option.nodeId!),
        title: `${option.documentName} · ${number}${option.title}`,
        documentId: option.documentId,
        nodeId: option.nodeId!,
        chunkIds: option.chunkIds,
        minutes: chapterMinutes(option),
      },
    ]
  })
}

const intersects = (list: readonly string[] | undefined, wanted: ReadonlySet<string>): boolean =>
  !!list?.some((id) => wanted.has(id))

/**
 * Whether a topic draws on the given files: its verified source chunks lie in
 * them (`chunkDocument` maps chunk → file); a topic without verified sources
 * falls back to its source references.
 */
export function topicFromDocuments(
  topic: Pick<Topic, 'sourceChunkIds' | 'sourceRefs'>,
  documentIds: ReadonlySet<string>,
  chunkDocument: ReadonlyMap<string, string>,
): boolean {
  if (documentIds.size === 0) return false
  if (topic.sourceChunkIds?.length)
    return topic.sourceChunkIds.some((id) => {
      const doc = chunkDocument.get(id)
      return !!doc && documentIds.has(doc)
    })
  return topic.sourceRefs.some((ref) => documentIds.has(ref.documentId))
}

/** Topics in a chapters scope, in course order. */
export function topicsInChapters(
  scope: ChaptersScope,
  topics: readonly Topic[],
  chunkDocument: ReadonlyMap<string, string>,
): Topic[] {
  const chapters = new Set(scope.chapterIds)
  const sections = new Set(scope.sectionIds ?? [])
  const files = new Set(scope.documentIds ?? [])
  return topics.filter(
    (topic) =>
      (topic.chapterId !== undefined && chapters.has(topic.chapterId)) ||
      (topic.sectionId !== undefined && sections.has(topic.sectionId)) ||
      intersects(topic.sourceChapterIds, chapters) ||
      intersects(topic.sourceSectionIds, sections) ||
      topicFromDocuments(topic, files, chunkDocument),
  )
}

/** Topics drawn from the picked files (「按所选资料」), in course order. */
export function topicsFromMaterials(
  documentIds: ReadonlySet<string>,
  topics: readonly Topic[],
  chunkDocument: ReadonlyMap<string, string>,
): Topic[] {
  return topics.filter((topic) => topicFromDocuments(topic, documentIds, chunkDocument))
}
