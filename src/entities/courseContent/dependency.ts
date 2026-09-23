import type { CourseStructureNode } from '../courseStructure/types'
import type { DocumentChunk } from '../chunk/types'
import type { LectureChunkLink, NoteLink } from '../courseContext/types'
import type { PracticeQuestion } from '../practice/types'
import { detectAffectedStructure, type AffectedStructure } from './incremental'
import { computeTopicDependencyHash, relinkDeclaredChunks } from './topicDependency'

/**
 * Dependency planning for course content.
 *
 * ## Why this exists
 *
 * A real chapter-level incremental analysis cannot simply delete and re-create
 * "the chapters that changed". In this project a **Topic is not a chapter**:
 * one topic may span several chapters, and one chapter may produce several
 * topics. The relations are:
 *
 * ```
 * Source document
 *       â†? (chunks)
 *   CourseStructure            â†?the single source of truth for the outline
 *       â†? *   Analysis scope
 *       â†? *   Topic                      â†?may span chapters; owns sourceChunkIds
 *       â†? *   Notes / Lecture transcript / Practice references
 * ```
 *
 * So the unit that may safely be regenerated is an **affected topic set**, not
 * a chapter. `regenerateChapter` / `regenerateSection` describe *where* the
 * change landed (for UI and diagnostics); they expand into the
 * `regenerateTopic` ops that the executor actually runs.
 *
 * Everything here is pure planning: no storage writes, no AI.
 */

/**
 * A topic's dependencies. Structural rather than `Pick<Topic, â€?` so callers
 * only supply what matters here â€?a real `Topic` still satisfies it.
 */
export interface TopicDependency {
  id: string
  chapterId?: string
  sectionId?: string
  sourceRefs: ReadonlyArray<{ chunkId?: string }>
  /** Validated dependency. Absent â‡?the topic cannot be regenerated locally. */
  sourceChunkIds?: string[]
  sourceChapterIds?: string[]
  sourceSectionIds?: string[]
  dependencyHash?: string
  /** Content fingerprint per source chunk, used to re-point stale ids. */
  sourceChunkFingerprints?: Record<string, string>
  needsFullReanalysis?: boolean
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

/** Tiered plan vocabulary. Stable strings â€?UI and tests key off these. */
export type IncrementalOpKind =
  | 'unchanged'
  | 'relinkOnly'
  | 'regenerateSection'
  | 'regenerateChapter'
  | 'regenerateTopic'
  | 'preserveTopic'
  | 'needsFullReanalysis'

export type IncrementalOpEntity = 'chapter' | 'section' | 'topic' | 'note' | 'lecture' | 'practice'

export interface IncrementalOp {
  kind: IncrementalOpKind
  entity: IncrementalOpEntity
  id: string
  /** Machine-readable reason; stable across runs. */
  reason: string
  /** Chunks the generator must be fed with (`regenerate*` only). */
  inputChunkIds: string[]
  detail?: string
}

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
  /** Tiered plan (D6): one entry per entity considered, including `unchanged`. */
  ops: IncrementalOp[]
}

/**
 * Map changed chunks onto everything that depends on them, and turn that into a
 * tiered plan.
 *
 * A topic is affected when **any of its own validated source chunks** is
 * affected, or when its own chapter/section moved. That is what catches a topic
 * that spans a changed chapter while its primary chapter is elsewhere.
 */
