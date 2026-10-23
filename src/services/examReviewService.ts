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
  type ReviewQuestionRef,
  type ReviewSection,
} from '@/entities/studyPlan/review'
import {
  assignQuestions,
  buildOutlineEntries,
  buildReviewOverview,
  effectiveReviewSources,
  LECTURE_SOURCE_TYPES,
  mergeUnits,
  reviewSourceGroupOf,
  reviewSourceOptions,
  sameSources,
  sectionsFromPoints,
  validateOutlineReply,
  type OutlineEntry,
  type OutlineQuestion,
  type ReviewSourceGroup,
} from '@/entities/studyPlan/reviewOutline'
import { normalizeMaterials, resolveExamDocuments } from '@/entities/studyPlan/materials'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { PracticeRepository } from '@/entities/practice/repository'
import { isAiMockSet, isPastPaperSet } from '@/entities/homework/types'
import { isDeferredProfessorAnswer } from '@/entities/homework/answerMatching'
import { parseQuestionMarks } from '@/entities/exam/marks'
import {
  resolveMaterialType,
  type Document,
  type LearningMaterialType,
} from '@/entities/document/types'
import type { DocumentChunk } from '@/entities/chunk/types'
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
 * 复习提纲 for one planned exam (see `entities/studyPlan/review.ts` and
 * `reviewOutline.ts`).
 *
 * - The sheet is written from the files the student chose (用哪些资料:
 *   slides / textbook, past papers, answer keys, homework, practice by
 *   default; reading and the syllabus unchecked), stored on the review.
 * - `plan` lays out the knowledge points as pending sections. With AI
 *   (`useAI`) one request (`exam-review-outline/v1`) reads the chosen files'
 *   outline and question stems and returns the points merged across files;
 *   aliases are checked locally. Without AI (or when that reply is unusable)
 *   the course topics are used, else the scope's chapters / files with equal
 *   titles merged; questions are attached by local matching. A local
 *   考试概览 (question kinds, marks, most-tested points) is stored too.
 * - `generate` writes the sections not done yet, one request per point
 *   (`exam-review/v2`), through the shared adaptive pool. Each point gets its
 *   chunks across files, the questions testing it and the professor's
 *   answers; the reply adds the questions (考过的题) and the professor's
 *   marking (老师怎么给分, quoted verbatim). A pause starts no new point, a
 *   stop aborts the running ones (back to pending); 继续 does the rest.
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

/** Roles whose chunks may be sent as course text when chosen (answers / papers go as questions). */
const CHUNK_SOURCE_TYPES: ReadonlySet<LearningMaterialType> = new Set([
  ...LECTURE_SOURCE_TYPES,
  'reading',
  'syllabus',
])

/** Questions and answers sent per point, and their lengths. */
const QUESTIONS_PER_POINT = 8
const QUESTION_CHARS = 900
const ANSWER_CHARS = 1500
/** Question stems in the outline request. */
const OUTLINE_MAX_QUESTIONS = 150
const OUTLINE_QUESTION_CHARS = 260
/** Chunks kept on a laid-out point (the spans of its outline lines). */
const POINT_MAX_CHUNKS = 48
/** Chunks sent for a consolidated point. */
const POINT_CHUNKS = 10

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

/** One file of the source picker. */
export interface ReviewSourceOption {
  id: string
  name: string
  materialType: LearningMaterialType
  group: ReviewSourceGroup
  folderPath?: string
  /** Picked for the exam (考试资料). */
  inExam: boolean
}

interface MaterialQuestion extends OutlineQuestion {
  /** The professor's answer (matched, not "left to you"), when its key is chosen. */
  answer?: string
  /** A chunk of the paper the question was read from (for 出处). */
  sourceChunkId?: string
}

/** What the chosen files offer (loaded once per plan / run). */
interface ReviewMaterial {
  documents: Document[]
  sources: string[]
  chunks: DocumentChunk[]
  questions: MaterialQuestion[]
}

interface TopicWork {
  section: ReviewSection
  chunks: ChunkCandidate[]
  questions: MaterialQuestion[]
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

  // ── 用哪些资料 ───────────────────────────────────────────────────────────

