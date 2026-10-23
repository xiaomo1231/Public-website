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
import {
  isAiMockSet,
  isExamSet,
  isPastPaperSet,
  type HomeworkQuestion,
  type HomeworkSet,
} from '@/entities/homework/types'
import { structureReport, type MockStructureReport } from '@/entities/exam/mockPaper'
import { resolveMaterialType } from '@/entities/document/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import {
  DEFAULT_EXAM_MINUTES,
  MAX_EXAM_ATTEMPTS,
  type ExamAnswerMode,
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
import {
  answerImageKey,
  type AnswerImageExtras,
  type HomeworkAnswerImage,
} from '@/entities/homework/answerImages'
import type { StoredStrokePage } from '@/entities/handwriting/strokes'
import {
  confirmableText,
  DEFAULT_HANDWRITING_RECOGNITION_MODE,
  gradedAnswerText,
  TranscriptNotConfirmedError,
  type AnswerTranscript,
  type HandwritingRecognitionMode,
} from '@/entities/handwriting/types'
import {
  attemptMode,
  canAddExamImages,
  canRecognize,
  questionsNeedingRecognition,
  unconfirmedQuestions,
} from '@/entities/exam/handwritingStage'
import type { HandwritingRecognitionService } from './handwriting/recognition'
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
  /**
   * Whose scheme `scheme` is: the professor's answer key, or — on an AI 模拟卷 —
   * the platform's own (平台拟定, never shown as the professor's).
   */
  schemeSource: 'professor' | 'platform'
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
  /** AI 模拟卷: the paper's structure report (questions it is missing). */
  aiMock?: MockStructureReport
}

export interface MockExamCheckProgress {
  completed: number
  total: number
}

/** The current attempt's handwriting, per question in paper order. */
export interface MockExamHandwriting {
  attemptId?: string
  items: Array<{
    questionId: string
    images: HomeworkAnswerImage[]
    /** '' when the question has no handwriting in this attempt. */
    imageKey: string
    transcript?: AnswerTranscript
  }>
}

/** Answer-image store scoped to one mock exam attempt (see `MockExamService.imageStore`). */
export interface ExamImageStore {
  list(questionId: string): Promise<HomeworkAnswerImage[]>
  add(
    questionId: string,
    file: Blob,
    source: HomeworkAnswerImage['source'],
    extras?: Omit<AnswerImageExtras, 'examAttemptId'>,
  ): Promise<HomeworkAnswerImage>
  remove(questionId: string, imageId: string): Promise<void>
  move(questionId: string, imageId: string, delta: number): Promise<void>
}

export class MockExamService {
  private db: AppDatabase
  private homework: HomeworkRepository
  private service: HomeworkService
  private recognition: HandwritingRecognitionService | null

