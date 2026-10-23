import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { PracticeRepository } from '@/entities/practice/repository'
import { formatRubricItem, parseRubricItems } from '@/entities/exam/marks'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import type {
  PracticeAttempt,
  PracticeQuestion,
  PracticeQuestionOption,
  PracticeSet,
  ProfessorQuestionStyleProfile,
} from '@/entities/practice/types'
import { PRACTICE_STYLE_PROMPT_VERSION, styleConfidenceFor } from '@/entities/practice/types'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import {
  buildChunkRelinkIndex,
  chunkContentFingerprint,
  relinkChunkReference,
} from '@/entities/chunk/relink'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import type { CourseContext } from '@/entities/courseContext/types'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { resolveMaterialType } from '@/entities/document/types'
import { parsePracticeQuestions } from '@/infrastructure/files/practiceExtraction'
import { compareMath, numericEquivalent } from '@/infrastructure/math/expressionEvaluator'
import { matchChunkToTopic, overlapScore } from './classProgressService'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { getUILanguage, t } from '@/i18n'
import { fnv1a } from '@/shared/lib/hash'
import { isAbortError } from '@/shared/lib/generationControl'
import { prompts } from '@/infrastructure/ai/prompts'
import type { Question, QuestionType, RubricPoint } from '@/entities/question/types'
import type { QuestionAttempt, QuestionEvaluation } from '@/entities/questionAttempt/types'
import { withLightModel, type AIService } from './aiService'
import type { MistakeService } from './mistakeService'
import type { MasteryService } from './masteryService'
import { ShortAnswerGrader, unverifiedShortAnswer } from './shortAnswerGrader'
import { loadProjectSubjectContext } from './projectSubject'
import { parseTrueFalse } from './answerEvaluationService'
import { rubricSourceOf } from '@/entities/question/origin'

/** Extraction confidence at or above this is imported without a review step. */
const AUTO_VERIFY_CONFIDENCE = 0.6

const INSTRUCTION_VERBS = [
  'find',
  'calculate',
  'compute',
  'determine',
  'evaluate',
  'solve',
  'derive',
  'show',
  'prove',
  'explain',
  'sketch',
  'simplify',
  'classify',
]

function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Textbook chunk a practice question best matches, for chapter binding. */
function bestTextbookChunk(prompt: string, textbook: DocumentChunk[]): DocumentChunk | undefined {
  let best: { chunk: DocumentChunk; score: number } | null = null
  for (const chunk of textbook) {
    const score = overlapScore(prompt, chunk.text)
    if (!best || score > best.score) best = { chunk, score }
  }
  return best && best.score > 0 ? best.chunk : undefined
}

/**
 * Render the question-style profile as prompt context.
 *
 * Only observed evidence is stated; the sample size is always included so the
 * model cannot overclaim the professor's style.
 */
export function formatQuestionStyleContext(profile: ProfessorQuestionStyleProfile): string {
  const lines: string[] = [
    `Based on ${profile.sampleSize} uploaded practice question(s) (${profile.confidence.replace('_', ' ')} evidence).`,
  ]
  const types = Object.entries(profile.questionTypeDistribution)
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ')
  if (types) lines.push(`Question types observed: ${types}.`)
  const { calculation, conceptual, mixed } = profile.calculationVsConceptual
  lines.push(`Calculation-oriented: ${calculation}, conceptual: ${conceptual}, mixed: ${mixed}.`)
  const optionCounts = Object.entries(profile.optionCountDistribution)
    .map(([count, n]) => `${count}-option: ${n}`)
    .join(', ')
  if (optionCounts) lines.push(`Option counts: ${optionCounts}.`)
  if (profile.visualQuestionCount > 0) {
    lines.push(`Questions that include a figure: ${profile.visualQuestionCount}.`)
  }
  if (profile.instructionPatterns.length > 0) {
    lines.push(`Common instructions: ${profile.instructionPatterns.join(', ')}.`)
  }
  if (profile.wordingPatterns.length > 0) {
    lines.push(`Wording: ${profile.wordingPatterns.join(', ')}.`)
  }
  if (profile.answerFormatPatterns.length > 0) {
    lines.push(`Answer format: ${profile.answerFormatPatterns.join(', ')}.`)
  }
  return lines.join('\n')
}

