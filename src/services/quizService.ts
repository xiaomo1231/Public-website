import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { QUESTION_TYPES, type Question, type QuestionType } from '@/entities/question/types'
import type { QuestionAttempt, QuestionEvaluation } from '@/entities/questionAttempt/types'
import type {
  Quiz,
  QuizConfig,
  QuizDifficulty,
  QuizKnowledgeStat,
  QuizScore,
} from '@/entities/quiz/types'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import { prompts } from '@/infrastructure/ai/prompts'
import type { QuizGenerationOutput, GeneratedQuizQuestion } from '@/infrastructure/ai/prompts/quiz-generator/v1'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { AIService } from './aiService'
import { evaluateDeterministic } from './answerEvaluationService'
import { decideNextDifficulty, nextStreaks, DEFAULT_DIFFICULTY, DIFFICULTY_ORDER, stepDifficulty } from './adaptiveDifficulty'
import { MasteryService } from './masteryService'
import type { MistakeService } from './mistakeService'
import type { ProjectService } from './projectService'
import { collectSourceSnippets } from './sourceContext'
import { logger } from '@/infrastructure/logger/logger'
import { AppError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

export interface QuizServiceDeps {
  ai: AIService
  db?: AppDatabase
  questions?: QuestionRepository
  attempts?: QuestionAttemptRepository
  quizzes?: QuizRepository
  analyses?: CourseAnalysisRepository
  chunks?: ChunkRepository
  mastery?: MasteryService
  /** When provided, wrong answers are automatically added to the mistake book. */
  mistakes?: MistakeService
  /** When provided, quiz generation verifies the project exists. */
  projects?: ProjectService
}

export interface GenerateQuizOptions {
  onProgress?: (stage: string, progress: number) => void
  signal?: AbortSignal
}

export interface SubmitAnswerResult {
  attempt: QuestionAttempt
  evaluation: QuestionEvaluation
  nextDifficulty: DifficultyLevel
  difficultyReason: string
  isLastQuestion: boolean
}

export type MoreQuestionsMode = 'same_topic' | 'similar' | 'harder' | 'easier' | 'weakness'

const MAX_GENERATION_ATTEMPTS = 2

/** Used when the model omits `type` entirely. */
const DEFAULT_QUESTION_TYPE: QuestionType = 'multiple_choice'

/**
 * Coerce the model's option array into `{ label, isCorrect }` entries.
 *
 * Returns `null` when the set is unusable: not an array, a non-object entry,
 * an option whose `label` is missing/blank, fewer than two options, or a
 * number of `isCorrect` options other than exactly one.
 *
 * This is what prevents the reported bug — a multiple-choice question whose
 * options rendered as "A. B. C. D." with no content, because blank labels
 * were accepted and stored.
 */
function normalizeChoiceOptions(
  value: unknown,
): Array<{ label: string; isCorrect: boolean }> | null {
  if (!Array.isArray(value)) return null
  const options: Array<{ label: string; isCorrect: boolean }> = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const label = (raw as { label?: unknown }).label
    if (typeof label !== 'string') return null
    const trimmed = label.trim()
    if (!trimmed) return null
    options.push({
      label: trimmed,
      isCorrect: (raw as { isCorrect?: unknown }).isCorrect === true,
    })
  }
  if (options.length < 2) return null
  if (options.filter((o) => o.isCorrect).length !== 1) return null
  return options
}

export class QuizService {
  private db: AppDatabase
  private questions: QuestionRepository
  private attempts: QuestionAttemptRepository
  private quizzes: QuizRepository
  private analyses: CourseAnalysisRepository
  private chunks: ChunkRepository
  private mastery: MasteryService
  private mistakes: MistakeService | null
  private projects: ProjectService | null
  private ai: AIService