  constructor(deps: {
    homework: HomeworkService
    db?: AppDatabase
    /** 手写识别 (after submitting only). Without it handwriting is typed by the student. */
    recognition?: HandwritingRecognitionService | null
  }) {
    this.db = deps.db ?? getDb()
    this.homework = new HomeworkRepository(this.db)
    this.service = deps.homework
    this.recognition = deps.recognition ?? null
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
    const aiMock = isAiMockSet(set)
    const views = questions.map((question) => {
      const page = question.sourceRefs.find(
        (ref) => ref.documentId === set.documentId && ref.page,
      )?.page
      return {
        question,
        marks: parseQuestionMarks(question.prompt),
        // An AI 模拟卷 has no answer key: its scheme is the platform's.
        scheme: aiMock
          ? (question.practice?.markingScheme ?? [])
          : question.answerStatus === 'matched'
            ? markingSchemeLines(question.answerText)
            : [],
        schemeSource: aiMock ? ('platform' as const) : ('professor' as const),
        ...(page ? { page } : {}),
      }
    })
    const detected = set.exam?.detectedMinutes
    const mockInfo = set.exam?.aiMock
    return {
      ...(aiMock && mockInfo ? { aiMock: structureReport(mockInfo) } : {}),
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

  /**
   * Start (or return the unfinished) attempt. Minutes are clamped to 5–600.
   * `mode` is how the paper is answered (在网站上作答 / 纸上作答 / 平板手写).
   */
  async start(
    setId: string,
    minutes: number,
    mode: ExamAnswerMode = 'online',
  ): Promise<MockExamAttempt> {
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
      mode,
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

  // --- Handwriting (纸上作答 / 平板手写 / pages added online) ----------------

  /** The current attempt's handwriting per question, with its transcript. */
  async handwriting(setId: string): Promise<MockExamHandwriting> {
    const state = await this.state(setId)
    const attempt = state.set.exam?.current
    if (!attempt) return { items: [] }
    const images = this.service.answerImageService()
    const items: MockExamHandwriting['items'] = []
    for (const view of state.questions) {
      const rows = await images.list(view.question.id, attempt.id)
      const transcript = attempt.transcripts?.[view.question.id]
      items.push({
        questionId: view.question.id,
        images: rows,
        imageKey: answerImageKey(rows),
        ...(transcript ? { transcript } : {}),
      })
    }
    return { attemptId: attempt.id, items }
  }

  /**
   * The image store of the current attempt, for the answer-image widget:
   * images are tagged with the attempt, and may be changed only while
   * `canAddExamImages` allows (writing; 纸上作答 also until uploads are done).
   */
  imageStore(setId: string): ExamImageStore {
    const images = this.service.answerImageService()
    const guard = async (): Promise<MockExamAttempt> => {
      const set = await this.requireExam(setId)
      const current = set.exam?.current
      if (!current || !canAddExamImages(current))
        throw new AppError(t('handwritingRecognition.imagesLocked'), 'VALIDATION_ERROR')
      return current
    }
    return {
      list: async (questionId) => {
        const current = (await this.requireExam(setId)).exam?.current
        return current ? images.list(questionId, current.id) : []
      },
      add: async (questionId, file, source, extras = {}) => {
        const current = await guard()
        return images.add(questionId, file, source, { ...extras, examAttemptId: current.id })
      },
      remove: async (questionId, imageId) => {
        const current = await guard()
        const row = (await images.list(questionId, current.id)).find((item) => item.id === imageId)
        if (row) await images.remove(questionId, imageId)
      },
      move: async (questionId, imageId, delta) => {
        const current = await guard()
        await images.move(questionId, imageId, delta, current.id)
      },
    }
  }

  /** 平板手写: save one question's writing area (rendered pages + strokes) while writing. */
  async saveWritingArea(
    setId: string,
    questionId: string,
    pages: ReadonlyArray<{ image: Blob; strokes: StoredStrokePage; page: number }>,
  ): Promise<void> {
    const set = await this.requireExam(setId)
    const current = set.exam?.current
    if (!current || current.submittedAt || attemptMode(current) !== 'tablet')
      throw new AppError(t('handwritingRecognition.imagesLocked'), 'VALIDATION_ERROR')
    await this.service.answerImageService().replaceWritingArea(questionId, current.id, pages)
  }

  /** 纸上作答: all photos are uploaded and assigned; recognition may start. */
  async finishUploads(setId: string): Promise<void> {
    await this.updateExam(setId, (exam) => {
      const current = exam.current
      if (!current?.submittedAt || attemptMode(current) !== 'paper' || current.uploadsDoneAt)
        return exam
      return { ...exam, current: { ...current, uploadsDoneAt: Date.now() } }
    })
  }

  /**
   * Recognise the handwriting of the submitted attempt, one question at a
   * time (only questions whose transcript is missing, failed or stale, or
   * `questionIds` when given — 重新识别). Never before submitting: nothing
   * reads the handwriting while the timer runs. Each result is a draft the
   * student must confirm; recognition never grades.
   */
  async recognize(
    setId: string,
    language: 'zh' | 'en',
    options: {
      mode?: HandwritingRecognitionMode
      control?: GenerationControl
      questionIds?: readonly string[]
      onProgress?: (p: MockExamCheckProgress) => void
    } = {},
  ): Promise<void> {
    if (!this.recognition)
      throw new AppError(t('handwritingRecognition.noService'), 'HANDWRITING_UNAVAILABLE')
    const control = resolveControl(options.control)
    const state = await this.state(setId)
    const attempt = state.set.exam?.current
    if (!attempt || !canRecognize(attempt))
      throw new AppError(t('handwritingRecognition.notSubmitted'), 'VALIDATION_ERROR')
    const handwriting = await this.handwriting(setId)
    const keys = Object.fromEntries(
      handwriting.items.map((item) => [item.questionId, item.imageKey]),
    )
    const wanted = options.questionIds
      ? options.questionIds.filter((id) => keys[id])
      : questionsNeedingRecognition(keys, attempt.transcripts)
    const prompts = new Map(state.questions.map((view) => [view.question.id, view.question.prompt]))
    let completed = 0
    for (const questionId of wanted) {
      options.onProgress?.({ completed, total: wanted.length })
      if (!control.shouldContinue()) break
      const item = handwriting.items.find((entry) => entry.questionId === questionId)
      if (!item) continue
      let transcript: AnswerTranscript
      try {
        const outcome = await this.recognition.recognize(
          {
            images: item.images.map((image) => ({
              mimeType: image.mimeType,
              bytes: image.bytes,
              ...(image.strokes ? { strokes: image.strokes } : {}),
            })),
            ...(prompts.get(questionId) ? { question: prompts.get(questionId)! } : {}),
            language,
          },
          options.mode ?? DEFAULT_HANDWRITING_RECOGNITION_MODE,
          { signal: control.signal },
        )
        const { result } = outcome
        transcript =
          result.provider === 'typed'
            ? {
                questionId,
                imageKey: item.imageKey,
                status: 'unavailable',
                provider: 'typed',
                note: t(
                  `handwritingRecognition.typedReason.${outcome.typedReason ?? 'none-available'}`,
                ),
                recognizedAt: Date.now(),
              }
            : {
                questionId,
                imageKey: item.imageKey,
                status: 'recognized',
                provider: result.provider,
                recognizedText: result.text,
                regions: result.regions,
                ...(result.model ? { model: result.model } : {}),
                ...(result.blank ? { note: t('handwritingRecognition.blank') } : {}),
                recognizedAt: Date.now(),
              }
      } catch (err) {
        if (isAbortError(err, control.signal)) break
        logger.warn('Mock exam handwriting recognition failed', { questionId })
        transcript = {
          questionId,
          imageKey: item.imageKey,
          status: 'failed',
          note: friendlyAIError(err),
          recognizedAt: Date.now(),
        }
      }
      completed += 1
      await this.updateExam(setId, (exam) => {
        const current = exam.current
        if (!current || current.id !== attempt.id) return exam
        return {
          ...exam,
          current: {
            ...current,
            transcripts: { ...current.transcripts, [questionId]: transcript },
          },
        }
      })
    }
    options.onProgress?.({ completed, total: wanted.length })
  }

  /**
   * The student confirms (or types) the transcript of one question's
   * handwriting, for exactly the images it was made from. Text with `[?]`
   * marks cannot be confirmed: every unclear part must be resolved by the
   * student, never by the grader.
   */
  async confirmTranscript(setId: string, questionId: string, text: string): Promise<void> {
    const state = await this.state(setId)
    const attempt = state.set.exam?.current
    if (!attempt || !canRecognize(attempt))
      throw new AppError(t('handwritingRecognition.notSubmitted'), 'VALIDATION_ERROR')
    if (!confirmableText(text).ok)
      throw new AppError(t('handwritingRecognition.resolveUnclear'), 'VALIDATION_ERROR')
    const images = await this.service.answerImageService().list(questionId, attempt.id)
    if (images.length === 0)
      throw new AppError(t('handwritingRecognition.noImages'), 'VALIDATION_ERROR')
    const imageKey = answerImageKey(images)
    await this.updateExam(setId, (exam) => {
      const current = exam.current
      if (!current || current.id !== attempt.id) return exam
      const previous = current.transcripts?.[questionId]
      const base: AnswerTranscript =
        previous && previous.imageKey === imageKey
          ? previous
          : { questionId, imageKey, status: 'unavailable', provider: 'typed' }
      const confirmed: AnswerTranscript = {
        ...base,
        confirmedText: text.trim(),
        confirmedAt: Date.now(),
        edited: base.recognizedText === undefined || base.recognizedText.trim() !== text.trim(),
      }
      return {
        ...exam,
        current: { ...current, transcripts: { ...current.transcripts, [questionId]: confirmed } },
      }
    })
  }

  /** Give up the unsubmitted attempt (nothing is checked or recorded). */
  async discard(setId: string): Promise<void> {
    // The abandoned attempt's handwriting goes with it.
    const current = (await this.requireExam(setId)).exam?.current
    if (current && !current.submittedAt) {
      const images = this.service.answerImageService()
      for (const question of await this.homework.listQuestions(setId))
        for (const image of await images.list(question.id, current.id))
          await images.remove(question.id, image.id)
    }
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
    // Handwriting is graded only as the transcript the student confirmed.
    const imageKeys = await this.imageKeys(attempt, state.questions)
    const pending = unconfirmedQuestions(imageKeys, attempt.transcripts)
    if (pending.length > 0)
      throw new AppError(
        t('handwritingRecognition.confirmFirst', { count: pending.length }),
        'TRANSCRIPT_UNCONFIRMED',
        new TranscriptNotConfirmedError(pending),
      )
    const topics = await new CourseAnalysisRepository(this.db).listTopics(state.set.projectId)
    const paper = await this.db.documents.get(state.set.documentId)
    const results = new Map((attempt.results ?? []).map((item) => [item.questionId, item]))
    const graded: Record<string, string> = { ...attempt.gradedAnswers }
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
      const answer = gradedAnswerText({
        questionId: question.id,
        typed: attempt.answers[question.id] ?? '',
        imageKey: imageKeys[question.id] ?? '',
        ...(attempt.transcripts?.[question.id]
          ? { transcript: attempt.transcripts[question.id] }
          : {}),
      })
      graded[question.id] = answer
      let result: MockExamQuestionResult
      if (!answer) {
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
          // Text only: images never reach the grader (see the transcript above).
          const check = await this.service.checkAnswer(question.id, answer, language, {
            signal: control.signal,
            ignoreImages: true,
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
      await this.saveResults(setId, attempt.id, state.questions, results, graded)
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
  async analysis(
    projectId: string,
    options: { setIds?: string[] } = {},
  ): Promise<PastExamAnalysis> {
    // Uploaded past papers only: an AI 模拟卷 says nothing about the professor.
    // An exam's workspace may narrow it to the papers picked for that exam.
    const only = options.setIds?.length ? new Set(options.setIds) : null
    const sets = (await this.listExamSets(projectId)).filter(
      (set) => set.status === 'ready' && isPastPaperSet(set) && (!only || only.has(set.id)),
    )
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
    // Questions with locally graded parts (AI 模拟卷) were recorded by the
    // answer check itself (`recordPracticeCheck`, origin mock_exam).
    if (question.practice) return
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
    graded: Record<string, string>,
  ): Promise<void> {
    await this.updateExam(setId, (exam) => {
      const current = exam.current
      if (!current || current.id !== attemptId) return exam
      const ordered = questions.flatMap((view) => {
        const result = results.get(view.question.id)
        return result ? [result] : []
      })
      return { ...exam, current: { ...current, results: ordered, gradedAnswers: graded } }
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

  /** Question id → `answerImageKey` of the images written in this attempt. */
  private async imageKeys(
    attempt: MockExamAttempt,
    questions: readonly MockExamQuestionView[],
  ): Promise<Record<string, string>> {
    const images = this.service.answerImageService()
    const out: Record<string, string> = {}
    for (const view of questions) {
      const key = answerImageKey(await images.list(view.question.id, attempt.id))
      if (key) out[view.question.id] = key
    }
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