export interface PracticeProgress {
  total: number
  completed: number
  correct: number
  needsReview: number
}

export interface PracticeFeedback {
  /** The stored attempt, so a short-answer judgement can be disputed. */
  attemptId: string
  isCorrect?: boolean
  expectedAnswer?: string
  method: PracticeAttempt['method']
  /** Short answer: scoring points, score and evidence. */
  evaluation?: QuestionEvaluation
  /** 'professor' when the source document supplied the answer. */
  answerSource: PracticeQuestion['answerSource']
}

/**
 * Professor Practice: importing questions, answering them, and deriving the
 * professor's question style.
 *
 * The bank is a separate store from the quiz system, but grading reuses the
 * exact same math evaluator the quiz uses — there is no second grader.
 */
export class PracticeService {
  private db: AppDatabase
  private practice: PracticeRepository
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private analyses: CourseAnalysisRepository
  private contexts: CourseContextRepository
  private visuals: VisualSourceRepository

  private ai: AIService | null
  private mistakes: MistakeService | null
  private mastery: MasteryService | null

  constructor(
    deps: {
      db?: AppDatabase
      /** Needed only to grade short answers by scoring points. */
      ai?: AIService
      mistakes?: MistakeService
      mastery?: MasteryService
    } = {},
  ) {
    this.db = deps.db ?? getDb()
    this.ai = deps.ai ?? null
    this.mistakes = deps.mistakes ?? null
    this.mastery = deps.mastery ?? null
    this.practice = new PracticeRepository(this.db)
    this.documents = new DocumentRepository(this.db)
    this.chunks = new ChunkRepository(this.db)
    this.analyses = new CourseAnalysisRepository(this.db)
    this.contexts = new CourseContextRepository(this.db)
    this.visuals = new VisualSourceRepository(this.db)
  }

  /** Every practice question in a project (read-only). */
  listQuestionsByProject(projectId: string): Promise<PracticeQuestion[]> {
    return this.practice.listQuestionsByProject(projectId)
  }

  /**
   * Stage the questions whose cited textbook chunk needs re-pointing.
   *
   * **Pure with respect to storage**: it reads, computes, and returns the rows
   * that would change — it writes nothing. The caller commits them inside the
   * transaction that also writes the content they belong to, so a re-pointed
   * reference can never become visible on its own.
   *
   * Re-processing a document regenerates every chunk id, so a stored `chunkId`
   * goes stale without the question changing. Resolution order:
   *
   *   1. the chunk still exists → keep it (backfill the fingerprint);
   *   2. a live chunk has the same content fingerprint → re-point at it;
   *   3. legacy row without a fingerprint → same document + page, best text
   *      overlap;
   *   4. nothing matched → keep the old reference and flag `needsRelink`.
   *
   * A question is **never deleted**.
   */
  async planChunkRelink(projectId: string): Promise<PracticeQuestion[]> {
    const questions = await this.practice.listQuestionsByProject(projectId)
    const candidates = questions.filter((question) => question.chunkId !== undefined)
    if (candidates.length === 0) return []

    const liveChunks = await this.chunks.listByProject(projectId)
    const index = buildChunkRelinkIndex(liveChunks)
    const byDocument = new Map<string, DocumentChunk[]>()
    for (const chunk of liveChunks) {
      const list = byDocument.get(chunk.documentId) ?? []
      list.push(chunk)
      byDocument.set(chunk.documentId, list)
    }

    const staged: PracticeQuestion[] = []
    for (const question of candidates) {
      const resolved = relinkChunkReference(
        {
          chunkId: question.chunkId,
          ...(question.chunkFingerprint ? { fingerprint: question.chunkFingerprint } : {}),
        },
        index,
      )
      if (!resolved) continue

      if (!resolved.needsRelink) {
        // Either still live, or re-pointed by an identical fingerprint. Only
        // stage a write when something actually changes.
        if (
          resolved.chunkId === question.chunkId &&
          resolved.fingerprint === question.chunkFingerprint &&
          !question.needsRelink
        ) {
          continue
        }
        staged.push({
          ...question,
          chunkId: resolved.chunkId,
          ...(resolved.fingerprint ? { chunkFingerprint: resolved.fingerprint } : {}),
          ...(resolved.previousChunkId ? { previousChunkId: resolved.previousChunkId } : {}),
          needsRelink: false,
          relinkReason: undefined,
        })
        continue
      }

      // Legacy rows predate the fingerprint: fall back to same-page text
      // overlap before declaring the reference lost.
      if (!question.chunkFingerprint) {
        const pool = byDocument.get(question.documentId) ?? []
        const samePage =
          question.pageNumber !== undefined
            ? pool.filter((chunk) => chunk.pageNumber === question.pageNumber)
            : []
        const search = samePage.length > 0 ? samePage : pool
        let best: { chunk: DocumentChunk; score: number } | null = null
        for (const chunk of search) {
          const score = overlapScore(question.prompt, chunk.text)
          if (!best || score > best.score) best = { chunk, score }
        }
        if (best && best.score > 0) {
          staged.push({
            ...question,
            chunkId: best.chunk.id,
            chunkFingerprint: chunkContentFingerprint(best.chunk),
            previousChunkId: question.chunkId,
            needsRelink: false,
            relinkReason: undefined,
          })
          continue
        }
      }

      // Keep the original reference; a human can review it.
      staged.push({
        ...question,
        needsRelink: true,
        relinkReason: resolved.relinkReason ?? 'source-chunk-missing',
      })
    }

    if (staged.length > 0) {
      logger.debug('Professor practice chunk relink staged', {
        projectId,
        staged: staged.length,
        flagged: staged.filter((question) => question.needsRelink).length,
      })
    }
    return staged
  }