  constructor(deps: QuizServiceDeps) {
    this.db = deps.db ?? getDb()
    this.questions = deps.questions ?? new QuestionRepository(this.db)
    this.attempts = deps.attempts ?? new QuestionAttemptRepository(this.db)
    this.quizzes = deps.quizzes ?? new QuizRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.mastery = deps.mastery ?? new MasteryService(this.db)
    this.mistakes = deps.mistakes ?? null
    this.projects = deps.projects ?? null
    this.ai = deps.ai
  }

  async getQuiz(id: string): Promise<Quiz> {
    const quiz = await this.quizzes.get(id)
    if (!quiz) throw new AppError(t('errors.quizNotFound'), 'NOT_FOUND')
    return quiz
  }

  async listQuizzes(projectId: string): Promise<Quiz[]> {
    return this.quizzes.listByProject(projectId)
  }

  async getQuestions(quizId: string): Promise<Question[]> {
    const quiz = await this.getQuiz(quizId)
    return this.questions.listByIds(quiz.questionIds)
  }

  /**
   * Build an adaptive difficulty plan: starts at the configured difficulty
   * (or `basic` for adaptive mode) and escalates as the plan progresses.
   */
  buildDifficultyPlan(config: QuizConfig): DifficultyLevel[] {
    const base: DifficultyLevel =
      config.difficulty === 'adaptive' ? DEFAULT_DIFFICULTY : config.difficulty
    const plan: DifficultyLevel[] = []
    let current = base
    for (let i = 0; i < config.count; i++) {
      plan.push(current)
      if (config.difficulty === 'adaptive') {
        // Gentle ramp: every 3 questions bump one level until `advanced`.
        if ((i + 1) % 3 === 0 && DIFFICULTY_ORDER.indexOf(current) < DIFFICULTY_ORDER.indexOf('advanced')) {
          current = stepDifficulty(current, +1)
        }
      }
    }
    return plan
  }

  buildTypePlan(config: QuizConfig, count: number): QuestionType[] {
    const types = config.types.length > 0 ? config.types : [DEFAULT_QUESTION_TYPE]
    const plan: QuestionType[] = []
    for (let i = 0; i < count; i++) plan.push(types[i % types.length]!)
    return plan
  }