export function planContentDependencies(input: ContentDependencyInput): ContentDependencyReport {
  const { nodes, chunks, topics, noteLinks = [], lectureLinks = [], practiceQuestions = [] } = input

  const affected = detectAffectedStructure(nodes, chunks)
  const affectedChapters = new Set(affected.chapterIds)
  const affectedSections = new Set(affected.sectionIds)
  const knownNodeIds = new Set(nodes.map((node) => node.id))

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

  const ops: IncrementalOp[] = []
  const chunksIn = (predicate: (chunk: DocumentChunk) => boolean): string[] =>
    chunks.filter(predicate).map((chunk) => chunk.id).sort()

  // Structure-level ops: they say where the change landed and feed the UI.
  for (const chapterId of affected.chapterIds) {
    ops.push({
      kind: 'regenerateChapter',
      entity: 'chapter',
      id: chapterId,
      reason: 'chapter-chunks-changed',
      inputChunkIds: chunksIn((chunk) => chunk.chapterId === chapterId),
    })
  }
  for (const sectionId of affected.sectionIds) {
    ops.push({
      kind: 'regenerateSection',
      entity: 'section',
      id: sectionId,
      reason: 'section-chunks-changed',
      inputChunkIds: chunksIn((chunk) => chunk.sectionId === sectionId),
    })
  }

  // Topic-level ops: the unit the executor actually regenerates.
  const topicIds: string[] = []
  for (const topic of topics) {
    const declared = topic.sourceChunkIds ?? []
    const hasDependency = !topic.needsFullReanalysis && declared.length > 0

    // Position and citations are always available; the validated dependency is
    // the strongest signal but is not required to notice that a topic moved.
    const positionMoved = refAffected(topic)
    const citedChunkChanged = topic.sourceRefs.some(
      (ref) => ref.chunkId !== undefined && chunkAffected(ref.chunkId),
    )

    // Re-processing a document regenerates every chunk id, so a declared id
    // being absent is not on its own evidence that the passage changed.
    const relink = relinkDeclaredChunks(declared, topic.sourceChunkFingerprints, chunks)
    const live = relink.chunkIds
    // A resolved source that now sits in a changed chapter/section means the
    // topic's grounding may have moved with it. A source that could not be
    // resolved at all means the grounding genuinely changed.
    const affectedSources = live.filter((id) => chunkAffected(id))
    const affected =
      positionMoved || citedChunkChanged || affectedSources.length > 0 || relink.lost.length > 0

    if (!hasDependency) {
      if (!affected) {
        ops.push({
          kind: 'unchanged',
          entity: 'topic',
          id: topic.id,
          reason: 'sources-unchanged',
          inputChunkIds: [],
        })
        continue
      }
      // Affected, but we cannot tell *which* chunks it depends on. Keep the
      // topic and escalate â€?never guess a dependency, never regenerate blind.
      ops.push({
        kind: 'needsFullReanalysis',
        entity: 'topic',
        id: topic.id,
        reason: topic.needsFullReanalysis ? 'dependencies-missing' : 'dependency-not-persisted',
        inputChunkIds: [],
      })
      topicIds.push(topic.id)
      continue
    }

    if (live.length === 0) {
      ops.push({
        kind: 'needsFullReanalysis',
        entity: 'topic',
        id: topic.id,
        reason: 'no-live-sources',
        inputChunkIds: [],
      })
      topicIds.push(topic.id)
      continue
    }

    // A source chapter that no longer exists is checked before anything else:
    // it must be surfaced even when the remaining chunks look untouched.
    const missingChapters = (topic.sourceChapterIds ?? []).filter((id) => !knownNodeIds.has(id))
    if (missingChapters.length > 0) {
      // Keep the topic and let a human (or a full re-analysis) decide. Never
      // drop it silently.
      ops.push({
        kind: 'preserveTopic',
        entity: 'topic',
        id: topic.id,
        reason: 'source-chapter-missing',
        inputChunkIds: live,
        detail: missingChapters.join(','),
      })
      topicIds.push(topic.id)
      continue
    }

    // Content evidence beats structure heuristics. A source that could not be
    // re-resolved at all means the passage genuinely changed; a source that was
    // re-pointed by an identical content fingerprint means it did not.
    if (relink.lost.length > 0) {
      ops.push({
        kind: 'regenerateTopic',
        entity: 'topic',
        id: topic.id,
        reason: 'dependency-content-changed',
        inputChunkIds: regenerationInput(topic, live, chunks),
      })
      topicIds.push(topic.id)
      continue
    }

    if (relink.relinked > 0) {
      // Every declared source was re-resolved to an identical passage: the
      // topic's content is still valid, only the chunk ids moved. Persist the
      // re-pointed dependency; no regeneration, no AI.
      ops.push({
        kind: 'relinkOnly',
        entity: 'topic',
        id: topic.id,
        reason: 'source-relinked',
        inputChunkIds: live,
      })
      continue
    }

    if (!affected) {
      ops.push({
        kind: 'unchanged',
        entity: 'topic',
        id: topic.id,
        reason: 'sources-unchanged',
        inputChunkIds: [],
      })
      continue
    }

    if (affectedSources.length === 0 && !citedChunkChanged) {
      // The position moved but the dependency content did not.
      ops.push({
        kind: 'relinkOnly',
        entity: 'topic',
        id: topic.id,
        reason: 'structure-relink-only',
        inputChunkIds: [],
      })
      continue
    }

    if (
      topic.dependencyHash &&
      topic.dependencyHash === computeTopicDependencyHash(live, chunks)
    ) {
      ops.push({
        kind: 'relinkOnly',
        entity: 'topic',
        id: topic.id,
        reason: 'dependency-content-unchanged',
        inputChunkIds: [],
      })
      continue
    }

    // The chapter around the topic changed: rebuild the topic so it picks up
    // the chapter's current material.
    ops.push({
      kind: 'regenerateTopic',
      entity: 'topic',
      id: topic.id,
      reason: 'dependency-changed',
      inputChunkIds: regenerationInput(topic, live, chunks),
    })
    topicIds.push(topic.id)
  }

  const noteChunkIds: string[] = []
  for (const link of noteLinks) {
    if (!refAffected(link) && !chunkAffected(link.textbookChunkId)) continue
    noteChunkIds.push(link.noteChunkId)
    ops.push({
      kind: 'relinkOnly',
      entity: 'note',
      id: link.noteChunkId,
      reason: 'textbook-chunk-changed',
      inputChunkIds: [],
      detail: link.textbookChunkId,
    })
  }

  const lectureChunkIds: string[] = []
  for (const link of lectureLinks) {
    if (!refAffected(link) && !chunkAffected(link.textbookChunkId)) continue
    lectureChunkIds.push(link.transcriptChunkId)
    ops.push({
      kind: 'relinkOnly',
      entity: 'lecture',
      id: link.transcriptChunkId,
      reason: 'textbook-chunk-changed',
      inputChunkIds: [],
      detail: link.textbookChunkId,
    })
  }

  const practiceQuestionIds: string[] = []
  for (const question of practiceQuestions) {
    const hit =
      refAffected(question) ||
      (question.chunkId !== undefined && chunkAffected(question.chunkId))
    if (!hit) continue
    practiceQuestionIds.push(question.id)
    ops.push({
      kind: 'relinkOnly',
      entity: 'practice',
      id: question.id,
      reason: 'textbook-chunk-changed',
      inputChunkIds: [],
      detail: question.chunkId ?? '',
    })
  }

  return {
    affected,
    topicIds,
    noteChunkIds,
    lectureChunkIds,
    practiceQuestionIds,
    ops,
  }
}