  /** The files that may be chosen, grouped by role, and the current choice. */
  async sourceOptions(
    examId: string,
  ): Promise<{ options: ReviewSourceOption[]; selected: string[]; custom: boolean }> {
    const exam = await this.get(examId)
    const documents = await new DocumentRepository(this.db).listByProject(exam.projectId)
    const picked = this.pickedIds(exam, documents)
    const options = reviewSourceOptions(documents).map((doc): ReviewSourceOption => {
      const materialType = resolveMaterialType(doc.materialType)
      return {
        id: doc.id,
        name: doc.name,
        materialType,
        group: reviewSourceGroupOf(materialType)!,
        ...(doc.folderPath ? { folderPath: doc.folderPath } : {}),
        inExam: picked.has(doc.id),
      }
    })
    return {
      options,
      selected: effectiveReviewSources(exam.review?.sources, documents, picked),
      custom: !!exam.review?.sources,
    }
  }

  /**
   * Store the choice of files. A sheet already laid out is kept and marked
   * 可重新排列 (`scopeChangedAt`) when the choice changed.
   */
  async setSources(examId: string, documentIds: string[], now = Date.now()): Promise<PlannedExam> {
    if (runningReviews.has(examId)) throw new AppError(t('plan.review.errors.running'), 'BUSY')
    const exam = await this.get(examId)
    const documents = await new DocumentRepository(this.db).listByProject(exam.projectId)
    const before = effectiveReviewSources(
      exam.review?.sources,
      documents,
      this.pickedIds(exam, documents),
    )
    const ids = [...new Set(documentIds)]
    const updated = await this.repo.updateExam(examId, (row) => {
      const review: ExamReview = row.review ?? {
        status: 'draft',
        language: '',
        promptVersion: `exam-review/${prompts.examReview.VERSION}`,
        createdAt: now,
        updatedAt: now,
        sections: [],
      }
      const changed = !sameSources(before, ids)
      return {
        ...row,
        review: {
          ...review,
          sources: { documentIds: ids, updatedAt: now },
          ...(changed && review.sections.length > 0 ? { scopeChangedAt: now } : {}),
        },
      }
    })
    notifyStudyPlanChanged()
    return updated!
  }

  private pickedIds(exam: PlannedExam, documents: readonly Document[]): Set<string> {
    return new Set(
      resolveExamDocuments(normalizeMaterials(exam.materials), documents).map(
        (entry) => entry.document.id,
      ),
    )
  }