  /** Generate a new quiz from the project's course analysis. */
  async generateQuiz(
    projectId: string,
    config: QuizConfig,
    options: GenerateQuizOptions = {},
  ): Promise<Quiz> {
    // Verify the project exists before touching any project-scoped data, so an
    // unknown id fails as "not found" rather than as a misleading domain error.
    if (this.projects) await this.projects.get(projectId)

    const analysis = await this.analyses.getByProject(projectId)
    if (!analysis || analysis.status !== 'ready') {
      throw new AppError(t('errors.analysisMissing'), 'NO_ANALYSIS')
    }
    if (config.count < 1 || config.count > 30) {
      throw new AppError(t('errors.questionCountRange'), 'INVALID_COUNT')
    }

    const topic = config.topicId ? await this.analyses.getTopic(config.topicId) : undefined
    const topicName = topic?.name ?? config.topicName ?? t('quiz.mixedReviewName')
    const topicDescription = topic?.description ?? t('quiz.topicDescriptionMixed')
    const knowledgePoints = await this.resolveKnowledgePoints(projectId, config, topic?.name)

    const difficultyPlan = this.buildDifficultyPlan(config)
    const typePlan = this.buildTypePlan(config, config.count)
    const plan = difficultyPlan.map((difficulty, i) => ({ difficulty, type: typePlan[i]! }))

    const quiz: Quiz = {
      id: crypto.randomUUID(),
      projectId,
      title: t('quiz.topicTitle', { topic: topicName, count: config.count }),
      config,
      questionIds: [],
      status: 'generating',
      difficultyPlan,
      startedAt: Date.now(),
      promptVersion: prompts.quizGenerator.VERSION,
    }
    await this.quizzes.upsert(quiz)

    try {
      options.onProgress?.('collecting', 10)
      const sources = await collectSourceSnippets({
        documentIds: analysis.documentIds,
        chunks: this.chunks,
        ...(topic ? { topicName: topic.name } : {}),
        limit: 8,
        ...(knowledgePoints[0] ? { preferKeyword: knowledgePoints[0] } : {}),
      })

      options.onProgress?.('generating', 30)
      const generated = await this.generateWithRetry({
        topicName,
        topicDescription,
        knowledgePoints,
        plan,
        language: analysis.language,
        sourceSnippets: sources,
      }, options.signal)

      options.onProgress?.('storing', 80)
      const stored = await this.questions.addMany(
        generated.map((q, i) => ({
          projectId,
          ...(topic ? { topicId: topic.id } : {}),
          knowledgePoint: q.knowledgePoint || knowledgePoints[i % Math.max(1, knowledgePoints.length)] || topicName,
          type: plan[i]?.type ?? DEFAULT_QUESTION_TYPE,
          difficulty: plan[i]?.difficulty ?? DEFAULT_DIFFICULTY,
          prompt: q.prompt,
          ...(q.options ? { options: q.options } : {}),
          correctAnswer: q.correctAnswer,
          ...(q.solution ? { solution: q.solution } : {}),
          hints: q.hints ?? [],
          sourceRefs: (q.sourceRefs ?? []).map((r) => ({
            documentId: analysis.documentIds[0] ?? '',
            documentName: r.documentName,
            ...(typeof r.page === 'number' ? { page: r.page } : {}),
            ...(r.section ? { section: r.section } : {}),
          })),
          promptVersion: prompts.quizGenerator.VERSION,
        })),
      )

      const ready: Quiz = {
        ...quiz,
        questionIds: stored.map((q) => q.id),
        status: 'ready',
      }
      await this.quizzes.upsert(ready)
      options.onProgress?.('done', 100)
      logger.info('Quiz generated', { quizId: ready.id, count: stored.length })
      return ready
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.quizGenerationFailed')
      await this.quizzes.upsert({ ...quiz, status: 'failed', errorMessage: message })
      throw err
    }
  }

