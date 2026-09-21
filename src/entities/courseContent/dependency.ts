import type { CourseStructureNode } from '../courseStructure/types'
import type { DocumentChunk } from '../chunk/types'
import type { LectureChunkLink, NoteLink } from '../courseContext/types'
import type { PracticeQuestion } from '../practice/types'
import { detectAffectedStructure, type AffectedStructure } from './incremental'

/**
 * Dependency planning for course content.
 *
 * ## Why this exists
 *
 * A real chapter-level incremental analysis cannot simply delete and re-create
 * "the chapters that changed". In this project a **Topic is not a chapter**:
 * one topic may span several chapters, and one chapter may produce several
 * topics. The existing relations are:
 *
 * ```
 * Source document
 *       ↓  (chunks)
 *   CourseStructure            ← the single source of truth for the outline
 *       ↓
 *   Analysis scope
 *       ↓
 *   Topic                      ← may span chapters
 *       ↓
 *   Notes / Lecture transcript / Practice references
 * ```
 *
 * So the unit that may safely be regenerated is an **affected topic set**, not
 * a chapter. This module computes that set deterministically, from data that
 * already exists, without touching storage and without generating anything.
 *
 * It is intentionally *planning only*: nothing here is wired into
 * `DocumentAnalysisService.analyzeProject`, which remains project-level.
 */

/**
 * A topic's structural dependencies. Deliberately structural rather than
 * `Pick<Topic, …>` so callers only have to supply the fields that matter here
 * (a real `Topic` still satisfies it).
 */
export interface TopicDependency {
  id: string
  chapterId?: string
  sectionId?: string
  sourceRefs: ReadonlyArray<{ chunkId?: string }>
}

export type NoteLinkDependency = Pick<
  NoteLink,
  'noteChunkId' | 'textbookChunkId' | 'chapterId' | 'sectionId'
>

export type LectureLinkDependency = Pick<
  LectureChunkLink,
  'transcriptChunkId' | 'textbookChunkId' | 'chapterId' | 'sectionId'
>

export type PracticeDependency = Pick<
  PracticeQuestion,
  'id' | 'chunkId' | 'chapterId' | 'sectionId'
>

export interface ContentDependencyInput {
  nodes: CourseStructureNode[]
  chunks: DocumentChunk[]
  topics: TopicDependency[]
  noteLinks?: NoteLinkDependency[]
  lectureLinks?: LectureLinkDependency[]
  practiceQuestions?: PracticeDependency[]
}

export interface ContentDependencyReport {
  /** Chapters / sections whose chunk set changed. */
  affected: AffectedStructure
  /** Topics that must be regenerated (includes topics spanning a changed chapter). */
  topicIds: string[]
  noteChunkIds: string[]
  lectureChunkIds: string[]
  practiceQuestionIds: string[]
}

/**
 * Map changed chunks onto everything that depends on them.
 *
 * A topic is affected when its own chapter/section is affected **or** any of
 * its cited chunks is affected — the latter is what catches a topic that spans
 * a changed chapter but whose primary chapter is elsewhere.
 */
export function planContentDependencies(input: ContentDependencyInput): ContentDependencyReport {
  const { nodes, chunks, topics, noteLinks = [], lectureLinks = [], practiceQuestions = [] } = input

  const affected = detectAffectedStructure(nodes, chunks)
  const affectedChapters = new Set(affected.chapterIds)
  const affectedSections = new Set(affected.sectionIds)

  const liveChunkIds = new Set(chunks.map((chunk) => chunk.id))
  const chunkStructure = new Map<string, { chapterId?: string; sectionId?: string }>()
  for (const chunk of chunks) {
    chunkStructure.set(chunk.id, {
      ...(chunk.chapterId ? { chapterId: chunk.chapterId } : {}),
      ...(chunk.sectionId ? { sectionId: chunk.sectionId } : {}),
    })
  }

  const refAffected = (ref: { chapterId?: string; sectionId?: string }): boolean =>
    (ref.chapterId !== undefined && affectedChapters.has(ref.chapterId)) ||
    (ref.sectionId !== undefined && affectedSections.has(ref.sectionId))

  /**
   * A chunk is affected when it disappeared (its document was re-processed) or
   * when it now belongs to a chapter/section that changed.
   */
  const chunkAffected = (chunkId: string): boolean => {
    if (!liveChunkIds.has(chunkId)) return true
    const structure = chunkStructure.get(chunkId)
    return structure ? refAffected(structure) : false
  }

  const topicIds = topics
    .filter(
      (topic) =>
        refAffected(topic) ||
        topic.sourceRefs.some((ref) => ref.chunkId !== undefined && chunkAffected(ref.chunkId)),
    )
    .map((topic) => topic.id)

  const noteChunkIds = noteLinks
    .filter((link) => refAffected(link) || chunkAffected(link.textbookChunkId))
    .map((link) => link.noteChunkId)

  const lectureChunkIds = lectureLinks
    .filter((link) => refAffected(link) || chunkAffected(link.textbookChunkId))
    .map((link) => link.transcriptChunkId)

  const practiceQuestionIds = practiceQuestions
    .filter(
      (question) =>
        refAffected(question) ||
        (question.chunkId !== undefined && chunkAffected(question.chunkId)),
    )
    .map((question) => question.id)

  return { affected, topicIds, noteChunkIds, lectureChunkIds, practiceQuestionIds }
}