  /** The chosen files' chunks and questions (local). */
  private async loadMaterial(exam: PlannedExam): Promise<ReviewMaterial> {
    const projectId = exam.projectId
    const [documents, allChunks, sets, practice] = await Promise.all([
      new DocumentRepository(this.db).listByProject(projectId),
      new ChunkRepository(this.db).listByProject(projectId),
      new HomeworkRepository(this.db).listSets(projectId),
      new PracticeRepository(this.db).listQuestionsByProject(projectId).catch(() => []),
    ])
    const sources = effectiveReviewSources(
      exam.review?.sources,
      documents,
      this.pickedIds(exam, documents),
    )
    const chosen = new Set(sources)
    const docById = new Map(documents.map((doc) => [doc.id, doc]))
    const chunks = allChunks.filter((chunk) => {
      const doc = docById.get(chunk.documentId)
      return !!doc && !isHeldOut(doc, chunk)
    })
    const questions: MaterialQuestion[] = []
    const homework = new HomeworkRepository(this.db)
    for (const set of sets) {
      if (!chosen.has(set.documentId) || isAiMockSet(set) || set.kind === 'practice') continue
      const doc = docById.get(set.documentId)
      if (!doc || isHeldOut(doc, set)) continue
      const answersChosen = !!set.answerDocumentId && chosen.has(set.answerDocumentId)
      const kind: ReviewQuestionRef['kind'] = isPastPaperSet(set) ? 'past' : 'homework'
      const rows = (await homework.listQuestions(set.id))
        .filter((q) => !q.retired && !isHeldOut(set, q))
        .sort((a, b) => a.order - b.order)
      for (const question of rows) {
        const marks = parseQuestionMarks(question.prompt).total
        const answer =
          answersChosen && question.answerStatus === 'matched' ? question.answerText?.trim() : ''
        const sourceChunkId = question.sourceRefs.find((ref) => ref.chunkId)?.chunkId
        questions.push({
          questionId: question.id,
          text: question.prompt,
          ref: {
            questionId: question.id,
            setId: set.id,
            documentId: set.documentId,
            paper: set.title,
            ...(question.number ? { number: question.number } : {}),
            ...(marks !== undefined ? { marks } : {}),
            kind,
          },
          ...(answer && !isDeferredProfessorAnswer(answer) ? { answer } : {}),
          ...(sourceChunkId ? { sourceChunkId } : {}),
        })
      }
    }
    for (const question of [...practice].sort((a, b) => a.order - b.order)) {
      if (!chosen.has(question.documentId) || question.status === 'failed') continue
      const doc = docById.get(question.documentId)
      if (!doc || isHeldOut(doc)) continue
      const options = question.options.map((option) => option.label).filter(Boolean)
      const text =
        options.length > 0 ? `${question.prompt}\n${options.join('\n')}` : question.prompt
      const answer =
        question.answerSource === 'professor'
          ? [question.expectedAnswer, question.answerExplanation].filter(Boolean).join('\n')
          : ''
      questions.push({
        questionId: question.id,
        text,
        ref: {
          questionId: question.id,
          documentId: question.documentId,
          paper: question.documentName,
          ...(question.number ? { number: question.number } : {}),
          kind: 'practice',
        },
        ...(answer ? { answer } : {}),
        ...(question.chunkId ? { sourceChunkId: question.chunkId } : {}),
      })
    }
    return { documents, sources, chunks, questions }
  }

  // ── laying out the sheet ────────────────────────────────────────────────

  /**
   * Store the sheet's knowledge points as pending sections. An existing sheet
   * is kept unless `replace`: then its points are laid out again (finished
   * points that are still there keep their text). `useAI` sends the one
   * outline request (after the connection check); a stop leaves the sheet as
   * it was.
   */
  async plan(
    examId: string,
    options: {
      replace?: boolean
      now?: number
      useAI?: boolean
      control?: GenerationControl
    } = {},
  ): Promise<PlannedExam> {
    const now = options.now ?? Date.now()
    const existing = await this.get(examId)
    if (existing.review?.sections.length && !options.replace) return existing
    if (runningReviews.has(examId)) throw new AppError(t('plan.review.errors.running'), 'BUSY')
    const useAI = !!options.useAI && !!this.deps.ai
    if (useAI) await this.preflight()
    runningReviews.add(examId)
    try {
      return await this.layOut(existing, { ...options, now, useAI })
    } finally {
      runningReviews.delete(examId)
    }
  }