  private async generateWithRetry(
    input: Parameters<typeof prompts.quizGenerator.buildUserPrompt>[0],
    signal?: AbortSignal,
  ): Promise<GeneratedQuizQuestion[]> {
    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.quizGenerator.buildSystemPrompt() },
      { role: 'user', content: prompts.quizGenerator.buildUserPrompt(input) },
    ]
    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        const { data } = await this.ai.chatJSON<QuizGenerationOutput>(messages, {
          ...(signal ? { signal } : {}),
        })
        const questions = this.validateGenerated(data, input.plan.length)
        return questions
      } catch (err) {
        lastError = err
        logger.warn('Quiz generation attempt failed', { attempt, error: (err as Error)?.message })
      }
    }
    throw new AppError(
      t('errors.invalidQuiz', { reason: lastError instanceof Error ? lastError.message : 'unknown error' }),
      'QUIZ_GENERATION_FAILED',
    )
  }

  /** Defensive validation of AI output — never trust the shape blindly. */
  validateGenerated(data: QuizGenerationOutput, expected: number): GeneratedQuizQuestion[] {
    if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) {
      throw new AppError(t('errors.quizMissingArray'), 'MALFORMED_QUIZ')
    }
    const valid: GeneratedQuizQuestion[] = []
    for (const raw of data.questions) {
      if (!raw || typeof raw !== 'object') continue
      const q = raw as Partial<GeneratedQuizQuestion>
      if (typeof q.prompt !== 'string' || q.prompt.trim().length === 0) continue
      if (typeof q.correctAnswer !== 'string' || q.correctAnswer.trim().length === 0) continue
      const type = (q.type ?? DEFAULT_QUESTION_TYPE) as QuestionType
      // Reject anything outside the supported quiz types.
      if (!QUESTION_TYPES.includes(type)) continue

      let correctAnswer = q.correctAnswer.trim()
      let options: Array<{ label: string; isCorrect: boolean }> | undefined
      if (type === 'multiple_choice') {
        const parsed = normalizeChoiceOptions(q.options)
        if (!parsed) continue
        options = parsed
        // Grading matches `correctAnswer` against an option, so it must name
        // one. If the model only flagged an option, adopt that label.
        if (!parsed.some((o) => o.label === correctAnswer)) {
          const flagged = parsed.find((o) => o.isCorrect)
          if (!flagged) continue
          correctAnswer = flagged.label
        }
      }

      valid.push({
        prompt: q.prompt.trim(),
        type,
        ...(options ? { options } : {}),
        correctAnswer,
        solution: typeof q.solution === 'string' ? q.solution : '',
        knowledgePoint: typeof q.knowledgePoint === 'string' && q.knowledgePoint.trim() ? q.knowledgePoint.trim() : 'General',
        difficulty: (q.difficulty ?? 'basic') as DifficultyLevel,
        hints: Array.isArray(q.hints) ? q.hints.filter((h): h is string => typeof h === 'string') : [],
        ...(Array.isArray(q.sourceRefs) ? { sourceRefs: q.sourceRefs } : {}),
      })
      if (valid.length >= expected) break
    }
    if (valid.length === 0) {
      throw new AppError(t('errors.noUsableQuestions'), 'MALFORMED_QUIZ')
    }
    return valid
  }

  private async resolveKnowledgePoints(projectId: string, config: QuizConfig, topicName?: string): Promise<string[]> {
    // Explicit focus wins — review sessions and "practice this mistake".
    if (config.focusKnowledgePoints?.length) {
      return config.focusKnowledgePoints.slice(0, 8)
    }
    const concepts = await this.analyses.listConcepts(projectId)
    const topicIds = config.topicId ? new Set([config.topicId]) : null
    const relevant = concepts.filter((c) => (topicIds ? c.topicIds.some((id) => topicIds.has(id)) : true))
    const names = relevant.map((c) => c.name)
    if (names.length > 0) return names.slice(0, 8)
    return topicName ? [topicName] : []
  }

  async startQuiz(quizId: string): Promise<Quiz> {
    const quiz = await this.getQuiz(quizId)
    const next: Quiz = { ...quiz, status: 'in_progress' }
    await this.quizzes.upsert(next)
    return next
  }

  /**
   * Submit an answer. Evaluates deterministically, records the attempt,
   * updates mastery, and returns the adjusted difficulty for the next item.
   */
  async submitAnswer(
    quizId: string,
    questionId: string,
    userAnswer: string,
    opts: { durationMs?: number; hintsUsed?: number; aiFallback?: boolean } = {},
  ): Promise<SubmitAnswerResult> {
    const quiz = await this.getQuiz(quizId)
    const question = await this.questions.get(questionId)
    if (!question) throw new AppError(t('errors.questionNotFound'), 'NOT_FOUND')

    let evaluation = evaluateDeterministic(question, userAnswer)
    if (evaluation.isCorrect === null && opts.aiFallback) {
      evaluation = await this.evaluateWithAI(question, userAnswer, evaluation)
    }

    const attempt: QuestionAttempt = {
      id: crypto.randomUUID(),
      projectId: quiz.projectId,
      questionId,
      quizId,
      ...(question.topicId ? { topicId: question.topicId } : {}),
      knowledgePoint: question.knowledgePoint,
      questionType: question.type,
      difficulty: question.difficulty,
      userAnswer,
      evaluation,
      ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
      hintsUsed: opts.hintsUsed ?? 0,
      createdAt: Date.now(),
    }
    await this.attempts.add(attempt)
    await this.mastery.record(attempt)

    // Wrong answers flow into the mistake book automatically.
    if (evaluation.isCorrect === false && this.mistakes) {
      try {
        await this.mistakes.recordFromAttempt(attempt, question)
      } catch (err) {
        logger.warn('Failed to record mistake', { questionId, error: (err as Error)?.message })
      }
    }

    // Adaptive adjustment for the *next* question.
    const history = await this.attempts.listByQuiz(quizId)
    const recentResults = history.map((a) => ({
      isCorrect: a.evaluation.isCorrect,
      difficulty: a.difficulty as DifficultyLevel,
    }))
    const streaks = history.reduce(
      (acc, a) => nextStreaks(a.evaluation.isCorrect, acc.consecutiveCorrect, acc.consecutiveWrong),
      { consecutiveCorrect: 0, consecutiveWrong: 0 },
    )
    const masteryRow = await this.mastery.get(quiz.projectId, question.knowledgePoint)
    const decision = decideNextDifficulty({
      currentDifficulty: question.difficulty,
      recentResults,
      consecutiveCorrect: streaks.consecutiveCorrect,
      consecutiveWrong: streaks.consecutiveWrong,
      knowledgePointMastery: masteryRow?.mastery ?? 0,
    })

    const isLastQuestion = history.length >= quiz.questionIds.length
    if (isLastQuestion) {
      await this.completeQuiz(quizId)
    }
    return {
      attempt,
      evaluation,
      nextDifficulty: decision.difficulty,
      difficultyReason: decision.reason,
      isLastQuestion,
    }
  }

  private async evaluateWithAI(
    question: Question,
    userAnswer: string,
    fallback: QuestionEvaluation,
  ): Promise<QuestionEvaluation> {
    try {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'You grade a single student answer. Respond with JSON: {"isCorrect": boolean, "feedback": string, "confidence": number}. Be lenient with equivalent phrasing but strict on correctness.',
        },
        {
          role: 'user',
          content: `Question: ${question.prompt}\nExpected: ${question.correctAnswer}\nStudent: ${userAnswer}`,
        },
      ]
      const { data } = await this.ai.chatJSON<{ isCorrect: boolean; feedback?: string; confidence?: number }>(messages)
      return {
        isCorrect: Boolean(data.isCorrect),
        method: 'ai',
        confidence: typeof data.confidence === 'number' ? data.confidence : 0.7,
        ...(fallback.expected ? { expected: fallback.expected } : {}),
        ...(fallback.normalizedUser ? { normalizedUser: fallback.normalizedUser } : {}),
        ...(data.feedback ? { explanation: data.feedback } : {}),
        note: t('errors.judgedByAi'),
      }
    } catch (err) {
      logger.warn('AI answer evaluation failed; keeping unverified', { error: (err as Error)?.message })
      return fallback
    }
  }

  async completeQuiz(quizId: string): Promise<Quiz> {
    const quiz = await this.getQuiz(quizId)
    const attempts = await this.attempts.listByQuiz(quizId)
    const score = this.computeScore(quiz, attempts)
    const completed: Quiz = {
      ...quiz,
      status: 'completed',
      score,
      finishedAt: Date.now(),
    }
    await this.quizzes.upsert(completed)
    logger.info('Quiz completed', { quizId, percentage: score.percentage })
    return completed
  }

  /** Pure scoring function — exported for tests via `scoreQuiz`. */
  computeScore(quiz: Quiz, attempts: QuestionAttempt[]): QuizScore {
    return scoreQuiz(quiz, attempts)
  }

  async getAttempts(quizId: string): Promise<QuestionAttempt[]> {
    return this.attempts.listByQuiz(quizId)
  }

  /**
   * Generate a follow-up quiz. `harder` / `easier` shift the difficulty plan;
   * `weakness` targets knowledge points with low mastery.
   */
  async generateMore(quizId: string, mode: MoreQuestionsMode, options: GenerateQuizOptions = {}): Promise<Quiz> {
    const quiz = await this.getQuiz(quizId)
    const baseConfig = quiz.config
    let config: QuizConfig = { ...baseConfig }

    if (mode === 'harder' || mode === 'easier') {
      const base: DifficultyLevel = baseConfig.difficulty === 'adaptive' ? DEFAULT_DIFFICULTY : baseConfig.difficulty
      config = {
        ...baseConfig,
        difficulty: stepDifficulty(base, mode === 'harder' ? +1 : -1),
      }
    } else if (mode === 'weakness') {
      const weak = await this.mastery.weakKnowledgePoints(quiz.projectId, 0.65, 4)
      config = {
        ...baseConfig,
        mode: 'weakness',
        ...(weak[0]?.topicId ? { topicId: weak[0].topicId } : {}),
        topicName:
          weak.length > 0
            ? t('quizResult.followUp.weaknessLabel', {
                topic: weak.map((w) => w.knowledgePoint).join(', '),
              })
            : t('quizResult.followUp.weakness'),
      }
    }

    const generated = await this.generateQuiz(quiz.projectId, config, options)
    return generated
  }

  async deleteQuiz(quizId: string): Promise<void> {
    await this.quizzes.delete(quizId)
  }
}

