import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { StudyPlanRepository } from '@/entities/studyPlan/repository'
import type {
  DiagnosticItem,
  DiagnosticPaper,
  DiagnosticSection,
  DiagnosticStatus,
} from '@/entities/studyPlan/types'
import { QuizRepository } from '@/entities/quiz/repository'
import type { Quiz, QuizConfig } from '@/entities/quiz/types'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import { defaultQuestionTypes, type QuestionType } from '@/entities/question/types'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { createAdaptivePool, isOverloadError } from '@/shared/lib/concurrency'
import {
  isAbortError,
  NEVER_INTERRUPTED,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import type { ExamContext } from './studyPlanService'
import { notifyStudyPlanChanged } from './studyPlanService'

/**
 * 摸底卷 — one diagnostic paper over every planned exam's course.
 *
 * Generation reuses the quiz pipeline (`QuizService.generateQuiz`: batching,
 * local checks, option shuffling, source labels) and never writes questions
 * itself. A section (one course) is split into small items of ≤ 5 questions
 * on one topic each — one generation request each — run through the shared
 * adaptive pool (同时进行的 AI 请求数, halving on 429). Each item is stored
 * as soon as it finishes, so a pause, a stop, a closed tab or a failure keeps
 * everything already made: 继续 only does the rest, and a failed item is
 * retried on its own. When every item of a section is done, its questions are
 * assembled into one quiz the student takes in the ordinary quiz page.
 */

/** Questions per generation request (the quiz generator's batch size). */
export const DIAGNOSTIC_ITEM_MAX = 5
/** Questions per topic the diagnostic aims for. */
const PER_TOPIC = 2
export const DIAGNOSTIC_MAX_QUESTIONS = 30
/** Minutes per question assumed for the time estimate. */
const MINUTES_PER_QUESTION = 2.5
/** Rough request size (system prompt + passages) and answer size per question. */
const INPUT_TOKENS_PER_REQUEST = 5000
const OUTPUT_TOKENS_PER_QUESTION = 350
const DIAGNOSTIC_DIFFICULTY: DifficultyLevel = 'intermediate'

/** The part of `QuizService` the diagnostic uses (a port, so tests can stub it). */
export interface DiagnosticQuizPort {
  generateQuiz(
    projectId: string,
    config: QuizConfig,
    options?: { control?: GenerationControl },
  ): Promise<Quiz>
  continueQuiz(quizId: string, options?: { control?: GenerationControl }): Promise<Quiz>
}

/** Connection check before anything is generated. */
export interface DiagnosticAIPort {
  testConnection(): Promise<{ ok: boolean; error?: string }>
  concurrency?: number
}

export interface DiagnosticEstimate {
  requests: number
  inputTokens: number
  outputTokens: number
  questions: number
  minutes: number
}

export interface DiagnosticProgress {
  done: number
  failed: number
  total: number
  /** Per section: items done / total. */
  sections: Array<{ examId: string; done: number; failed: number; total: number }>
}

export interface ProposedTopic {
  key: string
  label: string
  topicId?: string
  examTopic?: DiagnosticItem['examTopic']
}

export interface SectionProposal {
  examId: string
  projectId: string
  label: string
  count: number
  minutes: number
  topics: ProposedTopic[]
}

/** Minutes the student needs for `count` questions. */
export function minutesFor(count: number): number {
  return Math.max(5, Math.round((count * MINUTES_PER_QUESTION) / 5) * 5)
}

/**
 * Suggested questions for a course: about two per topic in scope, weakest
 * (and least practised) first, 4–15 per course.
 */
export function proposeSection(context: ExamContext): SectionProposal {
  const topics = [...context.topics].sort(
    (a, b) =>
      (a.mastery ?? -1) - (b.mastery ?? -1) ||
      (b.marksShare ?? 0) - (a.marksShare ?? 0) ||
      a.name.localeCompare(b.name),
  )
  const count = Math.max(4, Math.min(15, topics.length * PER_TOPIC))
  return {
    examId: context.exam.id,
    projectId: context.exam.projectId,
    label: `${context.project.name} · ${context.exam.name}`,
    count,
    minutes: minutesFor(count),
    topics: topics.map((topic) => {
      if (topic.id.startsWith('exam:') && context.exam.scope.kind === 'syllabus') {
        return {
          key: topic.id,
          label: topic.name,
          examTopic: {
            documentId: context.exam.scope.documentId,
            scopeId: context.exam.scope.scopeId,
            examTopicId: topic.id.slice('exam:'.length),
          },
        }
      }
      return { key: topic.id, label: topic.name, topicId: topic.id }
    }),
  }
}

/** Split a section's questions over its topics: ≤ 5 per item, about two per topic. */
export function planItems(topics: ProposedTopic[], count: number): DiagnosticItem[] {
  const total = Math.max(1, Math.min(DIAGNOSTIC_MAX_QUESTIONS, Math.round(count)))
  if (topics.length === 0) {
    // No topic list (course not analysed yet): whole-course items.
    const items: DiagnosticItem[] = []
    for (let left = total, i = 0; left > 0; i++) {
      const n = Math.min(DIAGNOSTIC_ITEM_MAX, left)
      items.push({ id: `i${i + 1}`, label: '', count: n, status: 'pending' })
      left -= n
    }
    return items
  }
  const used = topics.slice(0, Math.max(1, Math.min(topics.length, Math.ceil(total / PER_TOPIC))))
  const counts = used.map(() => 0)
  for (let i = 0; i < total; i++) counts[i % used.length]! += 1
  const items: DiagnosticItem[] = []
  used.forEach((topic, i) => {
    let left = counts[i]!
    while (left > 0) {
      const n = Math.min(DIAGNOSTIC_ITEM_MAX, left)
      items.push({
        id: `i${items.length + 1}`,
        label: topic.label,
        count: n,
        ...(topic.topicId ? { topicId: topic.topicId } : {}),
        ...(topic.examTopic ? { examTopic: topic.examTopic } : {}),
        status: 'pending',
      })
      left -= n
    }
  })
  return items
}

/** Requests, tokens and answering time before anything is generated. */
export function estimateDiagnostic(
  sections: Array<{ items: DiagnosticItem[] }>,
): DiagnosticEstimate {
  const items = sections.flatMap((section) => section.items)
  const questions = items.reduce((sum, item) => sum + item.count, 0)
  return {
    requests: items.length,
    inputTokens: items.length * INPUT_TOKENS_PER_REQUEST,
    outputTokens: questions * OUTPUT_TOKENS_PER_QUESTION,
    questions,
    minutes: minutesFor(questions),
  }
}

export function diagnosticProgress(paper: DiagnosticPaper): DiagnosticProgress {
  const sections = paper.sections.map((section) => ({
    examId: section.examId,
    done: section.items.filter((item) => item.status === 'done').length,
    failed: section.items.filter((item) => item.status === 'failed').length,
    total: section.items.length,
  }))
  return {
    done: sections.reduce((sum, s) => sum + s.done, 0),
    failed: sections.reduce((sum, s) => sum + s.failed, 0),
    total: sections.reduce((sum, s) => sum + s.total, 0),
    sections,
  }
}

function paperStatus(paper: DiagnosticPaper): DiagnosticStatus {
  const items = paper.sections.flatMap((section) => section.items)
  if (paper.sections.every((section) => section.quizId)) return 'ready'
  if (items.some((item) => item.status === 'generating')) return 'generating'
  if (items.some((item) => item.status === 'pending' || item.status === 'paused')) {
    return items.some((item) => item.status !== 'pending') ? 'paused' : 'draft'
  }
  return 'partial'
}

/** Errors no retry helps (no key, no credit, wrong key): stop starting more items. */
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

export interface DiagnosticServiceDeps {
  db?: AppDatabase
  quiz: DiagnosticQuizPort | null
  ai: DiagnosticAIPort | null
  /** Question types per course (default: the quiz setup's defaults). */
  typesFor?: (projectId: string) => Promise<QuestionType[]>
}

/** Papers a run of this page is generating right now. */
const runningPapers = new Set<string>()

export class DiagnosticService {
  private db: AppDatabase
  private repo: StudyPlanRepository
  private quizzes: QuizRepository

  constructor(private deps: DiagnosticServiceDeps) {
    this.db = deps.db ?? getDb()
    this.repo = new StudyPlanRepository(this.db)
    this.quizzes = new QuizRepository(this.db)
  }

  list(): Promise<DiagnosticPaper[]> {
    return this.repo.listDiagnostics()
  }

  /**
   * Items left `generating` by a closed tab (no run of this page is working
   * on the paper) wait for 继续 again: `paused` when a quiz holds part of
   * them, else `pending`.
   */
  async recoverInterrupted(paperId: string): Promise<DiagnosticPaper | undefined> {
    if (runningPapers.has(paperId)) return this.repo.getDiagnostic(paperId)
    return this.repo.updateDiagnostic(paperId, (paper) => {
      const sections = paper.sections.map((section) => ({
        ...section,
        items: section.items.map((item): DiagnosticItem =>
          item.status === 'generating'
            ? { ...item, status: item.quizId ? 'paused' : 'pending' }
            : item,
        ),
      }))
      const next = { ...paper, sections }
      return { ...next, status: paperStatus(next) }
    })
  }

  isRunning(paperId: string): boolean {
    return runningPapers.has(paperId)
  }

  get(id: string): Promise<DiagnosticPaper | undefined> {
    return this.repo.getDiagnostic(id)
  }

  async remove(id: string): Promise<void> {
    await this.repo.deleteDiagnostic(id)
  }

  /** Store a paper from the (adjusted) proposal; nothing is generated yet. */
  async create(
    sections: Array<SectionProposal & { count: number; minutes: number }>,
    now = Date.now(),
  ): Promise<DiagnosticPaper> {
    const kept = sections.filter((section) => section.count > 0)
    if (kept.length === 0) throw new AppError(t('plan.diagnostic.errors.empty'), 'VALIDATION_ERROR')
    const paper: DiagnosticPaper = {
      id: crypto.randomUUID(),
      examIds: kept.map((section) => section.examId),
      sections: kept.map((section): DiagnosticSection => ({
        examId: section.examId,
        projectId: section.projectId,
        label: section.label,
        count: Math.min(DIAGNOSTIC_MAX_QUESTIONS, section.count),
        minutes: section.minutes,
        items: planItems(section.topics, section.count),
      })),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    await this.repo.putDiagnostic(paper)
    return paper
  }

  /**
   * Before any request: a key is set, the provider answers, and every course
   * has a finished course analysis (quiz generation needs one).
   */
  async preflight(paper: DiagnosticPaper): Promise<void> {
    if (!this.deps.ai || !this.deps.quiz) {
      throw new AppError(t('errors.aiKeyRequired'), 'MISSING_API_KEY')
    }
    const analyses = new CourseAnalysisRepository(this.db)
    for (const section of paper.sections) {
      if (section.quizId) continue
      const analysis = await analyses.getByProject(section.projectId)
      if (analysis?.status !== 'ready') {
        throw new AppError(
          t('plan.diagnostic.errors.noAnalysis', { course: section.label }),
          'NO_ANALYSIS',
        )
      }
    }
    let result: { ok: boolean; error?: string }
    try {
      result = await this.deps.ai.testConnection()
    } catch (err) {
      throw new AppError(
        t('plan.diagnostic.errors.preflight', { reason: friendlyAIError(err) }),
        'PREFLIGHT_FAILED',
        err,
      )
    }
    if (!result.ok) {
      throw new AppError(
        t('plan.diagnostic.errors.preflight', { reason: result.error ?? '' }),
        'PREFLIGHT_FAILED',
      )
    }
  }

  /**
   * Generate every item not done yet (also 继续 after a pause, and a retry of
   * failed items when `retryFailed`). Returns the stored paper.
   */
  async generate(
    paperId: string,
    options: {
      control?: GenerationControl
      onProgress?: (paper: DiagnosticPaper) => void
      /** Only these items (e.g. one failed item retried on its own). */
      itemIds?: string[]
      retryFailed?: boolean
    } = {},
  ): Promise<DiagnosticPaper> {
    const start = await this.repo.getDiagnostic(paperId)
    if (!start) throw new AppError(t('plan.diagnostic.errors.notFound'), 'NOT_FOUND')
    if (runningPapers.has(paperId)) throw new AppError(t('plan.diagnostic.errors.running'), 'BUSY')
    await this.preflight(start)
    runningPapers.add(paperId)
    try {
      return await this.runItems(start, options)
    } finally {
      runningPapers.delete(paperId)
    }
  }

  private async runItems(
    start: DiagnosticPaper,
    options: {
      control?: GenerationControl
      onProgress?: (paper: DiagnosticPaper) => void
      itemIds?: string[]
      retryFailed?: boolean
    },
  ): Promise<DiagnosticPaper> {
    const paperId = start.id
    const quiz = this.deps.quiz!
    const control = options.control ?? NEVER_INTERRUPTED

    type Work = { section: number; item: DiagnosticItem }
    const work: Work[] = []
    start.sections.forEach((section, s) => {
      if (section.quizId) return
      for (const item of section.items) {
        if (options.itemIds && !options.itemIds.includes(item.id)) continue
        if (item.status === 'done') continue
        if (item.status === 'failed' && !options.retryFailed && !options.itemIds) continue
        work.push({ section: s, item })
      }
    })

    const update = async (s: number, itemId: string, patch: Partial<DiagnosticItem>) => {
      const next = await this.repo.updateDiagnostic(paperId, (paper) => {
        const sections = paper.sections.map((section, i) =>
          i !== s
            ? section
            : {
                ...section,
                items: section.items.map((item) => {
                  if (item.id !== itemId) return item
                  const merged = { ...item, ...patch }
                  if (patch.status && patch.status !== 'failed') delete merged.error
                  return merged
                }),
              },
        )
        const updated = { ...paper, sections }
        return { ...updated, status: paperStatus(updated) }
      })
      if (next) options.onProgress?.(next)
    }

    const types = new Map<string, QuestionType[]>()
    const typesFor = async (projectId: string): Promise<QuestionType[]> => {
      if (!types.has(projectId)) {
        types.set(
          projectId,
          this.deps.typesFor
            ? await this.deps.typesFor(projectId)
            : defaultQuestionTypes(
                (await this.db.projects.get(projectId))?.subject,
                (await this.db.projects.get(projectId))?.targetLanguage,
              ),
        )
      }
      return types.get(projectId)!
    }

    const pool = createAdaptivePool({
      max: this.deps.ai?.concurrency ?? 4,
      control,
    })
    const outcomes = await pool.run(work, async ({ section: s, item }, ctx) => {
      const section = start.sections[s]!
      await update(s, item.id, { status: 'generating' })
      try {
        let result: Quiz
        const existing = item.quizId ? await this.quizzes.get(item.quizId) : undefined
        if (existing && existing.status === 'paused') {
          result = await quiz.continueQuiz(existing.id, { control: ctx.control })
        } else {
          // A failed or vanished earlier attempt is replaced, not kept.
          if (existing) await this.quizzes.delete(existing.id)
          const config: QuizConfig = {
            mode: 'topic',
            count: item.count,
            difficulty: DIAGNOSTIC_DIFFICULTY,
            types: await typesFor(section.projectId),
            ...(item.topicId ? { topicId: item.topicId, topicName: item.label } : {}),
            ...(!item.topicId && !item.examTopic ? { mode: 'mixed' as const } : {}),
            ...(item.examTopic
              ? {
                  topicName: item.label,
                  examScope: { ...item.examTopic, includeUnmatched: true },
                }
              : {}),
          }
          result = await quiz.generateQuiz(section.projectId, config, { control: ctx.control })
        }
        if (result.status === 'paused') {
          await update(s, item.id, { status: 'paused', quizId: result.id })
        } else {
          await update(s, item.id, {
            status: 'done',
            quizId: result.id,
            questions: result.questionIds.length,
          })
        }
        return result
      } catch (err) {
        if (isAbortError(err, ctx.control.signal)) {
          await update(s, item.id, { status: 'paused' })
          return null
        }
        // The pool backs off and tries a rate-limited item again.
        if (isOverloadError(err)) {
          await update(s, item.id, { status: 'pending' })
          throw err
        }
        if (isFatal(err)) ctx.halt()
        await update(s, item.id, { status: 'failed', error: friendlyAIError(err) })
        logger.warn('Diagnostic item failed', { paperId, itemId: item.id, error: String(err) })
        return null
      }
    })
    // Items that never started (paused / stopped / halted) wait for 继续.
    for (const [i, outcome] of outcomes.entries()) {
      if (outcome.status === 'skipped') {
        const { section, item } = work[i]!
        await update(section, item.id, { status: item.status === 'failed' ? 'failed' : 'pending' })
      } else if (outcome.status === 'rejected') {
        const { section, item } = work[i]!
        await update(section, item.id, {
          status: 'failed',
          error: friendlyAIError(outcome.reason),
        })
      }
    }
    const assembled = await this.assembleReady(paperId)
    notifyStudyPlanChanged()
    return assembled
  }

  /** Assemble every section whose items are all done into its quiz. */
  async assembleReady(
    paperId: string,
    options: { allowFailed?: boolean } = {},
  ): Promise<DiagnosticPaper> {
    const paper = await this.repo.getDiagnostic(paperId)
    if (!paper) throw new AppError(t('plan.diagnostic.errors.notFound'), 'NOT_FOUND')
    const sections: DiagnosticSection[] = []
    for (const section of paper.sections) {
      const finished = section.items.every(
        (item) => item.status === 'done' || (options.allowFailed && item.status === 'failed'),
      )
      const doneItems = section.items.filter((item) => item.status === 'done' && item.quizId)
      if (section.quizId || !finished || doneItems.length === 0) {
        sections.push(section)
        continue
      }
      sections.push(await this.assemble(section, doneItems))
    }
    const next = { ...paper, sections, updatedAt: Date.now() }
    const stored = { ...next, status: paperStatus(next) }
    await this.repo.putDiagnostic(stored)
    return stored
  }

  private async assemble(
    section: DiagnosticSection,
    items: DiagnosticItem[],
  ): Promise<DiagnosticSection> {
    const parts = (await Promise.all(items.map((item) => this.quizzes.get(item.quizId!)))).filter(
      (quiz): quiz is Quiz => !!quiz,
    )
    const questionIds = parts.flatMap((quiz) => quiz.questionIds)
    const types = [...new Set(parts.flatMap((quiz) => quiz.config.types))]
    const quiz: Quiz = {
      id: crypto.randomUUID(),
      projectId: section.projectId,
      title: t('plan.diagnostic.quizTitle', { label: section.label, count: questionIds.length }),
      config: {
        mode: 'mixed',
        count: questionIds.length,
        difficulty: DIAGNOSTIC_DIFFICULTY,
        types,
      },
      questionIds,
      status: 'ready',
      difficultyPlan: parts.flatMap((part) =>
        part.difficultyPlan.length === part.questionIds.length
          ? part.difficultyPlan
          : part.questionIds.map(() => DIAGNOSTIC_DIFFICULTY),
      ),
      startedAt: Date.now(),
      promptVersion: parts[0]?.promptVersion ?? '',
    }
    await this.quizzes.upsert(quiz)
    // The per-item quizzes were only containers; their questions now belong
    // to the assembled one.
    for (const part of parts) await this.quizzes.delete(part.id)
    return {
      ...section,
      quizId: quiz.id,
      items: section.items.map((item) => {
        if (!item.quizId) return item
        const { quizId: _q, ...rest } = item
        void _q
        return rest
      }),
    }
  }

  /** Per-section results of a taken diagnostic (estimates from the quiz scores). */
  async results(paperId: string): Promise<
    Array<{
      examId: string
      projectId: string
      label: string
      quiz?: Quiz
      percentage: number | null
      byKnowledgePoint: Array<{ knowledgePoint: string; percent: number | null; total: number }>
    }>
  > {
    const paper = await this.repo.getDiagnostic(paperId)
    if (!paper) return []
    const out = []
    for (const section of paper.sections) {
      const quiz = section.quizId ? await this.quizzes.get(section.quizId) : undefined
      const score = quiz?.score
      out.push({
        examId: section.examId,
        projectId: section.projectId,
        label: section.label,
        ...(quiz ? { quiz } : {}),
        percentage: score ? score.percentage : null,
        byKnowledgePoint: (score?.byKnowledgePoint ?? []).map((row) => {
          const gradable = row.correct + row.wrong
          return {
            knowledgePoint: row.knowledgePoint,
            percent:
              gradable > 0 ? Math.round(((row.points ?? row.correct) / gradable) * 100) : null,
            total: row.total,
          }
        }),
      })
    }
    return out
  }
}
