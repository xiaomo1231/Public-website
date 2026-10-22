import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { KnowledgeMasteryRepository } from '@/entities/knowledgeMastery/repository'
import { resolveMaterialType, type Document } from '@/entities/document/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import type { ExamTopic, SyllabusData } from '@/entities/syllabus/types'
import { localSyllabus, looksLikeSyllabus } from '@/entities/syllabus/parse'
import { readAiSyllabus, syllabusPromptText } from '@/entities/syllabus/aiExtract'
import {
  readAiMatches,
  rematchLocally,
  topicsFingerprint,
  type MatchableTopic,
} from '@/entities/syllabus/match'
import { examTopicCoverage, type ExamTopicCoverage } from '@/entities/syllabus/coverage'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { withLightModel, type AIService } from './aiService'

/** Exam topics sent per AI matching request. */
const MATCH_BATCH = 40

/** Outcome of one AI matching run. */
export interface SyllabusMatchRun {
  /** Exam topics the AI matched in this run (all batches, also earlier paused ones). */
  matched: number
  /** Exam topics asked about so far / in total. */
  done: number
  total: number
  /** The run stopped early on a pause or stop; `resume` continues it. */
  paused: boolean
}

/**
 * Exam topics already asked about by a paused AI matching run, per document
 * and scope. Kept for this page visit only (their matches are saved per batch;
 * this only lets 「继续」 skip them, including during a forced rematch).
 */
const pausedMatches = new Map<string, { asked: Set<string>; matched: number }>()

function matchKey(documentId: string, scopeId?: string): string {
  return `${documentId}::${scopeId ?? '*'}`
}

/** Progress of a paused AI matching run, if one is waiting to be continued. */
export function pausedSyllabusMatch(
  documentId: string,
  scopeId?: string,
): { done: number } | undefined {
  const entry = pausedMatches.get(matchKey(documentId, scopeId))
  return entry ? { done: entry.asked.size } : undefined
}

/** Test hook: forget paused matching runs. */
export function clearPausedSyllabusMatchesForTesting(): void {
  pausedMatches.clear()
}
/** Roles a document may be re-labelled from (others carry their own links). */
const CONVERTIBLE = new Set(['textbook', 'user_notes', 'lecture_transcript'])
/** Roles that are a knowledge source of their own. */
const KNOWLEDGE_ROLES = new Set(['textbook', 'user_notes', 'lecture_transcript'])
/** Chunks read to judge whether a document looks like a syllabus. */
const FIRST_PAGE_CHUNKS = 4

export interface SyllabusOverview {
  /** Ready syllabus documents, newest first. */
  syllabi: Array<{ document: Document; data: SyllabusData | null }>
  /** The course topics exam topics can be matched to. */
  topics: Topic[]
  /** Per exam topic id. */
  coverage: Map<string, ExamTopicCoverage>
  /** A ready textbook, notes or transcript exists. */
  hasKnowledgeSource: boolean
  /** Other documents whose name or first page reads like a syllabus. */
  suggestions: Document[]
}

function toChunkInput(chunk: DocumentChunk) {
  return {
    id: chunk.id,
    text: chunk.text,
    contentType: chunk.contentType,
    ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
  }
}

function matchable(topics: Topic[]): MatchableTopic[] {
  return topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    ...(topic.description ? { description: topic.description } : {}),
  }))
}

/**
 * Course syllabus / exam-topic lists: local extraction (and an AI fallback
 * whose topics must occur verbatim), the student's edits, matching to course
 * topics (local, with an optional closed-set AI step) and coverage.
 */
export class SyllabusService {
  private db: AppDatabase
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private analyses: CourseAnalysisRepository

  constructor(deps: { db?: AppDatabase } = {}) {
    this.db = deps.db ?? getDb()
    this.documents = new DocumentRepository(this.db)
    this.chunks = new ChunkRepository(this.db)
    this.analyses = new CourseAnalysisRepository(this.db)
  }

  private async syllabusDocument(documentId: string, projectId?: string): Promise<Document> {
    const document = await this.documents.get(documentId)
    if (projectId !== undefined && document.projectId !== projectId) {
      throw new AppError(t('syllabus.errors.notFound'), 'NOT_FOUND')
    }
    if (resolveMaterialType(document.materialType) !== 'syllabus') {
      throw new AppError(t('syllabus.errors.notSyllabus'), 'NOT_SYLLABUS')
    }
    return document
  }