  listSets(projectId: string): Promise<PracticeSet[]> {
    return this.practice.listSets(projectId)
  }

  listQuestions(setId: string): Promise<PracticeQuestion[]> {
    return this.practice.listQuestionsBySet(setId)
  }

  listAttempts(setId: string): Promise<PracticeAttempt[]> {
    return this.practice.listAttemptsBySet(setId)
  }

  async updateQuestion(
    id: string,
    patch: Partial<PracticeQuestion>,
  ): Promise<PracticeQuestion | undefined> {
    return this.practice.updateQuestion(id, patch)
  }

  /**
   * Parse a professor-practice document into a question bank.
   *
   * Pages are parsed separately so each question keeps its page (and any
   * figure preserved for that page). One-off and cached — never re-run just
   * because the practice page is opened.
   */
  async importDocument(documentId: string): Promise<PracticeSet> {
    const document = await this.documents.get(documentId)
    if (resolveMaterialType(document.materialType) !== 'professor_practice') {
      throw new AppError(t('errors.notProfessorPractice'), 'NOT_PRACTICE_MATERIAL')
    }

    const chunks = await this.chunks.listByDocument(documentId)
    const topics = await this.analyses.listTopics(document.projectId)
    // Textbook chunks carry the chapter/section a question maps to.
    const textbookChunks = (await this.chunks.listByProject(document.projectId)).filter(
      (chunk) => resolveMaterialType(chunk.materialType) === 'textbook',
    )

    const byPage = new Map<number, typeof chunks>()
    for (const chunk of chunks) {
      const page = chunk.pageNumber ?? 0
      const list = byPage.get(page) ?? []
      list.push(chunk)
      byPage.set(page, list)
    }

    const now = Date.now()
    const setId = crypto.randomUUID()
    const questions: PracticeQuestion[] = []
    let order = 0

    for (const [page, pageChunks] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      const text = pageChunks.map((chunk) => chunk.text).join('\n\n')
      const { questions: parsed } = parsePracticeQuestions(text)
      const visuals = page > 0 ? await this.visuals.listByDocumentPage(documentId, page) : []

      for (const question of parsed) {
        const match = matchChunkToTopic(question.prompt, topics)
        const options = this.toOptions(question.options, question.answer)
        const structure = bestTextbookChunk(question.prompt, textbookChunks)
        questions.push({
          id: crypto.randomUUID(),
          projectId: document.projectId,
          setId,
          documentId,
          documentName: document.name,
          order: order++,
          ...(page > 0 ? { pageNumber: page } : {}),
          ...(pageChunks[0]?.id ? { chunkId: pageChunks[0].id } : {}),
          ...(question.number ? { number: question.number } : {}),
          type: question.type,
          prompt: question.prompt,
          options,
          ...(question.answer ? { expectedAnswer: question.answer } : {}),
          answerSource: question.answer ? 'professor' : 'none',
          ...(visuals[0]?.id ? { visualSourceId: visuals[0].id } : {}),
          ...(match ? { topicId: match.topicId } : {}),
          ...(structure?.chapterId ? { chapterId: structure.chapterId } : {}),
          ...(structure?.sectionId ? { sectionId: structure.sectionId } : {}),
          confidence: question.confidence,
          status: question.confidence >= AUTO_VERIFY_CONFIDENCE ? 'verified' : 'needs_review',
          createdAt: now,
        })
      }
    }

    const set: PracticeSet = {
      id: setId,
      projectId: document.projectId,
      documentId,
      documentName: document.name,
      name: document.name,
      questionCount: questions.length,
      sourceHash: fnv1a(chunks.map((chunk) => chunk.id).join('|')),
      createdAt: now,
      updatedAt: now,
    }

    await this.practice.upsertSet(set)
    await this.practice.addQuestions(questions)
    await this.refreshStyleProfile(document.projectId)

    logger.info('Professor practice imported', {
      documentId,
      questions: questions.length,
    })
    return set
  }