  private async layOut(
    existing: PlannedExam,
    options: { replace?: boolean; now: number; useAI: boolean; control?: GenerationControl },
  ): Promise<PlannedExam> {
    const { now } = options
    const examId = existing.id
    const context = await this.plans.examContext(examId, now)
    const material = await this.loadMaterial(existing)
    const language = await reviewLanguage(existing.projectId, this.db)
    const refs = new Map(material.questions.map((q) => [q.questionId, q.ref]))

    let planned: ReviewSection[] | null = null
    let layout: ExamReview['layout'] = 'local'
    if (options.useAI) {
      try {
        planned = await this.outline(existing, material, context, language, options.control)
        if (planned) layout = 'outline'
      } catch (err) {
        if (isAbortError(err, options.control?.signal)) return existing
        if (isFatal(err)) throw err
        logger.warn('Exam review outline failed; laying out locally', {
          examId,
          error: String(err),
        })
      }
    }
    if (!planned) planned = this.localLayout(context, material)
    if (planned.length === 0) throw new AppError(t('plan.review.errors.noTopics'), 'NO_TOPICS')
    // Labels of the questions on each point.
    for (const section of planned) {
      if (!section.questionIds?.length) continue
      const own: Record<string, ReviewQuestionRef> = {}
      for (const id of section.questionIds) {
        const ref = refs.get(id)
        if (ref) own[id] = ref
      }
      section.questionRefs = own
    }
    const overview = buildReviewOverview(material.questions, planned)

    const updated = await this.repo.updateExam(examId, (exam) => {
      const old = new Map((exam.review?.sections ?? []).map((s) => [s.topicId ?? s.title, s]))
      const oldByTitle = new Map((exam.review?.sections ?? []).map((s) => [s.title, s]))
      const sections = planned.map((section) => {
        const kept = old.get(section.topicId ?? section.title) ?? oldByTitle.get(section.title)
        return kept && kept.status === 'done' && kept.title === section.title
          ? {
              ...kept,
              id: section.id,
              order: section.order,
              priority: section.priority,
              ...(section.chunkIds ? { chunkIds: section.chunkIds } : {}),
              ...(section.questionIds ? { questionIds: section.questionIds } : {}),
              ...(section.questionRefs ? { questionRefs: section.questionRefs } : {}),
            }
          : section
      })
      const review: ExamReview = {
        status: reviewStatus(sections),
        language,
        promptVersion: `exam-review/${prompts.examReview.VERSION}`,
        createdAt: exam.review?.createdAt ?? now,
        updatedAt: now,
        sections,
        layout,
        overview,
        ...(exam.review?.sources ? { sources: exam.review.sources } : {}),
      }
      return { ...exam, review }
    })
    notifyStudyPlanChanged()
    return updated!
  }