  /** Read-modify-write of one document's list, in a transaction. */
  private async mutate(
    documentId: string,
    change: (data: SyllabusData) => SyllabusData,
  ): Promise<SyllabusData> {
    return this.db.transaction('rw', this.db.documents, async () => {
      const document = await this.syllabusDocument(documentId)
      const current: SyllabusData = document.syllabus ?? {
        scopes: [],
        extractedAt: Date.now(),
        method: 'local',
      }
      const next = change(JSON.parse(JSON.stringify(current)) as SyllabusData)
      await this.documents.update(documentId, { syllabus: next })
      return next
    })
  }

  /** Read the exam topics again with the local parser (replaces the list and edits). */
  async extractLocally(documentId: string): Promise<SyllabusData> {
    await this.syllabusDocument(documentId)
    const chunks = await this.chunks.listByDocument(documentId)
    const data = localSyllabus(chunks.map(toChunkInput))
    await this.documents.update(documentId, { syllabus: data })
    return data
  }

  /**
   * Ask the AI for the exam topics (offered when the local parser finds fewer
   * than five). Every topic must occur in the document; the rest are dropped.
   * Nothing is saved when no topic survives.
   */
  async extractWithAi(
    documentId: string,
    ai: AIService,
    options: { signal?: AbortSignal; control?: GenerationControl } = {},
  ): Promise<{ data: SyllabusData; dropped: number }> {
    // One request: a stop aborts it and nothing is saved.
    const signal = options.control?.signal ?? options.signal
    const document = await this.syllabusDocument(documentId)
    const chunks = (await this.chunks.listByDocument(documentId)).map(toChunkInput)
    if (chunks.length === 0) throw new AppError(t('syllabus.errors.noText'), 'NO_TEXT')
    const { data: output } = await ai.chatJSON<unknown>(
      [
        { role: 'system', content: prompts.syllabusTopics.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.syllabusTopics.buildUserPrompt({
            documentName: document.name,
            text: syllabusPromptText(chunks),
          }),
        },
      ],
      { maxTokens: 4096, ...(signal ? { signal } : {}) },
    )
    signal?.throwIfAborted()
    const { scopes, dropped } = readAiSyllabus(output, chunks)
    if (dropped > 0) logger.info('Syllabus AI topics not found in the document', { dropped })
    if (scopes.length === 0) {
      throw new AppError(t('syllabus.errors.aiNothing'), 'SYLLABUS_EMPTY')
    }
    const data: SyllabusData = { scopes, extractedAt: Date.now(), method: 'ai' }
    await this.documents.update(documentId, { syllabus: data })
    return { data, dropped }
  }

  // ---- edits -------------------------------------------------------------

  renameScope(documentId: string, scopeId: string, label: string): Promise<SyllabusData> {
    const name = label.replace(/\s+/g, ' ').trim()
    if (!name) throw new AppError(t('syllabus.errors.emptyLabel'), 'VALIDATION')
    return this.mutate(documentId, (data) => ({
      ...data,
      scopes: data.scopes.map((scope) =>
        scope.id === scopeId ? { ...scope, label: name } : scope,
      ),
      editedAt: Date.now(),
    }))
  }

  addScope(documentId: string, label: string): Promise<SyllabusData> {
    const name = label.replace(/\s+/g, ' ').trim()
    if (!name) throw new AppError(t('syllabus.errors.emptyLabel'), 'VALIDATION')
    return this.mutate(documentId, (data) => ({
      ...data,
      scopes: [...data.scopes, { id: crypto.randomUUID(), label: name, kind: 'other', topics: [] }],
      editedAt: Date.now(),
    }))
  }

  deleteScope(documentId: string, scopeId: string): Promise<SyllabusData> {
    return this.mutate(documentId, (data) => ({
      ...data,
      scopes: data.scopes.filter((scope) => scope.id !== scopeId),
      editedAt: Date.now(),
    }))
  }