  /** Grade and store one attempt, reusing the quiz's math evaluator. */
  async recordAttempt(
    questionId: string,
    userAnswer: string,
    /**
     * Stops the AI work (scoring-point extraction, short-answer check). A stop
     * cancels the submission: the error is rethrown, nothing is stored.
     */
    options: { signal?: AbortSignal } = {},
  ): Promise<PracticeFeedback> {
    const question = await this.practice.getQuestion(questionId)
    if (!question) throw new AppError(t('errors.practiceQuestionNotFound'), 'NOT_FOUND')

    const previous = await this.practice.listAttemptsByQuestion(questionId)
    const graded: {
      isCorrect?: boolean
      method: PracticeAttempt['method']
      evaluation?: QuestionEvaluation
    } =
      question.type === 'short_answer'
        ? await this.gradeShortAnswer(question, userAnswer, options.signal)
        : this.grade(question, userAnswer)

    const attempt: PracticeAttempt = {
      id: crypto.randomUUID(),
      projectId: question.projectId,
      setId: question.setId,
      questionId,
      userAnswer,
      ...(graded.isCorrect !== undefined ? { isCorrect: graded.isCorrect } : {}),
      method: graded.method,
      ...(graded.evaluation ? { evaluation: graded.evaluation } : {}),
      attemptNumber: previous.length + 1,
      submittedAt: Date.now(),
    }
    await this.practice.addAttempt(attempt)
    await this.recordLearning(question, attempt)

    return {
      attemptId: attempt.id,
      ...(graded.isCorrect !== undefined ? { isCorrect: graded.isCorrect } : {}),
      ...(question.expectedAnswer ? { expectedAnswer: question.expectedAnswer } : {}),
      method: graded.method,
      ...(graded.evaluation ? { evaluation: graded.evaluation } : {}),
      answerSource: question.answerSource,
    }
  }