/**
 * Pure scoring function. Unverified answers are tracked separately and
 * excluded from the percentage denominator so the score isn't distorted by
 * questions the system could not grade.
 */
export function scoreQuiz(quiz: Quiz, attempts: QuestionAttempt[]): QuizScore {
  const byDifficulty: Record<string, { correct: number; wrong: number; unverified: number; total: number }> = {}
  const byKpMap = new Map<string, QuizKnowledgeStat>()
  let correct = 0
  let wrong = 0
  let unverified = 0

  const attemptByQuestion = new Map(attempts.map((a) => [a.questionId, a]))

  for (const questionId of quiz.questionIds) {
    const attempt = attemptByQuestion.get(questionId)
    const difficulty = attempt?.difficulty ?? 'unknown'
    if (!byDifficulty[difficulty]) {
      byDifficulty[difficulty] = { correct: 0, wrong: 0, unverified: 0, total: 0 }
    }
    const dStat = byDifficulty[difficulty]!
    dStat.total++

    const kp = attempt?.knowledgePoint ?? t('common.unknown')
    if (!byKpMap.has(kp)) {
      byKpMap.set(kp, { knowledgePoint: kp, correct: 0, wrong: 0, unverified: 0, total: 0 })
    }
    const kStat = byKpMap.get(kp)!
    kStat.total++

    if (!attempt) {
      unverified++
      dStat.unverified++
      kStat.unverified++
      continue
    }
    if (attempt.evaluation.isCorrect === true) {
      correct++
      dStat.correct++
      kStat.correct++
    } else if (attempt.evaluation.isCorrect === false) {
      wrong++
      dStat.wrong++
      kStat.wrong++
    } else {
      unverified++
      dStat.unverified++
      kStat.unverified++
    }
  }

  const gradable = correct + wrong
  const percentage = gradable > 0 ? Math.round((correct / gradable) * 100) : 0

  const byKnowledgePoint = [...byKpMap.values()].sort((a, b) => {
    const aAcc = a.correct + a.wrong > 0 ? a.correct / (a.correct + a.wrong) : 1
    const bAcc = b.correct + b.wrong > 0 ? b.correct / (b.correct + b.wrong) : 1
    return aAcc - bAcc
  })
  const weakKnowledgePoints = byKnowledgePoint
    .filter((k) => k.correct + k.wrong > 0 && k.correct / (k.correct + k.wrong) < 0.6)
    .map((k) => k.knowledgePoint)

  return {
    correct,
    wrong,
    unverified,
    total: quiz.questionIds.length,
    percentage,
    byDifficulty,
    byKnowledgePoint,
    weakKnowledgePoints,
  }
}

export type { QuizDifficulty }