/** True when the plan contains no work at all. */
export function isPlanNoop(ops: readonly IncrementalOp[]): boolean {
  return ops.every((op) => op.kind === 'unchanged')
}

/**
 * The chunks a regeneration run must be fed with.
 *
 * The topic's own still-valid sources, plus the **current** chunks of every
 * chapter/section it depends on. That way a source chapter whose chunks were
 * re-processed contributes its new material instead of being silently dropped
 * from the topic's grounding.
 */
function regenerationInput(
  topic: TopicDependency,
  live: readonly string[],
  chunks: readonly DocumentChunk[],
): string[] {
  const sourceChapters = new Set(topic.sourceChapterIds ?? [])
  const sourceSections = new Set(topic.sourceSectionIds ?? [])
  const structural = chunks
    .filter(
      (chunk) =>
        (chunk.chapterId !== undefined && sourceChapters.has(chunk.chapterId)) ||
        (chunk.sectionId !== undefined && sourceSections.has(chunk.sectionId)),
    )
    .map((chunk) => chunk.id)
  return [...new Set([...live, ...structural])].sort()
}
/** True when any topic could not be handled locally. */
export function planNeedsFullReanalysis(ops: readonly IncrementalOp[]): boolean {
  return ops.some((op) => op.kind === 'needsFullReanalysis')
}