  /** A topic the student adds by hand (`source: 'manual'`), matched locally. */
  async addTopic(documentId: string, scopeId: string, text: string): Promise<SyllabusData> {
    const body = text.replace(/\s+/g, ' ').trim()
    if (!body) throw new AppError(t('syllabus.errors.emptyTopic'), 'VALIDATION')
    const document = await this.syllabusDocument(documentId)
    const topics = matchable(await this.analyses.listTopics(document.projectId))
    return this.mutate(documentId, (data) => ({
      ...data,
      scopes: data.scopes.map((scope) => {
        if (scope.id !== scopeId) return scope
        const added: ExamTopic = {
          id: crypto.randomUUID(),
          text: body,
          order: scope.topics.length,
          source: 'manual',
        }
        return { ...scope, topics: [...scope.topics, ...rematchLocally([added], topics)] }
      }),
      editedAt: Date.now(),
    }))
  }

  deleteTopic(documentId: string, scopeId: string, topicId: string): Promise<SyllabusData> {
    return this.mutate(documentId, (data) => ({
      ...data,
      scopes: data.scopes.map((scope) =>
        scope.id === scopeId
          ? { ...scope, topics: renumber(scope.topics.filter((item) => item.id !== topicId)) }
          : scope,
      ),
      editedAt: Date.now(),
    }))
  }

  /**
   * Merge topics of one scope into the first of them: texts joined with " / ",
   * matches combined. The merged text is the student's, so it is `manual`.
   */
  mergeTopics(documentId: string, scopeId: string, topicIds: string[]): Promise<SyllabusData> {
    if (topicIds.length < 2) throw new AppError(t('syllabus.errors.mergeTwo'), 'VALIDATION')
    return this.mutate(documentId, (data) => ({
      ...data,
      scopes: data.scopes.map((scope) => {
        if (scope.id !== scopeId) return scope
        const picked = scope.topics.filter((item) => topicIds.includes(item.id))
        if (picked.length < 2) return scope
        const first = picked[0]!
        const ids = [...new Set(picked.flatMap((item) => item.topicIds ?? []))].slice(0, 6)
        const merged: ExamTopic = {
          ...first,
          text: picked.map((item) => item.text).join(' / '),
          source: 'manual',
          ...(ids.length > 0 ? { topicIds: ids, matchedBy: first.matchedBy ?? 'local' } : {}),
        }
        if (ids.length === 0) {
          delete merged.topicIds
          delete merged.matchedBy
        }
        const topics = scope.topics
          .filter((item) => item.id === first.id || !topicIds.includes(item.id))
          .map((item) => (item.id === first.id ? merged : item))
        return { ...scope, topics: renumber(topics) }
      }),
      editedAt: Date.now(),
    }))
  }

  // ---- matching ----------------------------------------------------------

  /**
   * Match every syllabus of the project to the course topics locally, when
   * the course topics changed since the last match (or `force`). AI matches
   * whose topics still exist are kept. No AI is called.
   */
  async matchLocally(projectId: string, options: { force?: boolean } = {}): Promise<number> {
    const topics = matchable(await this.analyses.listTopics(projectId))
    const fingerprint = topicsFingerprint(topics)
    const documents = (await this.documents.listByProject(projectId)).filter(
      (doc) => resolveMaterialType(doc.materialType) === 'syllabus' && doc.syllabus,
    )
    let updated = 0
    for (const document of documents) {
      if (!options.force && document.syllabus?.matchedAgainst === fingerprint) continue
      await this.mutate(document.id, (data) => ({
        ...data,
        scopes: data.scopes.map((scope) => ({
          ...scope,
          topics: rematchLocally(scope.topics, topics),
        })),
        matchedAgainst: fingerprint,
        matchedAt: Date.now(),
      }))
      updated++
    }
    return updated
  }

  /**
   * Closed-set AI matching for one scope (or all): the model may only name
   * course topic ids from the list it is given; anything else is dropped.
   * A topic the AI matches replaces its local match; an empty AI answer keeps
   * the local one.
   */
  async matchWithAi(
    documentId: string,
    ai: AIService,
    options: {
      scopeId?: string
      signal?: AbortSignal
      control?: GenerationControl
      resume?: boolean
    } = {},
  ): Promise<number> {
    return (await this.matchWithAiRun(documentId, ai, options)).matched
  }

