import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import {
  courseContextId,
  type CourseContext,
  type LectureChunkLink,
  type NoteLink,
  type NoteRelation,
  type ProfessorTeachingProfile,
} from '@/entities/courseContext/types'
import type { Document } from '@/entities/document/types'
import { resolveMaterialType } from '@/entities/document/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import {
  buildChunkRelinkIndex,
  chunkContentFingerprint,
  relinkChunkReference,
  type ChunkRelinkIndex,
} from '@/entities/chunk/relink'
import { computeClassProgress, overlapScore, type ProgressTopic } from './classProgressService'
import { asStringArray, asTrimmedString } from '@/infrastructure/ai/validation'
import { prompts } from '@/infrastructure/ai/prompts'
import type { AIService } from './aiService'
import { logger } from '@/infrastructure/logger/logger'
import { fnv1a } from '@/shared/lib/hash'

/** Minimum token overlap for a note to be linked to a textbook passage. */
const NOTE_MATCH_MIN = 0.2

/**
 * Fingerprint of the derived link set.
 *
 * Uses the link *targets* (and their structure position), not just how many
 * links there are, so a re-pointed link is detected even when the count is
 * unchanged.
 */
export function computeLinkFingerprint(
  noteLinks: readonly NoteLink[],
  lectureLinks: readonly LectureChunkLink[],
): string {
  const notes = noteLinks
    .map((link) =>
      [
        link.noteChunkId,
        link.textbookChunkId,
        link.chapterId ?? '',
        link.sectionId ?? '',
        link.needsRelink ? '1' : '0',
      ].join(':'),
    )
    .sort()
  const lectures = lectureLinks
    .map((link) =>
      [
        link.transcriptChunkId,
        link.textbookChunkId,
        link.topicId ?? '',
        link.chapterId ?? '',
        link.sectionId ?? '',
        link.needsRelink ? '1' : '0',
      ].join(':'),
    )
    .sort()
  return fnv1a([...notes, ...lectures].join('|'))
}

/**
 * Record the linked textbook chunk's content fingerprint on every fresh link.
 *
 * Without it a later re-process could not tell "the same passage, new chunk id"
 * from "the passage changed".
 */
function withTextbookFingerprints<T extends { textbookChunkId: string; textbookChunkFingerprint?: string }>(
  links: readonly T[],
  index: ChunkRelinkIndex,
): T[] {
  return links.map((link) => {
    const chunk = index.live.get(link.textbookChunkId)
    if (!chunk) return link
    return { ...link, textbookChunkFingerprint: chunkContentFingerprint(chunk) }
  })
}

/**
 * Resolve a stored link's textbook target.
 *
 * Keeps a live target, re-points a dead one at the chunk with the same content
 * fingerprint, and otherwise keeps the original reference flagged for review.
 */
function resolveStoredLink<
  T extends {
    textbookChunkId: string
    textbookChunkFingerprint?: string
    previousTextbookChunkId?: string
    needsRelink?: boolean
    relinkReason?: string
  },
>(link: T, index: ChunkRelinkIndex): T {
  const resolved = relinkChunkReference(
    {
      chunkId: link.textbookChunkId,
      ...(link.textbookChunkFingerprint ? { fingerprint: link.textbookChunkFingerprint } : {}),
    },
    index,
  )
  if (!resolved) return link
  if (!resolved.needsRelink) {
    return {
      ...link,
      textbookChunkId: resolved.chunkId,
      ...(resolved.fingerprint ? { textbookChunkFingerprint: resolved.fingerprint } : {}),
      ...(resolved.previousChunkId ? { previousTextbookChunkId: resolved.previousChunkId } : {}),
      needsRelink: false,
      relinkReason: undefined,
    }
  }
  return {
    ...link,
    needsRelink: true,
    relinkReason: resolved.relinkReason ?? 'no-match-after-source-change',
  }
}

/**
 * Carry a stored lecture link's textbook target onto the fresh link.
 *
 * `computeClassProgress` matches transcript chunks to *topics*, so it cannot
 * produce a textbook target on its own. Without this the stored target would be
 * overwritten with an empty id on every sync, silently losing the association.
 */