  /** The one outline request: knowledge points across the chosen files (null = unusable). */
  private async outline(
    exam: PlannedExam,
    material: ReviewMaterial,
    context: ExamContext,
    language: string,
    control?: GenerationControl,
  ): Promise<ReviewSection[] | null> {
    const ai = this.deps.ai!
    const docById = new Map(material.documents.map((doc) => [doc.id, doc]))
    const chosen = new Set(material.sources)
    const lectureChunks = material.chunks.filter((chunk) => {
      const doc = docById.get(chunk.documentId)
      return (
        !!doc && chosen.has(doc.id) && CHUNK_SOURCE_TYPES.has(resolveMaterialType(doc.materialType))
      )
    })
    const entries = buildOutlineEntries(
      lectureChunks.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        documentName: docById.get(chunk.documentId)?.name ?? '',
        ...(chunk.pageNumber ? { page: chunk.pageNumber } : {}),
        contentType: chunk.contentType,
        text: chunk.text,
        order: chunk.order,
      })),
    )
    const questions = spreadChunks(material.questions, OUTLINE_MAX_QUESTIONS)
    if (entries.length === 0 && questions.length === 0) return null
    const topics = context.topics.slice(0, 60)
    const chunkAliases = new Map(entries.map((entry) => [entry.alias, entry.chunkId]))
    const questionAliases = new Map(questions.map((q, i) => [`q${i + 1}`, q.questionId]))
    const topicAliases = new Map(topics.map((topic, i) => [`t${i + 1}`, topic.id]))
    const courseName = context.project.name
    const subject = await loadProjectSubjectContext(exam.projectId, this.db)
    const { data } = await ai.chatJSON<unknown>(
      [
        {
          role: 'system',
          content: withSubject(prompts.examReviewOutline.buildSystemPrompt(), subject),
        },
        {
          role: 'user',
          content: prompts.examReviewOutline.buildUserPrompt({
            language,
            exam: exam.name,
            course: courseName,
            lines: entries.map((entry) => ({
              alias: entry.alias,
              where: entryWhere(entry),
              text: entry.text,
            })),
            questions: questions.map((q, i) => ({
              alias: `q${i + 1}`,
              where: questionWhere(q.ref),
              ...(q.ref.marks !== undefined ? { marks: q.ref.marks } : {}),
              text: q.text.replace(/\s+/g, ' ').slice(0, OUTLINE_QUESTION_CHARS),
            })),
            topics: topics.map((topic, i) => ({ alias: `t${i + 1}`, name: topic.name })),
          }),
        },
      ],
      { signal: control?.signal, usageKind: 'tutor' },
    )
    const { points } = validateOutlineReply(data, {
      chunks: chunkAliases,
      questions: questionAliases,
      topics: topicAliases,
    })
    if (points.length === 0) return null
    // A cited outline line stands for the chunks it heads.
    const spans = new Map(entries.map((entry) => [entry.chunkId, entry.spanChunkIds]))
    const expanded = points.map((point) => ({
      ...point,
      chunkIds: [...new Set(point.chunkIds.flatMap((id) => spans.get(id) ?? [id]))].slice(
        0,
        POINT_MAX_CHUNKS,
      ),
    }))
    const topicById = new Map(context.topics.map((topic) => [topic.id, topic]))
    return sectionsFromPoints(
      expanded,
      new Map(material.questions.map((q) => [q.questionId, q.ref])),
      {
        mastery: (id) => topicById.get(id)?.mastery ?? null,
        openMistakes: (id) => topicById.get(id)?.openMistakes ?? 0,
      },
    )
  }

  /**
   * Without the outline: the course topics, else the scope's chapters / files
   * of the chosen files (same titles merged); questions attached locally.
   */
  private localLayout(context: ExamContext, material: ReviewMaterial): ReviewSection[] {
    const chosen = new Set(material.sources)
    if (context.topics.length > 0) {
      const sections = planReviewSections(context.topics)
      const byQuestion = assignQuestions(
        sections.map((s) => ({ key: s.id, title: s.title })),
        material.questions,
      )
      return sections.map((s) => {
        const ids = byQuestion.get(s.id)
        return ids?.length ? { ...s, questionIds: ids } : s
      })
    }
    const units = context.scopeUnits.filter((unit) => chosen.has(unit.documentId))
    const groups = mergeUnits(units)
    const firstOf = new Map(groups.map((group) => [unitSectionId(group.units[0]!.id), group]))
    const sections = planReviewSections(
      groups.map((group) => ({
        id: unitSectionId(group.units[0]!.id),
        name: group.title,
        mastery: null,
        openMistakes: 0,
      })),
    )
    const byQuestion = assignQuestions(
      sections.map((s) => ({ key: s.id, title: s.title })),
      material.questions,
    )
    return sections.map((s) => {
      const group = s.topicId ? firstOf.get(s.topicId) : undefined
      const ids = byQuestion.get(s.id)
      return {
        ...s,
        ...(group && group.units.length > 1 ? { unitIds: group.units.map((unit) => unit.id) } : {}),
        ...(ids?.length ? { questionIds: ids } : {}),
      }
    })
  }

  estimate(exam: PlannedExam): ReviewEstimate {
    return estimateReview(exam.review?.sections ?? [])
  }

  /** Remove the sheet (its plan tasks go at the next re-plan); the choice of files stays. */
  async remove(examId: string): Promise<void> {
    if (runningReviews.has(examId)) throw new AppError(t('plan.review.errors.running'), 'BUSY')
    await this.repo.updateExam(examId, (exam) => {
      const { review, ...rest } = exam
      if (!review?.sources) return rest
      return {
        ...rest,
        review: {
          status: 'draft',
          language: review.language,
          promptVersion: review.promptVersion,
          createdAt: review.createdAt,
          updatedAt: Date.now(),
          sections: [],
          sources: review.sources,
        },
      }
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

    const prepared = todo.length > 0 ? await this.prepare(exam, todo, now) : null
    const work = prepared?.work ?? []
    const citable = prepared?.citable ?? new Map<string, ChunkCandidate>()
    const subject = await loadProjectSubjectContext(exam.projectId, this.db)
    const system = withSubject(prompts.examReview.buildSystemPrompt(), subject)
    const courseName = (await this.db.projects.get(exam.projectId))?.name ?? ''

    const pool = createAdaptivePool({ max: ai.concurrency ?? 4, control })
    const outcomes = await pool.run(work, async (item, ctx) => {
      const { section } = item
      if (item.chunks.length === 0 && item.questions.length === 0) {
        await update(section.id, { status: 'failed', error: t('plan.review.errors.noSources') })
        return null
      }
      await update(section.id, { status: 'generating' })
      try {
        const chunkAliases = new Map(item.chunks.map((chunk, i) => [`c${i + 1}`, chunk.id]))
        const questionAliases = new Map(item.questions.map((q, i) => [`q${i + 1}`, q.questionId]))
        // A claim may cite a question: it stands for the paper's chunk it was read from.
        item.questions.forEach((q, i) => {
          if (q.sourceChunkId && citable.has(q.sourceChunkId))
            chunkAliases.set(`q${i + 1}`, q.sourceChunkId)
        })
        const answered = item.questions
          .map((q, i) => ({ q, alias: `q${i + 1}` }))
          .filter(({ q }) => !!q.answer)
        const answerAliases = new Map(
          answered.map(({ q }, i) => [
            `a${i + 1}`,
            { questionId: q.questionId, text: q.answer!.slice(0, ANSWER_CHARS) },
          ]),
        )
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
                questions: item.questions.map((q, i) => ({
                  alias: `q${i + 1}`,
                  where: questionWhere(q.ref),
                  ...(q.ref.marks !== undefined ? { marks: q.ref.marks } : {}),
                  text: q.text.slice(0, QUESTION_CHARS),
                })),
                answers: answered.map(({ q, alias }, i) => ({
                  alias: `a${i + 1}`,
                  question: alias,
                  text: q.answer!.slice(0, ANSWER_CHARS),
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
        const reply = validateReviewReply(data, chunkAliases, mistakeAliases, {
          questions: questionAliases,
          answers: answerAliases,
        })
        if (!hasReviewContent(reply))
          throw new AppError(t('plan.review.errors.unverifiable'), 'INVALID_RESPONSE')
        const citations: Record<string, ReviewCitation> = {}
        for (const id of reply.cited) {
          const chunk = item.chunks.find((c) => c.id === id) ?? citable.get(id)
          if (!chunk) continue
          citations[id] = {
            chunkId: id,
            documentId: chunk.documentId,
            documentName: chunk.documentName,
            ...(chunk.page ? { page: chunk.page } : {}),
          }
        }
        const questionRefs: Record<string, ReviewQuestionRef> = { ...section.questionRefs }
        for (const q of item.questions) questionRefs[q.questionId] = q.ref
        await update(section.id, {
          status: 'done',
          summary: reply.summary,
          keyPoints: reply.keyPoints,
          questionTypes: reply.questionTypes,
          mistakes: reply.mistakes,
          examQuestions: reply.examQuestions,
          marking: reply.marking,
          citations,
          dropped: reply.dropped,
          ...(item.questions.length > 0 ? { questionRefs } : {}),
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

  /** Chunks, questions and mistakes per point (local, before any request). */
  private async prepare(
    exam: PlannedExam,
    sections: ReviewSection[],
    now: number,
  ): Promise<{ work: TopicWork[]; citable: Map<string, ChunkCandidate> }> {
    const projectId = exam.projectId
    const analyses = new CourseAnalysisRepository(this.db)
    const [topics, concepts, material, mistakes, context] = await Promise.all([
      analyses.listTopics(projectId),
      analyses.listConcepts(projectId),
      this.loadMaterial(exam),
      new MistakeService(this.db).list(projectId, { status: 'active' }),
      this.plans.examContext(exam.id, now).catch((): ExamContext | null => null),
    ])
    const docById = new Map(material.documents.map((doc) => [doc.id, doc]))
    const chosen = new Set(material.sources)
    const toCandidate = (chunk: DocumentChunk): ChunkCandidate => ({
      id: chunk.id,
      documentId: chunk.documentId,
      documentName: docById.get(chunk.documentId)?.name ?? '',
      ...(chunk.pageNumber ? { page: chunk.pageNumber } : {}),
      text: chunk.text,
      order: chunk.order,
    })
    const isChunkSource = (chunk: DocumentChunk): boolean => {
      const doc = docById.get(chunk.documentId)
      return !!doc && CHUNK_SOURCE_TYPES.has(resolveMaterialType(doc.materialType))
    }
    // Course text: the chosen lecture-like files (a topic's own sources always count).
    const usable = material.chunks.filter(isChunkSource)
    const pool = usable.filter((c) => chosen.has(c.documentId)).map(toCandidate)
    const all = new Map(usable.map((chunk) => [chunk.id, toCandidate(chunk)]))
    // Every chunk a claim may point at (a question's paper too).
    const citable = new Map(material.chunks.map((chunk) => [chunk.id, toCandidate(chunk)]))
    const questionById = new Map(material.questions.map((q) => [q.questionId, q]))
    const topicById = new Map(topics.map((topic) => [topic.id, topic]))
    const marks = new Map((context?.topics ?? []).map((topic) => [topic.id, topic.marksShare]))
    const units = new Map((context?.scopeUnits ?? []).map((unit) => [unitSectionId(unit.id), unit]))
    const work = sections.map((section): TopicWork => {
      const questions = (section.questionIds ?? [])
        .map((id) => questionById.get(id))
        .filter((q): q is MaterialQuestion => !!q)
        .slice(0, QUESTIONS_PER_POINT)
      const topic = section.topicId ? topicById.get(section.topicId) : undefined
      const topicConcepts = topic
        ? concepts.filter((c) => c.topicIds.includes(topic.id)).map((c) => c.name)
        : []
      const points = new Set([section.title, ...topicConcepts].map((p) => p.toLowerCase()))
      const own = mistakes
        .filter(
          (m) =>
            (section.topicId && m.topicId === section.topicId) ||
            points.has(m.knowledgePoint.toLowerCase()),
        )
        .sort((a, b) => (b.lastOccurredAt ?? b.createdAt) - (a.lastOccurredAt ?? a.createdAt))
        .slice(0, REVIEW_MISTAKES_PER_TOPIC)

      if (section.topicId?.startsWith('unit:')) {
        // Chapters / files: their own chunks, spread over them (no topic to match).
        const ids = section.unitIds?.length ? section.unitIds.map(unitSectionId) : [section.topicId]
        const chunks: ChunkCandidate[] = []
        for (const id of ids) {
          const unit = units.get(id)
          if (!unit) continue
          const wanted = unit.chunkIds ? new Set(unit.chunkIds) : null
          const list = usable
            .filter((c) => (wanted ? wanted.has(c.id) : c.documentId === unit.documentId))
            .sort((a, b) => a.order - b.order)
            .map(toCandidate)
          chunks.push(...spreadChunks(list, Math.ceil(REVIEW_CHUNKS_PER_TOPIC / ids.length)))
        }
        return {
          section,
          chunks: spreadChunks(chunks, REVIEW_CHUNKS_PER_TOPIC),
          questions,
          mistakes: [],
        }
      }

      const sourceIds = [...(section.chunkIds ?? []), ...(topic?.sourceChunkIds ?? [])]
      // A consolidated point is written from its own chunks (across files);
      // a course topic also draws on the chosen files.
      const candidates = section.chunkIds?.length
        ? [...sourceIds.map((id) => all.get(id)).filter((c): c is ChunkCandidate => !!c)]
        : [...sourceIds.map((id) => all.get(id)).filter((c): c is ChunkCandidate => !!c), ...pool]
      const unique = candidates.filter((c, i) => candidates.findIndex((o) => o.id === c.id) === i)
      const selected = selectReviewChunks(
        {
          name: section.title,
          ...(topic?.description ? { description: topic.description } : {}),
          concepts: topicConcepts,
          sourceChunkIds: sourceIds,
        },
        unique,
        section.chunkIds?.length ? POINT_CHUNKS : REVIEW_CHUNKS_PER_TOPIC,
      )
      const share = section.topicId ? marks.get(section.topicId) : undefined
      return {
        section,
        chunks: selected,
        questions,
        mistakes: own,
        ...(share !== undefined ? { marksShare: share } : {}),
      }
    })
    return { work, citable }
  }
}

function entryWhere(entry: OutlineEntry): string {
  return entry.page ? `${entry.documentName} p. ${entry.page}` : entry.documentName
}

function questionWhere(ref: ReviewQuestionRef): string {
  return ref.number ? `${ref.paper} · Q${ref.number.replace(/^Q/i, '')}` : ref.paper
}