  /**
   * `matchWithAi` with its progress. Each batch's matches are saved as soon as
   * the batch is answered, so a pause (finish the batch in flight, ask no
   * more) or a stop (abort it) keeps everything already matched. With
   * `resume`, the exam topics a paused run already asked about are skipped —
   * also in a forced rematch — so 「继续」 only asks about the rest.
   */
  async matchWithAiRun(
    documentId: string,
    ai: AIService,
    options: {
      scopeId?: string
      signal?: AbortSignal
      control?: GenerationControl
      resume?: boolean
    } = {},
  ): Promise<SyllabusMatchRun> {
    const control = resolveControl(options.control, options.signal)
    const document = await this.syllabusDocument(documentId)
    const courseTopics = await this.analyses.listTopics(document.projectId)
    if (courseTopics.length === 0) {
      throw new AppError(t('syllabus.errors.noCourseTopics'), 'NO_ANALYSIS')
    }
    const key = matchKey(documentId, options.scopeId)
    const previous = options.resume ? pausedMatches.get(key) : undefined
    pausedMatches.delete(key)
    const asked = new Set(previous?.asked ?? [])
    let matched = previous?.matched ?? 0
    const scopes = (document.syllabus?.scopes ?? []).filter(
      (scope) => !options.scopeId || scope.id === options.scopeId,
    )
    const all = scopes.flatMap((scope) => scope.topics)
    const total = all.length
    const remaining = all.filter((item) => !asked.has(item.id))
    // Short ids keep the prompt small and the answer easy to validate.
    const examIds = new Map(remaining.map((item, index) => [`e${index + 1}`, item.id]))
    const topicIds = new Map(courseTopics.map((topic, index) => [`t${index + 1}`, topic.id]))
    const courseList = courseTopics.map((topic, index) => ({
      id: `t${index + 1}`,
      name: topic.name,
      ...(topic.description ? { description: topic.description } : {}),
    }))
    const examEntries = [...examIds.entries()]
    let paused = false
    for (let i = 0; i < examEntries.length; i += MATCH_BATCH) {
      if (!control.shouldContinue()) {
        paused = true
        break
      }
      const batch = examEntries.slice(i, i + MATCH_BATCH)
      let data: unknown
      try {
        ;({ data } = await withLightModel(ai).chatJSON<unknown>(
          [
            { role: 'system', content: prompts.examTopicMatch.buildSystemPrompt() },
            {
              role: 'user',
              content: prompts.examTopicMatch.buildUserPrompt({
                examTopics: batch.map(([shortId, id]) => ({
                  id: shortId,
                  text: remaining.find((item) => item.id === id)!.text,
                })),
                courseTopics: courseList,
              }),
            },
          ],
          { maxTokens: 2048, signal: control.signal },
        ))
      } catch (err) {
        // A stopped batch is an interruption, not a failure: earlier batches stay saved.
        if (isAbortError(err, control.signal)) {
          paused = true
          break
        }
        throw err
      }
      const matches = readAiMatches(
        data,
        batch.map(([shortId]) => shortId),
        [...topicIds.keys()],
      )
      const found = new Map<string, string[]>()
      for (const [shortId, ids] of matches) {
        if (ids.length === 0) continue
        found.set(
          examIds.get(shortId)!,
          ids.map((id) => topicIds.get(id)!),
        )
      }
      await this.mutate(documentId, (current) => ({
        ...current,
        scopes: current.scopes.map((scope) => ({
          ...scope,
          topics: scope.topics.map((item) => {
            const ids = found.get(item.id)
            return ids ? { ...item, topicIds: ids, matchedBy: 'ai' as const } : item
          }),
        })),
        matchedAt: Date.now(),
      }))
      matched += found.size
      for (const [, id] of batch) asked.add(id)
    }
    if (paused) pausedMatches.set(key, { asked, matched })
    return { matched, done: asked.size, total, paused }
  }

  // ---- reading -----------------------------------------------------------

  /** Ready syllabus documents that have at least one exam scope. */
  async listSyllabi(projectId: string): Promise<Array<{ document: Document; data: SyllabusData }>> {
    return (await this.documents.listByProject(projectId))
      .filter(
        (doc) =>
          doc.status === 'ready' &&
          resolveMaterialType(doc.materialType) === 'syllabus' &&
          (doc.syllabus?.scopes.length ?? 0) > 0,
      )
      .map((document) => ({ document, data: document.syllabus! }))
  }

