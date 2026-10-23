import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { prompts } from '@/infrastructure/ai/prompts'
import { withSubject } from '@/infrastructure/ai/prompts/subject-profile/v1'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { StudyPlanRepository } from '@/entities/studyPlan/repository'
import type { PlannedExam } from '@/entities/studyPlan/types'
import {
  estimateReview,
  hasReviewContent,
  planReviewSections,
  REVIEW_CHUNK_CHARS,
  REVIEW_CHUNKS_PER_TOPIC,
  REVIEW_MISTAKES_PER_TOPIC,
  reviewStatus,
  selectReviewChunks,
  validateReviewReply,
  type ChunkCandidate,
  type ExamReview,
  type ReviewCitation,
  type ReviewEstimate,
  type ReviewSection,
} from '@/entities/studyPlan/review'
import { normalizeMaterials, resolveExamDocuments } from '@/entities/studyPlan/materials'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { resolveMaterialType } from '@/entities/document/types'
import { isHeldOut } from '@/entities/evaluation/evalRole'
import type { Mistake } from '@/entities/mistake/types'
import { createAdaptivePool, isOverloadError } from '@/shared/lib/concurrency'
import {
  isAbortError,
  NEVER_INTERRUPTED,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { t } from '@/i18n'
import type { AIService } from './aiService'
import { MistakeService } from './mistakeService'
import { StudyPlanService, notifyStudyPlanChanged, type ExamContext } from './studyPlanService'
import { loadCourseLanguage, type CourseLanguage } from './courseLanguage'
import { loadProjectSubjectContext } from './projectSubject'

/**
 * 复习提纲 for one planned exam (see `entities/studyPlan/review.ts`).
 *
 * - `plan` lays out the topics (scope × marks × weakness) as pending sections
 *   stored on the exam row; nothing is sent yet. `estimate` gives requests
 *   and tokens, `preflight` checks the provider answers.
 * - `generate` writes the sections not done yet, one request per topic,
 *   through the shared adaptive pool (同时进行的 AI 请求数, halving on 429).
 *   Each section is stored as soon as it is done. A pause starts no new
 *   topic, a stop aborts the running ones (they go back to pending, never
 *   failed); 继续 does the rest, and a failed topic can be retried alone.
 * - The chunks a topic is written from are the exam's picked materials when
 *   there are any, plus the topic's own validated source chunks; claims that
 *   cite anything else are dropped (`validateReviewReply`).
 */

export interface ExamReviewAIPort {
  chatJSON: AIService['chatJSON']
  testConnection(): Promise<{ ok: boolean; error?: string }>
  concurrency?: number
}

export interface ExamReviewDeps {
  db?: AppDatabase
  ai: ExamReviewAIPort | null
}

/** Exams whose sheet a run of this page is writing right now. */
const runningReviews = new Set<string>()

/** Roles never sent as review sources (answers, imported write-ups, the syllabus). */
const NOT_A_SOURCE = new Set(['homework_answer', 'walkthrough_import', 'syllabus'])

function isFatal(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return (
    code === 'MISSING_API_KEY' ||
    code === 'MISSING_BASE_URL' ||
    code === 'MISSING_MODEL' ||
    code === 'AUTH_FAILED' ||
    code === 'QUOTA_EXCEEDED'
  )
}

/** The prompt's language key from the course's 讲解与题目语言. */
async function reviewLanguage(projectId: string, db: AppDatabase): Promise<string> {
  const course: CourseLanguage = await loadCourseLanguage(projectId, { db }).catch(() => ({
    mode: 'zh_terms' as const,
  }))
  if (course.mode === 'exam') return course.examKey ?? 'zh_terms'
  if (course.mode === 'source') return 'mixed'
  return course.mode
}

/** A 复习提纲 section written for a chapter / file of the scope (no topic yet). */
export function unitSectionId(unitId: string): string {
  return `unit:${unitId}`
}

/** Up to `limit` chunks spread evenly over a chapter / file, in reading order. */
export function spreadChunks<T>(chunks: readonly T[], limit = REVIEW_CHUNKS_PER_TOPIC): T[] {
  if (chunks.length <= limit) return [...chunks]
  const out: T[] = []
  for (let i = 0; i < limit; i++) out.push(chunks[Math.floor((i * chunks.length) / limit)]!)
  return out
}

interface TopicWork {
  section: ReviewSection
  chunks: ChunkCandidate[]
  mistakes: Mistake[]
  marksShare?: number
}

export class ExamReviewService {
  private db: AppDatabase
  private repo: StudyPlanRepository
  private plans: StudyPlanService

  constructor(private deps: ExamReviewDeps) {
    this.db = deps.db ?? getDb()
    this.repo = new StudyPlanRepository(this.db)
    this.plans = new StudyPlanService({ db: this.db })
  }

  get hasAI(): boolean {
    return !!this.deps.ai
  }

  async get(examId: string): Promise<PlannedExam> {
    const exam = await this.repo.getExam(examId)
    if (!exam) throw new NotFoundError('Exam', examId)
    return exam
  }

  isRunning(examId: string): boolean {
    return runningReviews.has(examId)
  }

  /**
   * Store the sheet's topics as pending sections (nothing is sent). An
   * existing sheet is kept unless `replace`: then its topics are laid out
   * again (finished topics that are still in scope keep their text).
   */
  async plan(
    examId: string,
    options: { replace?: boolean; now?: number } = {},
  ): Promise<PlannedExam> {
    const now = options.now ?? Date.now()
    const existing = await this.get(examId)
    if (existing.review?.sections.length && !options.replace) return existing
    if (runningReviews.has(examId)) throw new AppError(t('plan.review.errors.running'), 'BUSY')
    const context = await this.plans.examContext(examId, now)
    // 按所选资料 / 按章节 before course analysis: one section per chapter / file.
    const planned = planReviewSections(
      context.topics.length > 0
        ? context.topics
        : context.scopeUnits.map((unit) => ({
            id: unitSectionId(unit.id),
            name: unit.title,
            mastery: null,
            openMistakes: 0,
          })),
    )
    if (planned.length === 0) throw new AppError(t('plan.review.errors.noTopics'), 'NO_TOPICS')
    const language = await reviewLanguage(existing.projectId, this.db)
    const updated = await this.repo.updateExam(examId, (exam) => {
      const old = new Map((exam.review?.sections ?? []).map((s) => [s.topicId ?? s.title, s]))
      const sections = planned.map((section) => {
        const kept = old.get(section.topicId ?? section.title)
        return kept && kept.status === 'done'
          ? { ...kept, id: section.id, order: section.order, priority: section.priority }
          : section
      })
      const review: ExamReview = {
        status: reviewStatus(sections),
        language,
        promptVersion: `exam-review/${prompts.examReview.VERSION}`,
        createdAt: exam.review?.createdAt ?? now,
        updatedAt: now,
        sections,
      }
      return { ...exam, review }
    })
    notifyStudyPlanChanged()
    return updated!
  }

  estimate(exam: PlannedExam): ReviewEstimate {
    return estimateReview(exam.review?.sections ?? [])
  }

  /** Remove the sheet (its plan tasks go at the next re-plan). */
  async remove(examId: string): Promise<void> {
    if (runningReviews.has(examId)) throw new AppError(t('plan.review.errors.running'), 'BUSY')
    await this.repo.updateExam(examId, (exam) => {
      const { review: _review, ...rest } = exam
      void _review
      return rest
    })
    notifyStudyPlanChanged()
  }

  /** Sections left `generating` by a closed tab wait for 继续 again. */
  async recoverInterrupted(examId: string): Promise<PlannedExam | undefined> {
    if (runningReviews.has(examId)) return this.repo.getExam(examId)
    const exam = await this.repo.getExam(examId)
    if (!exam?.review?.sections.some((s) => s.status === 'generating')) return exam
    return this.repo.updateExam(examId, (row) => {
      if (!row.review) return row
      const sections = row.review.sections.map((s): ReviewSection =>
        s.status === 'generating' ? { ...s, status: 'pending' } : s,
      )
      return { ...row, review: { ...row.review, sections, status: reviewStatus(sections) } }
    })
  }

  /** Before any request: a provider is set and answers. */
  async preflight(): Promise<void> {
    if (!this.deps.ai) throw new AppError(t('errors.aiKeyRequired'), 'MISSING_API_KEY')
    let result: { ok: boolean; error?: string }
    try {
      result = await this.deps.ai.testConnection()
    } catch (err) {
      throw new AppError(
        t('plan.review.errors.preflight', { reason: friendlyAIError(err) }),
        'PREFLIGHT_FAILED',
        err,
      )
    }
    if (!result.ok)
      throw new AppError(
        t('plan.review.errors.preflight', { reason: result.error ?? '' }),
        'PREFLIGHT_FAILED',
      )
  }

  /**
   * Write every section not done yet (继续 too). `sectionIds` limits it to
   * those (a failed topic retried alone); failed ones are retried only then
   * or with `retryFailed`.
   */
  async generate(
    examId: string,
    options: {
      control?: GenerationControl
      onProgress?: (exam: PlannedExam) => void
      sectionIds?: string[]
      retryFailed?: boolean
      now?: number
      /** Skip the connection check (it already ran in this session). */
      skipPreflight?: boolean
    } = {},
  ): Promise<PlannedExam> {
    const exam = await this.get(examId)
    if (!exam.review?.sections.length)
      throw new AppError(t('plan.review.errors.notPlanned'), 'NOT_PLANNED')
    if (runningReviews.has(examId)) throw new AppError(t('plan.review.errors.running'), 'BUSY')
    if (!options.skipPreflight) await this.preflight()
    runningReviews.add(examId)
    try {
      return await this.run(exam, options)
    } finally {
      runningReviews.delete(examId)
    }
  }

  private async run(
    exam: PlannedExam,
    options: {
      control?: GenerationControl
      onProgress?: (exam: PlannedExam) => void
      sectionIds?: string[]
      retryFailed?: boolean
      now?: number
    },
  ): Promise<PlannedExam> {
    const ai = this.deps.ai!
    const control = options.control ?? NEVER_INTERRUPTED
    const now = options.now ?? Date.now()
    const review = exam.review!
    const todo = review.sections.filter((s) => {
      if (options.sectionIds && !options.sectionIds.includes(s.id)) return false
      if (s.status === 'done') return false
      if (s.status === 'failed' && !options.retryFailed && !options.sectionIds) return false
      return true
    })

    const update = async (sectionId: string, patch: Partial<ReviewSection>) => {
      const next = await this.repo.updateExam(exam.id, (row) => {
        if (!row.review) return row
        const sections = row.review.sections.map((s) => {
          if (s.id !== sectionId) return s
          const merged: ReviewSection = { ...s, ...patch }
          if (patch.status && patch.status !== 'failed') delete merged.error
          return merged
        })
        return {
          ...row,
          review: {
            ...row.review,
            sections,
            status: reviewStatus(sections),
            updatedAt: Date.now(),
          },
        }
      })
      if (next) options.onProgress?.(next)
    }

    const work = todo.length > 0 ? await this.prepare(exam, todo, now) : []
    const subject = await loadProjectSubjectContext(exam.projectId, this.db)
    const system = withSubject(prompts.examReview.buildSystemPrompt(), subject)
    const courseName = (await this.db.projects.get(exam.projectId))?.name ?? ''

    const pool = createAdaptivePool({ max: ai.concurrency ?? 4, control })
    const outcomes = await pool.run(work, async (item, ctx) => {
      const { section } = item
      if (item.chunks.length === 0) {
        await update(section.id, { status: 'failed', error: t('plan.review.errors.noSources') })
        return null
      }
      await update(section.id, { status: 'generating' })
      try {
        const chunkAliases = new Map(item.chunks.map((chunk, i) => [`c${i + 1}`, chunk.id]))
        const mistakeAliases = new Map(item.mistakes.map((m, i) => [`m${i + 1}`, m.id]))
        const { data } = await ai.chatJSON<unknown>(
          [
            { role: 'system', content: system },
            {
              role: 'user',
              content: prompts.examReview.buildUserPrompt({
                language: review.language,
                exam: exam.name,
                course: courseName,
                topic: section.title,
                ...(section.mastery !== null ? { mastery: Math.round(section.mastery * 100) } : {}),
                ...(item.marksShare !== undefined
                  ? { marksShare: Math.round(item.marksShare * 100) }
                  : {}),
                chunks: item.chunks.map((chunk, i) => ({
                  alias: `c${i + 1}`,
                  where: chunk.page ? `${chunk.documentName} p. ${chunk.page}` : chunk.documentName,
                  text: chunk.text.slice(0, REVIEW_CHUNK_CHARS),
                })),
                mistakes: item.mistakes.map((m, i) => ({
                  alias: `m${i + 1}`,
                  question: m.question.slice(0, 500),
                  studentAnswer: m.studentAnswer.slice(0, 200),
                  correctAnswer: m.correctAnswer.slice(0, 200),
                  ...(m.analysis?.possibleCause
                    ? { cause: m.analysis.possibleCause.slice(0, 200) }
                    : {}),
                })),
              }),
            },
          ],
          { signal: ctx.control.signal, usageKind: 'tutor' },
        )
        const reply = validateReviewReply(data, chunkAliases, mistakeAliases)
        if (!hasReviewContent(reply))
          throw new AppError(t('plan.review.errors.unverifiable'), 'INVALID_RESPONSE')
        const citations: Record<string, ReviewCitation> = {}
        for (const id of reply.cited) {
          const chunk = item.chunks.find((c) => c.id === id)
          if (!chunk) continue
          citations[id] = {
            chunkId: id,
            documentId: chunk.documentId,
            documentName: chunk.documentName,
            ...(chunk.page ? { page: chunk.page } : {}),
          }
        }
        await update(section.id, {
          status: 'done',
          summary: reply.summary,
          keyPoints: reply.keyPoints,
          questionTypes: reply.questionTypes,
          mistakes: reply.mistakes,
          citations,
          dropped: reply.dropped,
          generatedAt: Date.now(),
        })
        return true
      } catch (err) {
        if (isAbortError(err, ctx.control.signal)) {
          await update(section.id, { status: 'pending' })
          return null
        }
        if (isOverloadError(err)) {
          await update(section.id, { status: 'pending' })
          throw err
        }
        if (isFatal(err)) ctx.halt()
        await update(section.id, { status: 'failed', error: friendlyAIError(err) })
        logger.warn('Exam review topic failed', {
          examId: exam.id,
          sectionId: section.id,
          error: String(err),
        })
        return null
      }
    })
    for (const [i, outcome] of outcomes.entries()) {
      const section = work[i]!.section
      if (outcome.status === 'skipped')
        await update(section.id, { status: section.status === 'failed' ? 'failed' : 'pending' })
      else if (outcome.status === 'rejected')
        await update(section.id, { status: 'failed', error: friendlyAIError(outcome.reason) })
    }
    notifyStudyPlanChanged()
    return this.get(exam.id)
  }

  /** Chunks and mistakes per topic (local, before any request). */
  private async prepare(
    exam: PlannedExam,
    sections: ReviewSection[],
    now: number,
  ): Promise<TopicWork[]> {
    const projectId = exam.projectId
    const analyses = new CourseAnalysisRepository(this.db)
    const [topics, concepts, documents, chunks, mistakes, context] = await Promise.all([
      analyses.listTopics(projectId),
      analyses.listConcepts(projectId),
      new DocumentRepository(this.db).listByProject(projectId),
      new ChunkRepository(this.db).listByProject(projectId),
      new MistakeService(this.db).list(projectId, { status: 'active' }),
      this.plans.examContext(exam.id, now).catch((): ExamContext | null => null),
    ])
    const docById = new Map(documents.map((doc) => [doc.id, doc]))
    const picked = resolveExamDocuments(normalizeMaterials(exam.materials), documents)
    const pickedIds = new Set(picked.map((entry) => entry.document.id))
    const usable = chunks.filter((chunk) => {
      const doc = docById.get(chunk.documentId)
      if (!doc || isHeldOut(doc, chunk)) return false
      if (NOT_A_SOURCE.has(resolveMaterialType(doc.materialType))) return false
      return true
    })
    const toCandidate = (chunk: (typeof usable)[number]): ChunkCandidate => ({
      id: chunk.id,
      documentId: chunk.documentId,
      documentName: docById.get(chunk.documentId)?.name ?? '',
      ...(chunk.pageNumber ? { page: chunk.pageNumber } : {}),
      text: chunk.text,
      order: chunk.order,
    })
    // The exam's own files when it has any (the topic's sources always count).
    const pool = (
      pickedIds.size > 0 ? usable.filter((c) => pickedIds.has(c.documentId)) : usable
    ).map(toCandidate)
    const all = new Map(usable.map((chunk) => [chunk.id, toCandidate(chunk)]))
    const topicById = new Map(topics.map((topic) => [topic.id, topic]))
    const marks = new Map((context?.topics ?? []).map((topic) => [topic.id, topic.marksShare]))
    const units = new Map((context?.scopeUnits ?? []).map((unit) => [unitSectionId(unit.id), unit]))
    return sections.map((section) => {
      const unit = section.topicId ? units.get(section.topicId) : undefined
      if (section.topicId?.startsWith('unit:')) {
        // A chapter / file: its own chunks, spread over it (no topic to match).
        const wanted = unit?.chunkIds ? new Set(unit.chunkIds) : null
        const own = unit
          ? usable
              .filter((c) => (wanted ? wanted.has(c.id) : c.documentId === unit.documentId))
              .sort((a, b) => a.order - b.order)
              .map(toCandidate)
          : []
        return { section, chunks: spreadChunks(own), mistakes: [] }
      }
      const topic = section.topicId ? topicById.get(section.topicId) : undefined
      const sourceIds = topic?.sourceChunkIds ?? []
      const candidates = [
        ...sourceIds.map((id) => all.get(id)).filter((c): c is ChunkCandidate => !!c),
        ...pool,
      ]
      const unique = candidates.filter((c, i) => candidates.findIndex((o) => o.id === c.id) === i)
      const topicConcepts = topic
        ? concepts.filter((c) => c.topicIds.includes(topic.id)).map((c) => c.name)
        : []
      const selected = selectReviewChunks(
        {
          name: section.title,
          ...(topic?.description ? { description: topic.description } : {}),
          concepts: topicConcepts,
          sourceChunkIds: sourceIds,
        },
        unique,
      )
      const points = new Set([section.title, ...topicConcepts].map((p) => p.toLowerCase()))
      const own = mistakes
        .filter(
          (m) =>
            (section.topicId && m.topicId === section.topicId) ||
            points.has(m.knowledgePoint.toLowerCase()),
        )
        .sort((a, b) => (b.lastOccurredAt ?? b.createdAt) - (a.lastOccurredAt ?? a.createdAt))
        .slice(0, REVIEW_MISTAKES_PER_TOPIC)
      const share = section.topicId ? marks.get(section.topicId) : undefined
      return {
        section,
        chunks: selected,
        mistakes: own,
        ...(share !== undefined ? { marksShare: share } : {}),
      }
    })
  }
}