  /**
   * The student disputes a short-answer judgement: the attempt stays visible
   * but stops counting, and is taken back out of the mistake book and mastery.
   */
  async disputeAttempt(attemptId: string): Promise<PracticeAttempt> {
    const attempt = await this.practice.getAttempt(attemptId)
    if (!attempt) throw new AppError(t('errors.practiceQuestionNotFound'), 'NOT_FOUND')
    if (!attempt.evaluation || attempt.evaluation.disputed) return attempt
    const updated = await this.practice.updateAttempt({
      ...attempt,
      evaluation: { ...attempt.evaluation, disputed: true },
    })
    const question = await this.practice.getQuestion(attempt.questionId)
    if (question) {
      await this.mistakes?.removeAttempt(attempt.projectId, question.id, attempt.id)
      if (this.mastery) {
        const knowledgePoint = await this.knowledgePointFor(question)
        // Quiz work on the same point counts too; a rebuild replaces the row.
        const history = [
          ...(await this.practiceHistory(question.projectId, knowledgePoint)),
          ...(await new QuestionAttemptRepository(this.db).listByKnowledgePoint(
            question.projectId,
            knowledgePoint,
          )),
        ]
        await this.mastery.rebuild(question.projectId, history)
      }
    }
    return updated
  }

  /**
   * Short answers are graded by scoring points split from the professor's
   * answer. Without a reference answer there is nothing to grade against, and
   * without an AI the answer is shown with its points but not scored.
   */
  private async gradeShortAnswer(
    question: PracticeQuestion,
    userAnswer: string,
    signal?: AbortSignal,
  ): Promise<{
    isCorrect?: boolean
    method: PracticeAttempt['method']
    evaluation?: QuestionEvaluation
  }> {
    if (!question.expectedAnswer?.trim()) return { method: 'none' }
    if (!this.ai) {
      return {
        method: 'none',
        evaluation: unverifiedShortAnswer(
          this.asQuizQuestion(question, question.rubric),
          userAnswer.trim(),
          t('shortAnswer.needsAi'),
        ),
      }
    }
    const rubric = await this.ensureRubric(question, signal)
    const subject = await loadProjectSubjectContext(question.projectId, this.db)
    const evaluation = await new ShortAnswerGrader(this.ai).grade(
      this.asQuizQuestion(question, rubric),
      userAnswer.trim(),
      subject,
      signal ? { signal } : {},
    )
    return {
      ...(evaluation.isCorrect !== null ? { isCorrect: evaluation.isCorrect } : {}),
      method: evaluation.method === 'rubric_ai' ? 'rubric' : 'none',
      evaluation,
    }
  }

  /** Split the professor's answer into scoring points once, and cache them. */
  private async ensureRubric(
    question: PracticeQuestion,
    signal?: AbortSignal,
  ): Promise<RubricPoint[] | undefined> {
    const answer = question.expectedAnswer?.trim()
    // A professor rubric box printed with the answer ("2 pts: …") is the
    // professor's own scoring points: read locally, no AI split needed.
    const box = parseRubricItems(answer)
    if (answer && box.length >= 2) {
      const boxHash = fnv1a(`rubric-box|${answer}`)
      if (question.rubric?.length && question.rubricAnswerHash === boxHash) return question.rubric
      const rubric = box.map((item, index) => ({
        id: `p${index + 1}`,
        text: formatRubricItem(item),
      }))
      await this.practice.updateQuestion(question.id, {
        rubric,
        rubricAnswerHash: boxHash,
        rubricSource: 'professor',
      })
      return rubric
    }
    if (!answer || !this.ai) return question.rubric
    const hash = fnv1a(`${prompts.rubricExtractor.VERSION}|${answer}`)
    if (question.rubric?.length && question.rubricAnswerHash === hash) return question.rubric
    try {
      const { data } = await withLightModel(this.ai).chatJSON<unknown>(
        [
          { role: 'system', content: prompts.rubricExtractor.buildSystemPrompt() },
          {
            role: 'user',
            content: prompts.rubricExtractor.buildUserPrompt({
              question: question.prompt,
              referenceAnswer: answer,
              language: getUILanguage() === 'zh-CN' ? 'zh' : 'en',
            }),
          },
        ],
        signal ? { signal } : undefined,
      )
      const points = prompts.rubricExtractor.normalizeRubricPoints(data)
      if (!points) return question.rubric
      const rubric = points.map((text, index) => ({ id: `p${index + 1}`, text }))
      // Split from the professor's own reference answer: the professor's standard.
      await this.practice.updateQuestion(question.id, {
        rubric,
        rubricAnswerHash: hash,
        rubricSource: 'professor',
      })
      return rubric
    } catch (err) {
      // Stopped: nothing is stored, the submission is cancelled.
      if (isAbortError(err, signal)) throw err
      logger.warn('Could not split the reference answer into scoring points', {
        questionId: question.id,
        error: (err as Error)?.message,
      })
      return question.rubric
    }
  }