function carryOverStoredTargets(
  fresh: readonly LectureChunkLink[],
  stored: readonly LectureChunkLink[] | undefined,
  index: ChunkRelinkIndex,
): LectureChunkLink[] {
  if (!stored || stored.length === 0) return [...fresh]
  const byTranscript = new Map(
    stored.filter((link) => link.textbookChunkId).map((link) => [link.transcriptChunkId, link]),
  )
  return fresh.map((link) => {
    if (link.textbookChunkId) return link
    const previous = byTranscript.get(link.transcriptChunkId)
    if (!previous) return link
    const resolved = relinkChunkReference(
      {
        chunkId: previous.textbookChunkId,
        ...(previous.textbookChunkFingerprint
          ? { fingerprint: previous.textbookChunkFingerprint }
          : {}),
      },
      index,
    )
    if (!resolved) return link
    return {
      ...link,
      textbookChunkId: resolved.chunkId,
      ...(resolved.fingerprint ? { textbookChunkFingerprint: resolved.fingerprint } : {}),
      ...(resolved.previousChunkId ? { previousTextbookChunkId: resolved.previousChunkId } : {}),
      ...(resolved.needsRelink
        ? { needsRelink: true, relinkReason: resolved.relinkReason ?? 'source-chunk-missing' }
        : {}),
    }
  })
}

/**
 * Keep a previously linked note whose textbook passage can no longer be found.
 *
 * If the note chunk itself is gone the link is dropped (the note no longer
 * exists); if the note still exists but the fresh pass did not match it, the
 * old link is re-pointed by content when possible and otherwise preserved and
 * flagged instead of vanishing.
 */
export function preserveUnmatchedNoteLinks(
  fresh: readonly NoteLink[],
  noteChunks: readonly DocumentChunk[],
  existing: CourseContext | undefined,
  index: ChunkRelinkIndex,
): NoteLink[] {
  if (!existing) return [...fresh]
  const matched = new Set(fresh.map((link) => link.noteChunkId))
  const liveNoteIds = new Set(noteChunks.map((chunk) => chunk.id))
  const out = [...fresh]
  for (const previous of existing.noteLinks) {
    if (matched.has(previous.noteChunkId)) continue
    if (!liveNoteIds.has(previous.noteChunkId)) continue
    out.push(resolveStoredLink(previous, index))
  }
  return out
}

/** Lecture-transcript counterpart of `preserveUnmatchedNoteLinks`. */
export function preserveUnmatchedLectureLinks(
  fresh: readonly LectureChunkLink[],
  transcriptChunks: readonly DocumentChunk[],
  existing: CourseContext | undefined,
  index: ChunkRelinkIndex,
): LectureChunkLink[] {
  if (!existing) return [...fresh]
  const matched = new Set(fresh.map((link) => link.transcriptChunkId))
  const liveIds = new Set(transcriptChunks.map((chunk) => chunk.id))
  const out = [...fresh]
  for (const previous of existing.lectureLinks) {
    if (matched.has(previous.transcriptChunkId)) continue
    if (!liveIds.has(previous.transcriptChunkId)) continue
    out.push(resolveStoredLink(previous, index))
  }
  return out
}

/** Keyword rules for how a note relates to the material. Heuristic, not AI. */
export function classifyNoteRelation(text: string): NoteRelation {
  const lower = (text ?? '').toLowerCase()
  if (/\?|don'?t understand|do not understand|confus|不明白|不懂|为什么|疑问/.test(lower)) {
    return 'question'
  }
  if (
    /professor|lecturer|in class|\bexam(s)?\b|\bmidterm\b|\bfinal\b|will be on|强调|考试|重点|课堂/.test(
      lower,
    )
  ) {
    return 'emphasis'
  }
  if (/for example|for instance|e\.g\.|例如|例子|举例/.test(lower)) return 'example'
  if (/basically|in other words|i think|means that|也就是说|简单说|换句话说/.test(lower)) {
    return 'clarification'
  }
  return 'supplement'
}

export function normalizeProfessorProfile(raw: unknown): ProfessorTeachingProfile {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const style = asTrimmedString(record.explanationStyle)
  return {
    ...(style ? { explanationStyle: style } : {}),
    terminologyPreferences: asStringArray(record.terminologyPreferences).slice(0, 20),
    commonAnalogies: asStringArray(record.commonAnalogies).slice(0, 20),
    recurringExamples: asStringArray(record.recurringExamples).slice(0, 20),
    emphasisPatterns: asStringArray(record.emphasisPatterns).slice(0, 20),
    teachingSequence: asStringArray(record.teachingSequence).slice(0, 20),
  }
}

/**
 * Builds and stores the derived course context: where the class has reached
 * (from the transcript) and how the learner's notes relate to the material.
 *
 * Deterministic and cheap, so it can run whenever the tutor page opens. The
 * professor's *teaching profile* is the only part that needs AI, and it is
 * extracted once and cached separately.
 */
export class CourseContextService {
  private db: AppDatabase
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private analyses: CourseAnalysisRepository
  private contexts: CourseContextRepository

  constructor(deps: {
    db?: AppDatabase
    documents?: DocumentRepository
    chunks?: ChunkRepository
    analyses?: CourseAnalysisRepository
    contexts?: CourseContextRepository
  } = {}) {
    this.db = deps.db ?? getDb()
    this.documents = deps.documents ?? new DocumentRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.contexts = deps.contexts ?? new CourseContextRepository(this.db)
  }

