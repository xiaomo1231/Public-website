import { isHeldOut } from '@/entities/evaluation/evalRole'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { renderPdfPageImage } from '@/infrastructure/files/pdfExtractor'
import { HomeworkRepository } from '@/entities/homework/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { answerReference } from '@/entities/homework/answerCheck'
import { isExamSet, type HomeworkQuestion, type HomeworkSet } from '@/entities/homework/types'
import { resolveMaterialType } from '@/entities/document/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import {
  DEFAULT_EXAM_MINUTES,
  MAX_EXAM_ATTEMPTS,
  type ExamSetInfo,
  type MockExamAttempt,
  type MockExamQuestionResult,
} from '@/entities/exam/types'
import { markingSchemeLines, parseQuestionMarks, type QuestionMarks } from '@/entities/exam/marks'
import { findFormulaSheet, type FormulaSheet } from '@/entities/exam/paper'
import { resultFromCheck } from '@/entities/exam/scoring'
import {
  analyzePastExams,
  matchQuestionTopics,
  type PastExamAnalysis,
} from '@/entities/exam/analysis'
import {
  resolveControl,
  isAbortError,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { t } from '@/i18n'
import type { HomeworkService } from './homeworkService'
import { recordCheckedAnswer } from './practiceLearning'

/**
 * 模拟考试 on a past paper (`HomeworkSet.kind === 'exam'`).
 *
 * The paper's own questions, in paper order and wording, against a timer;
 * nothing else is shown while writing (no hints, AI, walkthrough or answers).
 * After 交卷 every answered question is checked with the existing answer check
 * (local where it can decide, else the AI against the professor's answer key
 * or, without one, the AI solution). Marks come only from the paper; earned
 * marks are platform estimates and are labelled so. The professor's own
 * marking scheme (lines of the answer key that carry marks) is shown
 * separately and verbatim.
 *
 * Checked answers feed the mistake book and mastery exactly like practice-set
 * checks (`recordCheckedAnswer`, origin `mock_exam`), with the lecture sources
 * of the course topic the question matches, so 错题跟进 can link the slides.
 */

export interface MockExamQuestionView {
  question: HomeworkQuestion
  marks: QuestionMarks
  /** The professor's marking-scheme lines from the answer key (verbatim; may be empty). */
  scheme: string[]
  /** Page of the paper the question is on, when known. */
  page?: number
}

export interface MockExamState {
  set: HomeworkSet
  questions: MockExamQuestionView[]
  /** Minutes offered by default: the student's choice, else the paper's, else 60. */
  defaultMinutes: number
  detectedMinutes?: number
  formulaSheet: FormulaSheet | null
  /** Whether every question has a reference to check against. */
  missingReference: number
}

export interface MockExamCheckProgress {
  completed: number
  total: number
}

export class MockExamService {
  private db: AppDatabase
  private homework: HomeworkRepository
  private service: HomeworkService

  constructor(deps: { homework: HomeworkService; db?: AppDatabase }) {
    this.db = deps.db ?? getDb()
    this.homework = new HomeworkRepository(this.db)
    this.service = deps.homework
  }

  /** Exam papers of a course (ready or not), newest first. */
  async listExamSets(projectId: string): Promise<HomeworkSet[]> {
    return (await this.homework.listSets(projectId)).filter(isExamSet)
  }

  async state(setId: string): Promise<MockExamState> {
    const set = await this.requireExam(setId)
    const questions = (await this.homework.listQuestions(setId))
      .filter((question) => !question.retired)
      .sort((a, b) => a.order - b.order)
    const chunks = await new ChunkRepository(this.db).listByDocument(set.documentId)
    const views = questions.map((question) => {
      const page = question.sourceRefs.find(
        (ref) => ref.documentId === set.documentId && ref.page,
      )?.page
      return {
        question,
        marks: parseQuestionMarks(question.prompt),
        scheme: question.answerStatus === 'matched' ? markingSchemeLines(question.answerText) : [],
        ...(page ? { page } : {}),
      }
    })
    const detected = set.exam?.detectedMinutes
    return {
      set,
      questions: views,
      defaultMinutes: set.exam?.durationMinutes ?? detected ?? DEFAULT_EXAM_MINUTES,
      ...(detected !== undefined ? { detectedMinutes: detected } : {}),
      formulaSheet: findFormulaSheet(
        chunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
          order: chunk.order,
          ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
        })),
      ),
      missingReference: questions.filter((question) => !answerReference(question)).length,
    }
  }

  /** Start (or return the unfinished) attempt. Minutes are clamped to 5–600. */
  async start(setId: string, minutes: number): Promise<MockExamAttempt> {
    const set = await this.requireExam(setId)
    const current = set.exam?.current
    if (current && !current.submittedAt) return current
    const duration = Math.min(600, Math.max(5, Math.round(minutes)))
    const now = Date.now()
    const attempt: MockExamAttempt = {
      id: crypto.randomUUID(),
      startedAt: now,
      durationMinutes: duration,
      endsAt: now + duration * 60_000,
      answers: {},
    }
    await this.updateExam(setId, (exam) => ({
      ...exam,
      durationMinutes: duration,
      current: attempt,
    }))
    return attempt
  }

  /** Save one answer while writing (ignored once submitted). */
  async saveAnswer(setId: string, questionId: string, text: string): Promise<void> {
    await this.updateExam(setId, (exam) => {
      const current = exam.current
      if (!current || current.submittedAt) return exam
      return {
        ...exam,
        current: { ...current, answers: { ...current.answers, [questionId]: text } },
      }
    })
  }

  /** 交卷 (or time out). Answers are frozen; checking follows with `check`. */
  async submit(setId: string, options: { timedOut?: boolean } = {}): Promise<MockExamAttempt> {
    let submitted: MockExamAttempt | undefined
    await this.updateExam(setId, (exam) => {
      const current = exam.current
      if (!current) return exam
      if (current.submittedAt) {
        submitted = current
        return exam
      }
      submitted = {
        ...current,
        submittedAt: Date.now(),
        ...(options.timedOut ? { timedOut: true } : {}),
      }
      return { ...exam, current: submitted }
    })
    if (!submitted) throw new AppError(t('mockExam.noAttempt'), 'VALIDATION_ERROR')
    return submitted
  }

  /** Give up the unsubmitted attempt (nothing is checked or recorded). */
  async discard(setId: string): Promise<void> {
    await this.updateExam(setId, (exam) => {
      const rest = { ...exam }
      delete rest.current
      return rest
    })
  }

  /**
   * Check the submitted attempt, one question at a time in paper order.
   * Questions that already have a result are skipped, so a stopped check
   * continues where it left off. A failed request marks only that question.
   * Each newly decided answer is recorded (mistake book + mastery).
   */
  async check(
    setId: string,
    language: 'zh' | 'en',
    options: { control?: GenerationControl; onProgress?: (p: MockExamCheckProgress) => void } = {},
  ): Promise<MockExamAttempt> {
    const control = resolveControl(options.control)
    const state = await this.state(setId)
    const attempt = state.set.exam?.current
    if (!attempt?.submittedAt) throw new AppError(t('mockExam.notSubmitted'), 'VALIDATION_ERROR')
    const topics = await new CourseAnalysisRepository(this.db).listTopics(state.set.projectId)
    const paper = await this.db.documents.get(state.set.documentId)
    const results = new Map((attempt.results ?? []).map((item) => [item.questionId, item]))
    const total = state.questions.length
    let completed = 0
    for (const view of state.questions) {
      const { question } = view
      const previous = results.get(question.id)
      if (previous && previous.status !== 'failed') {
        completed += 1
        continue
      }
      options.onProgress?.({ completed, total })
      if (!control.shouldContinue()) break
      const marks = view.marks.total
      const answer = (attempt.answers[question.id] ?? '').trim()
      const images = await this.service.answerImageService().list(question.id)
      let result: MockExamQuestionResult
      if (!answer && images.length === 0) {
        result = {
          questionId: question.id,
          status: 'unanswered',
          fraction: 0,
          ...(marks !== undefined ? { marks, estimatedMarks: 0 } : {}),
        }
      } else if (!answerReference(question)) {
        result = {
          questionId: question.id,
          status: 'uncertain',
          ...(marks !== undefined ? { marks } : {}),
          note: t('homework.check.noReference'),
        }
      } else {
        try {
          const check = await this.service.checkAnswer(question.id, answer, language, {
            signal: control.signal,
          })
          result = resultFromCheck(question.id, marks, check)
          if (result.status === 'checked')
            await this.record(state.set, question, answer, check, topics, isHeldOut(paper))
        } catch (err) {
          if (isAbortError(err, control.signal)) break
          logger.warn('Mock exam check failed', { questionId: question.id })
          result = {
            questionId: question.id,
            status: 'failed',
            ...(marks !== undefined ? { marks } : {}),
            note: friendlyAIError(err),
          }
        }
      }
      results.set(question.id, result)
      completed += 1
      await this.saveResults(setId, attempt.id, state.questions, results)
    }
    options.onProgress?.({ completed, total })
    return this.finishIfComplete(setId, attempt.id, state.questions, results)
  }

  /** Render the formula / data sheet pages of the paper (PDF only, locally). */
  async formulaSheetImages(setId: string): Promise<Array<{ page: number; image: Blob }>> {
    const state = await this.state(setId)
    const sheet = state.formulaSheet
    if (!sheet || sheet.pages.length === 0) return []
    const documents = new DocumentRepository(this.db)
    const document = await documents.get(state.set.documentId).catch(() => null)
    if (!document || document.type !== 'pdf') return []
    const stored = await documents.getBytes(document.id)
    if (!stored) return []
    const source = new Blob([stored.bytes], { type: stored.mimeType })
    const out: Array<{ page: number; image: Blob }> = []
    for (const page of sheet.pages.slice(0, 3)) {
      const rendered = await renderPdfPageImage(source, page, 1.5)
      if (rendered)
        out.push({ page, image: new Blob([rendered.bytes], { type: rendered.mimeType }) })
    }
    return out
  }

  /**
   * 题型与覆盖分析 over every ready past paper of the course, against the
   * course topics and the syllabus exam scopes. Local only.
   */
  async analysis(projectId: string): Promise<PastExamAnalysis> {
    const sets = (await this.listExamSets(projectId)).filter((set) => set.status === 'ready')
    const papers = []
    for (const set of sets) {
      const questions = (await this.homework.listQuestions(set.id)).filter(
        (question) => !question.retired,
      )
      papers.push({
        setId: set.id,
        title: set.title,
        questions: questions.map((question) => ({
          id: question.id,
          setId: set.id,
          prompt: question.prompt,
        })),
      })
    }
    const topics = await new CourseAnalysisRepository(this.db).listTopics(projectId)
    const documents = await new DocumentRepository(this.db).listByProject(projectId)
    const scopes = documents
      .filter((doc) => resolveMaterialType(doc.materialType) === 'syllabus' && doc.syllabus)
      .flatMap((doc) => doc.syllabus!.scopes)
    return analyzePastExams({
      papers,
      topics: topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        description: topic.description,
      })),
      scopes,
    })
  }

  // ---------------------------------------------------------------------------

  private async record(
    set: HomeworkSet,
    question: HomeworkQuestion,
    answer: string,
    check: Awaited<ReturnType<HomeworkService['checkAnswer']>>,
    topics: Topic[],
    paperHeldOut = false,
  ): Promise<void> {
    const topicId = matchQuestionTopics(question.prompt, topics)[0]
    const topic = topicId ? topics.find((item) => item.id === topicId) : undefined
    await recordCheckedAnswer(this.db, {
      projectId: set.projectId,
      questionId: question.id,
      prompt: question.prompt,
      ...(question.solution ? { solution: question.solution } : {}),
      knowledgePoint: topic?.name ?? set.title,
      ...(topic ? { topicId: topic.id } : {}),
      answer,
      correctAnswer: check.expectedAnswer ?? answerReference(question)?.text ?? '',
      check,
      origin: 'mock_exam',
      homeworkSetId: set.id,
      // The lecture sources of the matched topic (the paper itself is not a lecture).
      ...(topic?.sourceRefs.length ? { sourceRefs: topic.sourceRefs } : {}),
      ...(paperHeldOut || isHeldOut(set, question) ? { noFollowUp: true } : {}),
    })
  }

  private async saveResults(
    setId: string,
    attemptId: string,
    questions: MockExamQuestionView[],
    results: Map<string, MockExamQuestionResult>,
  ): Promise<void> {
    await this.updateExam(setId, (exam) => {
      const current = exam.current
      if (!current || current.id !== attemptId) return exam
      const ordered = questions.flatMap((view) => {
        const result = results.get(view.question.id)
        return result ? [result] : []
      })
      return { ...exam, current: { ...current, results: ordered } }
    })
  }

  /** Once every question has a result, the attempt moves into the history. */
  private async finishIfComplete(
    setId: string,
    attemptId: string,
    questions: MockExamQuestionView[],
    results: Map<string, MockExamQuestionResult>,
  ): Promise<MockExamAttempt> {
    let out: MockExamAttempt | undefined
    await this.updateExam(setId, (exam) => {
      const current = exam.current
      if (!current || current.id !== attemptId) return exam
      const done = questions.every((view) => {
        const result = results.get(view.question.id)
        return result && result.status !== 'failed'
      })
      out = current
      if (!done) return exam
      out = { ...current, checkedAt: Date.now() }
      const rest = { ...exam }
      delete rest.current
      return { ...rest, attempts: [out, ...(exam.attempts ?? [])].slice(0, MAX_EXAM_ATTEMPTS) }
    })
    if (!out) throw new AppError(t('mockExam.noAttempt'), 'VALIDATION_ERROR')
    return out
  }

  private async requireExam(setId: string): Promise<HomeworkSet> {
    const set = await this.homework.getSet(setId)
    if (!set || !isExamSet(set)) throw new NotFoundError('HomeworkSet', setId)
    return set
  }

  private async updateExam(setId: string, fn: (exam: ExamSetInfo) => ExamSetInfo): Promise<void> {
    await this.db.transaction('rw', this.db.homeworkSets, async () => {
      const set = await this.homework.getSet(setId)
      if (!set || !isExamSet(set)) throw new NotFoundError('HomeworkSet', setId)
      await this.homework.updateSet(setId, { exam: fn(set.exam ?? {}) })
    })
  }
}