  /** A practice question in the shape the quiz grader / mistake book expect. */
  private asQuizQuestion(question: PracticeQuestion, rubric?: RubricPoint[]): Question {
    return {
      id: question.id,
      projectId: question.projectId,
      ...(question.topicId ? { topicId: question.topicId } : {}),
      knowledgePoint: question.documentName,
      type: PRACTICE_TO_QUIZ_TYPE[question.type] ?? 'short_answer',
      difficulty: 'basic',
      prompt: question.prompt,
      ...(question.options.length > 0
        ? {
            options: question.options.map((option, index) => ({
              id: `opt-${index + 1}`,
              label: option.label,
              isCorrect: false,
            })),
          }
        : {}),
      correctAnswer: question.expectedAnswer ?? '',
      ...(rubric?.length
        ? { rubric, rubricSource: rubricSourceOf(question.rubricSource, 'professor') }
        : {}),
      ...(question.answerExplanation ? { solution: question.answerExplanation } : {}),
      hints: [],
      sourceRefs: [],
      promptVersion: 'practice',
      createdAt: question.createdAt,
    }
  }

  private async knowledgePointFor(question: PracticeQuestion): Promise<string> {
    const topic = question.topicId ? await this.analyses.getTopic(question.topicId) : undefined
    return topic?.name ?? question.documentName
  }

  /**
   * Graded practice work counts like quiz work: a wrong (or not fully
   * covered) answer goes to the mistake book, and every graded answer
   * updates mastery. Ungraded answers change neither.
   */
  private async recordLearning(
    question: PracticeQuestion,
    attempt: PracticeAttempt,
  ): Promise<void> {
    if (attempt.isCorrect === undefined || (!this.mistakes && !this.mastery)) return
    const knowledgePoint = await this.knowledgePointFor(question)
    const quizQuestion = { ...this.asQuizQuestion(question, question.rubric), knowledgePoint }
    const asAttempt = practiceToQuizAttempt(attempt, quizQuestion)
    try {
      if (this.mistakes) await this.mistakes.recordFromAttempt(asAttempt, quizQuestion)
      if (this.mastery) await this.mastery.record(asAttempt)
    } catch (err) {
      logger.warn('Could not record practice learning progress', {
        questionId: question.id,
        error: (err as Error)?.message,
      })
    }
  }

  /** Practice attempts on one knowledge point, as quiz attempts (for a mastery rebuild). */
  async practiceHistory(projectId: string, knowledgePoint: string): Promise<QuestionAttempt[]> {
    const questions = await this.practice.listQuestionsByProject(projectId)
    // Topic names read once, not one lookup per practice question.
    const topicNames = new Map(
      (await this.analyses.listTopics(projectId)).map((topic) => [topic.id, topic.name]),
    )
    const history: QuestionAttempt[] = []
    for (const question of questions) {
      const point =
        (question.topicId ? topicNames.get(question.topicId) : undefined) ?? question.documentName
      if (point !== knowledgePoint) continue
      const quizQuestion = { ...this.asQuizQuestion(question, question.rubric), knowledgePoint }
      for (const attempt of await this.practice.listAttemptsByQuestion(question.id)) {
        if (attempt.isCorrect === undefined) continue
        history.push(practiceToQuizAttempt(attempt, quizQuestion))
      }
    }
    return history
  }

  async progress(setId: string): Promise<PracticeProgress> {
    const questions = await this.practice.listQuestionsBySet(setId)
    const attempts = await this.practice.listAttemptsBySet(setId)
    // Completed = answered at all. Right / wrong comes from the latest graded,
    // undisputed answer only: an ungraded answer (no key, subjective) or a
    // disputed judgement says nothing about correctness.
    const answered = new Set<string>()
    const graded = new Map<string, boolean>()
    for (const attempt of attempts) {
      answered.add(attempt.questionId)
      if (attempt.evaluation?.disputed || attempt.isCorrect === undefined) continue
      graded.set(attempt.questionId, attempt.isCorrect)
    }
    let correct = 0
    let needsReview = 0
    for (const isCorrect of graded.values()) {
      if (isCorrect) correct++
      else needsReview++
    }
    return { total: questions.length, completed: answered.size, correct, needsReview }
  }