  get(projectId: string): Promise<CourseContext | undefined> {
    return this.contexts.get(projectId)
  }

  async syncDerived(projectId: string): Promise<CourseContext> {
    const staged = await this.stageDerived(projectId)
    if (!staged.changed) return staged.context
    await this.contexts.upsert(staged.context)
    return staged.context
  }

  /**
   * Compute the derived context **without writing anything**.
   *
   * Returns the row that *should* be stored plus whether it differs from what is
   * already stored. `syncDerived` persists it on page open; the incremental
   * commit stages it and writes it inside its own transaction instead, so a
   * re-pointed link can never land on its own.
   */
  async stageDerived(projectId: string): Promise<{ context: CourseContext; changed: boolean }> {
    const ready = (await this.documents.listByProject(projectId)).filter((d) => d.status === 'ready')
    const textbookDocs = ready.filter((d) => resolveMaterialType(d.materialType) === 'textbook')
    const noteDocs = ready.filter((d) => resolveMaterialType(d.materialType) === 'user_notes')
    const transcriptDocs = ready.filter(
      (d) => resolveMaterialType(d.materialType) === 'lecture_transcript',
    )

    const topics = await this.analyses.listTopics(projectId)
    const progressTopics: ProgressTopic[] = topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      ...(topic.description ? { description: topic.description } : {}),
      ...(topic.chapterId ? { chapterId: topic.chapterId } : {}),
      ...(topic.sectionId ? { sectionId: topic.sectionId } : {}),
      ...(topic.chapterNumber ? { chapterNumber: topic.chapterNumber } : {}),
      ...(topic.sectionNumber ? { sectionNumber: topic.sectionNumber } : {}),
      ...(topic.chapterTitle ? { chapterTitle: topic.chapterTitle } : {}),
      ...(topic.sectionTitle ? { sectionTitle: topic.sectionTitle } : {}),
    }))

    const [transcriptChunks, noteChunks, textbookChunks] = await Promise.all([
      this.chunksFor(transcriptDocs),
      this.chunksFor(noteDocs),
      this.chunksFor(textbookDocs),
    ])

    const { links: lectureLinks, progress } = computeClassProgress({
      topics: progressTopics,
      transcriptChunks: transcriptChunks.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        text: chunk.text,
      })),
      transcriptDocumentIds: transcriptDocs.map((doc) => doc.id),
    })

    const noteLinksFresh = this.computeNoteLinks(noteChunks, textbookChunks)
    // Bind each lecture link to the chapter/section of the textbook material
    // that its topic maps to, so class progress can name a section.
    const topicStructure = this.topicStructureMap(progressTopics, textbookChunks)
    for (const link of lectureLinks) {
      const ref = link.topicId ? topicStructure.get(link.topicId) : undefined
      if (ref?.chapterId) link.chapterId = ref.chapterId
      if (ref?.sectionId) link.sectionId = ref.sectionId
      // Attach the textbook passage the topic maps to, so a lecture link has a
      // real, relinkable target instead of an empty one.
      if (ref?.textbookChunkId) link.textbookChunkId = ref.textbookChunkId
    }

    const existing = await this.contexts.get(projectId)
    // One index per pass, so the three reference families never compete for the
    // same replacement chunk.
    const index = buildChunkRelinkIndex(textbookChunks)

    // A link whose textbook target disappeared is re-pointed by content when
    // possible, and KEPT + flagged when it is not — never silently dropped.
    const noteLinks = preserveUnmatchedNoteLinks(
      withTextbookFingerprints(noteLinksFresh, index),
      noteChunks,
      existing,
      index,
    )
    const preservedLectureLinks = preserveUnmatchedLectureLinks(
      withTextbookFingerprints(
        carryOverStoredTargets(lectureLinks, existing?.lectureLinks, index),
        index,
      ),
      transcriptChunks,
      existing,
      index,
    )

    // Freshness covers the **textbook** chunks too. Without them, re-processing
    // the textbook left every `textbookChunkId` pointing at a deleted chunk
    // while the stored context was considered up to date.
    const sourceHash = fnv1a(
      [
        ...transcriptChunks.map((c) => c.id),
        ...noteChunks.map((c) => c.id),
        ...textbookChunks.map((c) => c.id),
      ].join('|'),
    )
    // Fingerprint of the link set itself, so a target that moved while the link
    // count stayed the same is still detected.
    const linkFingerprint = computeLinkFingerprint(noteLinks, preservedLectureLinks)

    // Nothing that affects the derived context changed: keep the stored row
    // (and its AI-extracted profile) instead of rewriting it on every visit.
    if (
      existing &&
      existing.sourceHash === sourceHash &&
      (existing.linkFingerprint ?? '') === linkFingerprint &&
      existing.classProgress?.currentTopicId === progress.currentTopicId &&
      existing.classProgress?.progressPercent === progress.progressPercent
    ) {
      return { context: existing, changed: false }
    }

    const context: CourseContext = {
      id: courseContextId(projectId),
      projectId,
      ...(existing?.professorProfile ? { professorProfile: existing.professorProfile } : {}),
      // The question-style profile is owned by Professor Practice; preserve it.
      ...(existing?.questionStyleProfile
        ? { questionStyleProfile: existing.questionStyleProfile }
        : {}),
      // No transcript means we genuinely cannot state where the class is.
      ...(transcriptDocs.length > 0 ? { classProgress: progress } : {}),
      noteLinks,
      lectureLinks: preservedLectureLinks,
      sourceHash,
      linkFingerprint,
      updatedAt: Date.now(),
    }
    return { context, changed: true }
  }

  /**
   * Extract the professor's teaching profile once and cache it. Best-effort:
   * a failure (or no AI configured) simply leaves the profile absent.
   */
  async ensureProfessorProfile(projectId: string, ai: AIService): Promise<void> {
    const context = await this.contexts.get(projectId)
    if (!context || context.professorProfile) return

    const transcripts = (await this.documents.listByProject(projectId)).filter(
      (d) => d.status === 'ready' && resolveMaterialType(d.materialType) === 'lecture_transcript',
    )
    if (transcripts.length === 0) return
    const chunks = await this.chunksFor(transcripts)
    if (chunks.length === 0) return

    try {
      const topics = await this.analyses.listTopics(projectId)
      const { data } = await ai.chatJSON<unknown>([
        { role: 'system', content: prompts.professorProfile.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.professorProfile.buildUserPrompt({
            topicNames: topics.map((topic) => topic.name),
            transcriptExcerpts: chunks.slice(0, 12).map((chunk) => chunk.text.slice(0, 600)),
          }),
        },
      ])
      const profile = normalizeProfessorProfile(data)
      await this.contexts.upsert({ ...context, professorProfile: profile, updatedAt: Date.now() })
    } catch (err) {
      logger.warn('Professor profile extraction failed', {
        projectId,
        error: (err as Error)?.message,
      })
    }
  }

  private async chunksFor(documents: Document[]): Promise<DocumentChunk[]> {
    const out: DocumentChunk[] = []
    for (const doc of documents) {
      out.push(...(await this.chunks.listByDocument(doc.id)))
    }
    return out
  }

  private computeNoteLinks(notes: DocumentChunk[], textbook: DocumentChunk[]): NoteLink[] {
    if (notes.length === 0 || textbook.length === 0) return []
    const links: NoteLink[] = []
    for (const note of notes) {
      let best: { chunk: DocumentChunk; score: number } | null = null
      for (const candidate of textbook) {
        const score = overlapScore(note.text, candidate.text)
        if (!best || score > best.score) best = { chunk: candidate, score }
      }
      if (!best || best.score < NOTE_MATCH_MIN) continue
      links.push({
        noteChunkId: note.id,
        textbookChunkId: best.chunk.id,
        confidence: Number(best.score.toFixed(3)),
        relation: classifyNoteRelation(note.text),
        ...(best.chunk.chapterId ? { chapterId: best.chunk.chapterId } : {}),
        ...(best.chunk.sectionId ? { sectionId: best.chunk.sectionId } : {}),
      })
    }
    return links
  }

  /**
   * Best-matching textbook chunk per topic, used to place a topic (and the
   * transcript chunks matched to it) inside the course structure.
   */
  private topicStructureMap(
    topics: ProgressTopic[],
    textbook: DocumentChunk[],
  ): Map<string, { chapterId?: string; sectionId?: string; textbookChunkId?: string }> {
    const map = new Map<
      string,
      { chapterId?: string; sectionId?: string; textbookChunkId?: string }
    >()
    for (const topic of topics) {
      const query = `${topic.name} ${topic.description ?? ''}`
      let best: { chunk: DocumentChunk; score: number } | null = null
      for (const chunk of textbook) {
        const score = overlapScore(query, chunk.text)
        if (!best || score > best.score) best = { chunk, score }
      }
      if (!best || best.score <= 0) continue
      map.set(topic.id, {
        ...(best.chunk.chapterId ? { chapterId: best.chunk.chapterId } : {}),
        ...(best.chunk.sectionId ? { sectionId: best.chunk.sectionId } : {}),
        textbookChunkId: best.chunk.id,
      })
    }
    return map
  }
}