  /** Everything the exam-topic panel shows. Local only; may refresh local matches. */
  async overview(projectId: string): Promise<SyllabusOverview> {
    await this.matchLocally(projectId)
    const [documents, topics, concepts, mastery] = await Promise.all([
      this.documents.listByProject(projectId),
      this.analyses.listTopics(projectId),
      this.analyses.listConcepts(projectId),
      new KnowledgeMasteryRepository(this.db).listByProject(projectId),
    ])
    const syllabi = documents
      .filter(
        (doc) => doc.status === 'ready' && resolveMaterialType(doc.materialType) === 'syllabus',
      )
      .map((document) => ({ document, data: document.syllabus ?? null }))
    const pointsByTopic = new Map<string, string[]>()
    for (const concept of concepts) {
      for (const id of concept.topicIds) {
        pointsByTopic.set(id, [...(pointsByTopic.get(id) ?? []), concept.name])
      }
    }
    const input = {
      topics: new Map(topics.map((topic) => [topic.id, { id: topic.id, name: topic.name }])),
      pointsByTopic,
      mastery,
    }
    const coverage = new Map<string, ExamTopicCoverage>()
    for (const { data } of syllabi) {
      for (const scope of data?.scopes ?? []) {
        for (const item of scope.topics) coverage.set(item.id, examTopicCoverage(item, input))
      }
    }
    const hasKnowledgeSource = documents.some(
      (doc) => doc.status === 'ready' && KNOWLEDGE_ROLES.has(resolveMaterialType(doc.materialType)),
    )
    return {
      syllabi,
      topics,
      coverage,
      hasKnowledgeSource,
      suggestions: await this.suggestions(documents),
    }
  }

  /** Ready, re-labellable documents whose name or first page reads like a syllabus. */
  private async suggestions(documents: Document[]): Promise<Document[]> {
    const out: Document[] = []
    for (const document of documents) {
      if (document.status !== 'ready') continue
      if (!CONVERTIBLE.has(resolveMaterialType(document.materialType))) continue
      if (looksLikeSyllabus(document.name)) {
        out.push(document)
        continue
      }
      // Only the first few chunks are read: loading a whole textbook on every
      // panel reload would be wasted work.
      const chunks = await this.db.chunks
        .where('[documentId+order]')
        .between([document.id, -Infinity], [document.id, Infinity])
        .limit(FIRST_PAGE_CHUNKS)
        .toArray()
      const firstPage = chunks[0]?.pageNumber
      const head = chunks
        .slice(0, FIRST_PAGE_CHUNKS)
        .filter((chunk) => firstPage === undefined || chunk.pageNumber === firstPage)
        .map((chunk) => chunk.text)
        .join('\n')
      if (looksLikeSyllabus('', head)) out.push(document)
    }
    return out
  }

  /**
   * Re-label a processed textbook / notes / transcript as the course syllabus
   * (the student confirmed the suggestion). The chunks follow the new role,
   * the textbook structure detected from the file is removed (a syllabus has
   * no chapters of its own), and the exam topics are read. One transaction.
   */
  async markAsSyllabus(documentId: string, projectId: string): Promise<SyllabusData> {
    const document = await this.documents.get(documentId)
    if (document.projectId !== projectId) {
      throw new AppError(t('syllabus.errors.notFound'), 'NOT_FOUND')
    }
    if (!CONVERTIBLE.has(resolveMaterialType(document.materialType))) {
      throw new AppError(t('syllabus.errors.cannotConvert'), 'VALIDATION')
    }
    const chunks = await this.chunks.listByDocument(documentId)
    const data = localSyllabus(chunks.map(toChunkInput))
    const structures = new CourseStructureRepository(this.db)
    await this.db.transaction(
      'rw',
      [this.db.documents, this.db.chunks, this.db.courseStructures, this.db.courseStructureNodes],
      async () => {
        await this.db.documents.update(documentId, { materialType: 'syllabus', syllabus: data })
        for (const chunk of chunks) {
          const next: DocumentChunk = { ...chunk, materialType: 'syllabus' }
          delete next.chapterId
          delete next.sectionId
          delete next.chapterNumber
          delete next.sectionNumber
          delete next.chapterTitle
          delete next.sectionTitle
          await this.db.chunks.put(next)
        }
        await structures.deleteByDocument(documentId)
      },
    )
    logger.info('Document re-labelled as syllabus', { id: documentId, scopes: data.scopes.length })
    return data
  }
}

function renumber(topics: ExamTopic[]): ExamTopic[] {
  return topics.map((item, order) => ({ ...item, order }))
}