  /**
   * Recompute the professor's question-style profile from the imported
   * questions. Every figure is a count over real questions, and `sampleSize`
   * caps how confidently it may be phrased.
   */
  async refreshStyleProfile(projectId: string): Promise<ProfessorQuestionStyleProfile | undefined> {
    const questions = await this.practice.listQuestionsByProject(projectId)
    if (questions.length === 0) return undefined

    const topics = await this.analyses.listTopics(projectId)
    const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]))

    const typeDistribution: ProfessorQuestionStyleProfile['questionTypeDistribution'] = {}
    const optionCountDistribution: Record<string, number> = {}
    const instructionCounts = new Map<string, number>()
    const topicCounts = new Map<string, number>()
    let visualQuestionCount = 0
    let calculation = 0
    let conceptual = 0
    let totalLength = 0

    for (const question of questions) {
      typeDistribution[question.type] = (typeDistribution[question.type] ?? 0) + 1
      if (question.options.length > 0) {
        const key = String(question.options.length)
        optionCountDistribution[key] = (optionCountDistribution[key] ?? 0) + 1
      }
      if (question.visualSourceId) visualQuestionCount++
      if (question.type === 'numeric' || question.type === 'math_expr') calculation++
      else if (
        question.type === 'true_false' ||
        /\bexplain\b|\bwhy\b|concept/i.test(question.prompt)
      ) {
        conceptual++
      }
      if (question.topicId)
        topicCounts.set(question.topicId, (topicCounts.get(question.topicId) ?? 0) + 1)

      totalLength += question.prompt.length
      const lower = question.prompt.toLowerCase()
      for (const verb of INSTRUCTION_VERBS) {
        if (new RegExp(`\\b${verb}\\b`).test(lower)) {
          instructionCounts.set(verb, (instructionCounts.get(verb) ?? 0) + 1)
        }
      }
    }

    const mixed = questions.length - calculation - conceptual
    const medianLength = Math.round(totalLength / questions.length)

    const profile: ProfessorQuestionStyleProfile = {
      sampleSize: questions.length,
      confidence: styleConfidenceFor(questions.length),
      questionTypeDistribution: typeDistribution,
      optionCountDistribution,
      visualQuestionCount,
      calculationVsConceptual: { calculation, conceptual, mixed },
      wordingPatterns: [
        medianLength < 120 ? 'concise problem statements' : 'longer, multi-sentence prompts',
      ],
      instructionPatterns: [...instructionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([verb, count]) => `${verb} (${count})`),
      answerFormatPatterns: [
        ...(calculation > 0 ? ['exact calculated answers'] : []),
        ...(Object.keys(optionCountDistribution).length > 0 ? ['multiple-choice letters'] : []),
      ],
      topicDistribution: [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([topicId, count]) => ({
          topicId,
          ...(topicNames.get(topicId) ? { topicName: topicNames.get(topicId)! } : {}),
          count,
        })),
      generatedAt: Date.now(),
      promptVersion: PRACTICE_STYLE_PROMPT_VERSION,
    }

    const existing = await this.contexts.get(projectId)
    const base: CourseContext = existing ?? {
      id: projectId,
      projectId,
      noteLinks: [],
      lectureLinks: [],
      sourceHash: '',
      updatedAt: Date.now(),
    }
    await this.contexts.upsert({ ...base, questionStyleProfile: profile, updatedAt: Date.now() })

    return profile
  }

  private toOptions(labels: string[], answer: string | undefined): PracticeQuestionOption[] {
    const answerLetter =
      answer && /^[A-Ea-e]$/.test(answer.trim()) ? answer.trim().toUpperCase() : undefined
    return labels.map((label, index) => {
      const letter = String.fromCharCode(65 + index)
      return {
        id: `opt-${index + 1}`,
        label,
        isCorrect: answerLetter !== undefined && answerLetter === letter,
      }
    })
  }

  private grade(
    question: PracticeQuestion,
    userAnswer: string,
  ): { isCorrect?: boolean; method: PracticeAttempt['method'] } {
    const expected = question.expectedAnswer
    if (!expected) return { method: 'none' }

    switch (question.type) {
      case 'true_false': {
        // The key may say 正确 / 对 / T while the options read True / False
        // (or there are no options at all): compare the truth values.
        const expectedTruth = this.truthOf(question, expected)
        const givenTruth = this.truthOf(question, userAnswer)
        if (expectedTruth !== null && givenTruth !== null) {
          return { isCorrect: expectedTruth === givenTruth, method: 'exact' }
        }
        const expectedLetter = this.resolveChoiceLabel(question, expected)
        return {
          isCorrect: normalizeAnswer(userAnswer) === normalizeAnswer(expectedLetter),
          method: 'exact',
        }
      }
      case 'single_choice': {
        const expectedLetter = this.resolveChoiceLabel(question, expected)
        return {
          isCorrect: normalizeAnswer(userAnswer) === normalizeAnswer(expectedLetter),
          method: 'exact',
        }
      }
      case 'numeric': {
        const result = numericEquivalent(userAnswer, expected)
        return result === null ? { method: 'none' } : { isCorrect: result, method: 'numeric' }
      }
      case 'math_expr': {
        const comparison = compareMath(userAnswer, expected)
        return comparison.equivalent === null
          ? { method: 'none' }
          : { isCorrect: comparison.equivalent, method: 'symbolic' }
      }
      default:
        // Subjective / unsupported: never auto-grade.
        return { method: 'none' }
    }
  }

  /**
   * A true/false answer as a truth value: an option letter is read through
   * its label (`A` → "True"), anything else directly (`正确`, `T`, `false`).
   */
  private truthOf(question: PracticeQuestion, value: string): boolean | null {
    const trimmed = value.trim()
    if (/^[A-Ea-e]$/.test(trimmed) && question.options.length > 0) {
      const option = question.options[trimmed.toUpperCase().charCodeAt(0) - 65]
      return option ? parseTrueFalse(option.label) : null
    }
    return parseTrueFalse(trimmed)
  }

  /** An answer key may be a letter (`B`) or the option text itself. */
  private resolveChoiceLabel(question: PracticeQuestion, expected: string): string {
    const trimmed = expected.trim()
    if (/^[A-Ea-e]$/.test(trimmed)) return trimmed.toUpperCase()
    const index = question.options.findIndex(
      (option) => normalizeAnswer(option.label) === normalizeAnswer(trimmed),
    )
    return index >= 0 ? String.fromCharCode(65 + index) : trimmed
  }
}

const PRACTICE_TO_QUIZ_TYPE: Partial<Record<PracticeQuestion['type'], QuestionType>> = {
  single_choice: 'multiple_choice',
  true_false: 'true_false',
  numeric: 'numeric',
  math_expr: 'math_expr',
  short_answer: 'short_answer',
}

/** A practice attempt in the quiz-attempt shape used by mastery and mistakes. */
function practiceToQuizAttempt(attempt: PracticeAttempt, question: Question): QuestionAttempt {
  const evaluation: QuestionEvaluation = attempt.evaluation ?? {
    isCorrect: attempt.isCorrect ?? null,
    method:
      attempt.method === 'numeric'
        ? 'numeric'
        : attempt.method === 'symbolic'
          ? 'math_equivalent'
          : 'exact',
    confidence: 1,
    ...(question.correctAnswer ? { expected: question.correctAnswer } : {}),
  }
  return {
    id: attempt.id,
    projectId: attempt.projectId,
    questionId: question.id,
    ...(question.topicId ? { topicId: question.topicId } : {}),
    knowledgePoint: question.knowledgePoint,
    questionType: question.type,
    difficulty: question.difficulty,
    userAnswer: attempt.userAnswer,
    evaluation,
    hintsUsed: 0,
    createdAt: attempt.submittedAt,
  }
}
