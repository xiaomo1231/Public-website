import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { collectTopicSources, formatTopicSources } from './topicSources'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import type { Question, QuestionOption } from '@/entities/question/types'
import type { QuestionAttempt, QuestionEvaluation } from '@/entities/questionAttempt/types'
import { ProjectService } from './projectService'
import type { AIService } from './aiService'
import type { MistakeService } from './mistakeService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import {
  normalizeTutorEvaluation,
  normalizeTutorQuestion,
} from '@/infrastructure/ai/prompts/tutor/normalize'
import type {
  DifficultyLevel,
  SourceReference,
  TutorEvaluation,
} from '@/infrastructure/ai/prompts/types'
import type {
  TutorQuestion,
  TutorSession,
  TutorTurn,
} from '@/entities/tutorSession/types'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { friendlyTutorError } from '@/shared/lib/aiErrors'
import { t } from '@/i18n'

const SOURCE_CHUNK_LIMIT = 6
const MAX_HINTS = 3

/**
 * The tutor prompt returns option labels as plain strings; the persisted
 * `Question` model stores `QuestionOption` objects. The option matching the
 * expected answer is marked correct.
 */
function toQuestionOptions(
  options: string[] | undefined,
  expectedAnswer: string,
): QuestionOption[] | undefined {
  if (!options || options.length === 0) return undefined
  const expected = expectedAnswer.trim()
  return options.map((label, index) => ({
    id: `opt-${index + 1}`,
    label,
    isCorrect: label.trim() === expected,
  }))
}

export interface TutorStartInput {
  projectId: string
  topicId: string
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
  difficulty?: DifficultyLevel
  signal?: AbortSignal
}

export interface TutorActionResult {
  session: TutorSession
  turn: TutorTurn
  finished: boolean
  /**
   * Set when the lesson itself succeeded but the practice question could not be
   * generated. This is deliberately non-fatal: the tutor's explanation must not
   * depend on question generation succeeding.
   */
  questionError?: string
}

/** True when the error is a user/tool cancellation rather than a failure. */
function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}



const DIFFICULTY_ORDER: DifficultyLevel[] = ['beginner', 'basic', 'intermediate', 'advanced', 'challenge']

function adjustDifficulty(
  current: DifficultyLevel,
  isCorrect: boolean,
  streakCorrect: number,
  streakWrong: number,
  wasSupplementary: boolean,
): { difficulty: DifficultyLevel; streakCorrect: number; streakWrong: number; masteryDelta: number } {
  let nextDifficulty = current
  let nextStreakCorrect = streakCorrect
  let nextStreakWrong = streakWrong
  const masteryDelta = isCorrect ? 0.05 : -0.04

  if (isCorrect) {
    nextStreakCorrect += 1
    nextStreakWrong = 0
    if (nextStreakCorrect >= 2) {
      const idx = Math.min(DIFFICULTY_ORDER.indexOf(current) + 1, DIFFICULTY_ORDER.length - 1)
      nextDifficulty = DIFFICULTY_ORDER[idx] ?? current
      nextStreakCorrect = 0
    }
  } else {
    nextStreakWrong += 1
    nextStreakCorrect = 0
    if (nextStreakWrong >= 2 || wasSupplementary) {
      const idx = Math.max(DIFFICULTY_ORDER.indexOf(current) - 1, 0)
      nextDifficulty = DIFFICULTY_ORDER[idx] ?? current
      nextStreakWrong = 0
    }
  }

  return {
    difficulty: nextDifficulty,
    streakCorrect: nextStreakCorrect,
    streakWrong: nextStreakWrong,
    masteryDelta,
  }
}

function clampMastery(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export class TutorService {
  private db: AppDatabase
  private sessions: TutorSessionRepository
  private analyses: CourseAnalysisRepository
  private chunks: ChunkRepository
  private questions: QuestionRepository
  private attempts: QuestionAttemptRepository
  private mistakes: MistakeService | null
  private projects: ProjectService
  private ai: AIService

  constructor(deps: {
    db?: AppDatabase
    sessions?: TutorSessionRepository
    analyses?: CourseAnalysisRepository
    chunks?: ChunkRepository
    questions?: QuestionRepository
    attempts?: QuestionAttemptRepository
    /** When provided, wrong tutor answers are recorded in the mistake book. */
    mistakes?: MistakeService
    projects?: ProjectService
    ai: AIService
  }) {
    this.db = deps.db ?? getDb()
    this.sessions = deps.sessions ?? new TutorSessionRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.questions = deps.questions ?? new QuestionRepository(this.db)
    this.attempts = deps.attempts ?? new QuestionAttemptRepository(this.db)
    this.mistakes = deps.mistakes ?? null
    this.projects = deps.projects ?? new ProjectService(this.db)
    this.ai = deps.ai
  }

  async startSession(input: TutorStartInput): Promise<TutorSession> {
    await this.projects.get(input.projectId)
    const now = Date.now()
    const session: TutorSession = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      topicId: input.topicId,
      topicName: input.topicName,
      ...(input.topicDescription ? { topicDescription: input.topicDescription } : {}),
      language: input.language,
      messages: [],
      turns: [],
      streakCorrect: 0,
      streakWrong: 0,
      currentDifficulty: input.difficulty ?? 'intermediate',
      hintsRevealed: 0,
      mastery: 0,
      status: 'active',
      startedAt: now,
      updatedAt: now,
    }
    await this.sessions.upsert(session)
    return session
  }

  /**
   * Continue the most recent conversation for this topic, or start one.
   *
   * Reopening the Interactive Tutor should resume where the student left off —
   * starting a fresh session every visit would discard their progress and make
   * the tutor repeat its introduction.
   */
  async findOrStartSession(
    input: TutorStartInput,
  ): Promise<{ session: TutorSession; resumed: boolean }> {
    const existing = await this.sessions.findLatest(input.projectId, input.topicId)
    if (existing && existing.language === input.language && existing.turns.length > 0) {
      return { session: existing, resumed: true }
    }
    return { session: await this.startSession(input), resumed: false }
  }

  async getSession(id: string): Promise<TutorSession> {
    const session = await this.sessions.get(id)
    if (!session) throw new AppError(t('errors.sessionNotFound'), 'NOT_FOUND')
    return session
  }

  /**
   * First call after `startSession`: stream the topic explanation, then try to
   * generate the first practice question.
   *
   * The two halves are independent. The explanation is the tutor's primary
   * output, so a failure to produce a question is reported through
   * `questionError` and the lesson still opens. Only a failure to produce the
   * explanation itself is fatal.
   *
   * When `onDelta` is supplied the introduction is streamed and the streamed
   * text is what gets persisted — the introduction is generated exactly once.
   */
  async beginTopic(
    sessionId: string,
    opts: { onDelta?: (delta: string) => void; signal?: AbortSignal } = {},
  ): Promise<TutorActionResult> {
    const session = await this.getSession(sessionId)
    const sources = await this.collectSources(session)
    const introMessages: ChatMessage[] = [
      { role: 'system', content: prompts.tutorIntroduce.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.tutorIntroduce.buildUserPrompt({
          topicName: session.topicName,
          topicDescription: session.topicDescription ?? '',
          context: `Project ${session.projectId}.`,
          sourceSnippets: sources,
          language: session.language,
        }),
      },
    ]
    const introRes = opts.onDelta
      ? await this.ai.streamChat(introMessages, opts.onDelta, {
          ...(opts.signal ? { signal: opts.signal } : {}),
        })
      : await this.ai.chat(introMessages)

    // Canonical maths: recover/convert Unicode maths to LaTeX and make sure no
    // Private Use Area glyph survives into the stored explanation.
    const introContent = normalizeMathNotation(introRes.content).text.trim()

    // An empty explanation leaves the student with nothing to read, so this is
    // the one case where the tutor genuinely cannot open.
    if (!introContent) {
      throw new AppError(t('tutor.emptyResponse'), 'EMPTY_TUTOR_RESPONSE')
    }

    const introTurn: TutorTurn = {
      role: 'tutor',
      kind: 'introduction',
      content: introContent,
      createdAt: Date.now(),
    }
    session.turns.push(introTurn)
    session.messages.push(
      { role: 'user', content: introMessages[1]!.content },
      { role: 'assistant', content: introContent },
    )
    await this.sessions.upsert(session)

    // Best-effort: a question is a follow-up, never a precondition.
    try {
      return await this.askQuestion(session.id, opts.signal)
    } catch (err) {
      if (isAbort(err)) {
        return { session: await this.getSession(session.id), turn: introTurn, finished: false }
      }
      logger.warn('Tutor question generation failed; continuing with the introduction', {
        sessionId: session.id,
        error: (err as Error)?.message,
      })
      return {
        session: await this.getSession(session.id),
        turn: introTurn,
        finished: false,
        questionError: friendlyTutorError(err),
      }
    }
  }

  /** Generate the next question for the current session. */
  async askQuestion(sessionId: string, signal?: AbortSignal): Promise<TutorActionResult> {
    const session = await this.getSession(sessionId)
    const sources = await this.collectSources(session)
    // Questions are grounded in the course material by design. Without any
    // material the honest answer is "this topic has nothing to practise on" —
    // not a generic "the AI failed" message.
    if (sources.length === 0) {
      throw new AppError(t('tutor.noContent'), 'NO_TOPIC_CONTENT')
    }
    const prior = session.turns
      .filter((t) => t.kind === 'question')
      .map((t) => t.question?.prompt ?? '')
      .slice(-3)
    const recentContext = session.turns
      .slice(-4)
      .map((t) => `${t.role}: ${t.content.slice(0, 240)}`)
      .join('\n')

    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.tutorQuestion.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.tutorQuestion.buildUserPrompt({
          topicName: session.topicName,
          topicDescription: session.topicDescription ?? '',
          difficulty: session.currentDifficulty,
          language: session.language,
          ...(prior.length > 0 ? { avoidRepeating: prior } : {}),
          sourceSnippets: sources,
          ...(recentContext ? { recentContext } : {}),
        }),
      },
    ]
    const { data } = await this.ai.chatJSON<unknown>(messages, {
      ...(signal ? { signal } : {}),
    })
    // Validate + sanitise before the question reaches the student or storage.
    const question: TutorQuestion = normalizeTutorQuestion(data)

    // Persist the question so it has a stable identity. This is what lets the
    // mistake book reference it and deduplicate repeat errors, exactly as it
    // does for quiz questions. Best-effort: a storage failure must not break
    // the lesson.
    let persistedId: string | undefined
    try {
      const [stored] = await this.questions.addMany([
        {
          projectId: session.projectId,
          ...(session.topicId ? { topicId: session.topicId } : {}),
          knowledgePoint: question.knowledgePoint,
          type: question.type,
          difficulty: question.difficulty,
          prompt: question.prompt,
          ...(() => {
            const options = toQuestionOptions(question.options, question.expectedAnswer)
            return options ? { options } : {}
          })(),
          correctAnswer: question.expectedAnswer,
          ...(question.explanation ? { solution: question.explanation } : {}),
          hints: question.hints.slice(0, MAX_HINTS),
          sourceRefs: question.sourceRefs as SourceReference[],
          promptVersion: prompts.tutorQuestion.VERSION,
        },
      ])
      persistedId = stored?.id
    } catch (err) {
      logger.warn('Could not persist tutor question', { error: (err as Error)?.message })
    }

    const turn: TutorTurn = {
      role: 'tutor',
      kind: 'question',
      content: question.prompt,
      question,
      createdAt: Date.now(),
    }
    session.turns.push(turn)
    session.pendingQuestion = {
      id: persistedId ?? crypto.randomUUID(),
      prompt: question.prompt,
      type: question.type,
      ...(question.options ? { options: question.options } : {}),
      expectedAnswer: question.expectedAnswer,
      explanation: question.explanation,
      knowledgePoint: question.knowledgePoint,
      difficulty: question.difficulty,
      sourceRefs: question.sourceRefs as SourceReference[],
      hints: question.hints.slice(0, MAX_HINTS),
    }
    session.hintsRevealed = 0
    session.messages.push(
      { role: 'user', content: prompts.tutorQuestion.buildUserPrompt({ topicName: session.topicName, topicDescription: session.topicDescription ?? '', difficulty: session.currentDifficulty, language: session.language, sourceSnippets: sources }) },
      { role: 'assistant', content: JSON.stringify(question) },
    )
    await this.sessions.upsert(session)
    return { session, turn, finished: false }
  }

  /** Reveal the next hint for the current question. */
  async requestHint(sessionId: string): Promise<{ session: TutorSession; hint: string }> {
    const session = await this.getSession(sessionId)
    if (!session.pendingQuestion) {
      throw new AppError(t('errors.noActiveQuestion'), 'NO_ACTIVE_QUESTION')
    }
    const idx = Math.min(session.hintsRevealed, session.pendingQuestion.hints.length - 1)
    const hint = session.pendingQuestion.hints[idx] ?? session.pendingQuestion.hints[session.pendingQuestion.hints.length - 1] ?? t('errors.hintUnavailable')
    session.hintsRevealed = Math.min(session.hintsRevealed + 1, session.pendingQuestion.hints.length)
    const turn: TutorTurn = {
      role: 'tutor',
      kind: 'hint',
      content: hint,
      question: session.pendingQuestion,
      createdAt: Date.now(),
    }
    session.turns.push(turn)
    await this.sessions.upsert({ ...session, updatedAt: Date.now() })
    return { session, hint }
  }

  /** Submit an answer to the current pending question. */
  async submitAnswer(
    sessionId: string,
    studentAnswer: string,
    signal?: AbortSignal,
  ): Promise<TutorActionResult> {
    const session = await this.getSession(sessionId)
    if (!session.pendingQuestion) {
      throw new AppError(t('errors.noActiveQuestion'), 'NO_ACTIVE_QUESTION')
    }
    const sources = await this.collectSources(session)
    const question = session.pendingQuestion
    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.tutorEvaluate.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.tutorEvaluate.buildUserPrompt({
          topicName: session.topicName,
          question: question.prompt,
          expectedAnswer: question.expectedAnswer,
          studentAnswer,
          language: session.language,
          sourceSnippets: sources,
          sourceRefs: question.sourceRefs,
        }),
      },
    ]
    const { data } = await this.ai.chatJSON<unknown>(messages, {
      ...(signal ? { signal } : {}),
    })
    // Validate + sanitise before the verdict drives difficulty or the book.
    const evaluationTyped: TutorEvaluation = normalizeTutorEvaluation(data)

    const answerTurn: TutorTurn = {
      role: 'student',
      kind: 'answer',
      content: studentAnswer,
      question,
      createdAt: Date.now(),
    }
    const feedbackTurn: TutorTurn = {
      role: 'tutor',
      kind: 'feedback',
      content: `${evaluationTyped.feedback}\n\n${evaluationTyped.groundedExplanation}${
        evaluationTyped.isSupplementary ? `\n\n${t('errors.supplementary')}` : ''
      }`,
      question,
      evaluation: evaluationTyped,
      createdAt: Date.now(),
    }
    session.turns.push(answerTurn, feedbackTurn)

    const adj = adjustDifficulty(
      session.currentDifficulty,
      evaluationTyped.isCorrect,
      session.streakCorrect,
      session.streakWrong,
      evaluationTyped.isSupplementary,
    )
    session.currentDifficulty = adj.difficulty
    session.streakCorrect = adj.streakCorrect
    session.streakWrong = adj.streakWrong
    session.mastery = clampMastery(session.mastery + adj.masteryDelta)
    session.pendingQuestion = undefined
    session.hintsRevealed = 0
    session.messages.push({ role: 'user', content: studentAnswer }, { role: 'assistant', content: JSON.stringify(evaluationTyped) })
    await this.sessions.upsert(session)

    // Wrong tutor answers go to the mistake book through the same service the
    // quiz uses — one persistence path, one deduplication strategy.
    if (evaluationTyped.isCorrect === false && this.mistakes) {
      await this.recordMistake(session, question, studentAnswer, evaluationTyped)
    }

    return { session, turn: feedbackTurn, finished: session.mastery >= 0.8 && evaluationTyped.isCorrect }
  }

  /**
   * Record a wrong tutor answer as a mistake + attempt.
   *
   * Deduplication is handled by `MistakeService.recordFromAttempt`, which
   * merges into an existing mistake for the same question instead of
   * creating duplicates.
   */
  private async recordMistake(
    session: TutorSession,
    question: NonNullable<TutorSession['pendingQuestion']>,
    studentAnswer: string,
    evaluation: TutorEvaluation,
  ): Promise<void> {
    try {
      const evaluationForAttempt: QuestionEvaluation = {
        isCorrect: evaluation.isCorrect,
        method: 'ai',
        confidence: 0.8,
        expected: question.expectedAnswer,
        normalizedUser: studentAnswer,
        normalizedExpected: question.expectedAnswer,
        ...(evaluation.feedback ? { explanation: evaluation.feedback } : {}),
        note: t('errors.judgedByTutor'),
      }
      const attempt: QuestionAttempt = {
        id: crypto.randomUUID(),
        projectId: session.projectId,
        questionId: question.id,
        ...(session.topicId ? { topicId: session.topicId } : {}),
        knowledgePoint: question.knowledgePoint,
        questionType: question.type,
        difficulty: question.difficulty,
        userAnswer: studentAnswer,
        evaluation: evaluationForAttempt,
        hintsUsed: session.hintsRevealed,
        createdAt: Date.now(),
      }
      await this.attempts.add(attempt)

      const stored = await this.questions.get(question.id)
      const source: Question = stored ?? {
        id: question.id,
        projectId: session.projectId,
        ...(session.topicId ? { topicId: session.topicId } : {}),
        knowledgePoint: question.knowledgePoint,
        type: question.type,
        difficulty: question.difficulty,
        prompt: question.prompt,
        ...(() => {
          const options = toQuestionOptions(question.options, question.expectedAnswer)
          return options ? { options } : {}
        })(),
        correctAnswer: question.expectedAnswer,
        ...(question.explanation ? { solution: question.explanation } : {}),
        hints: question.hints,
        sourceRefs: question.sourceRefs,
        promptVersion: prompts.tutorQuestion.VERSION,
        createdAt: Date.now(),
      }
      await this.mistakes!.recordFromAttempt(attempt, source)
    } catch (err) {
      logger.warn('Could not record tutor mistake', { error: (err as Error)?.message })
    }
  }

  /** Abandon the session. */
  async abandon(sessionId: string): Promise<TutorSession> {
    const session = await this.getSession(sessionId)
    session.status = 'abandoned'
    await this.sessions.upsert(session)
    return session
  }

  /**
   * Gather the course material the tutor should be grounded in.
   *
   * Delegates to the shared topic-source resolver so the interactive tutor and
   * the cached lesson are always grounded in exactly the same chunks.
   */
  private async collectSources(session: TutorSession): Promise<string[]> {
    if (!session.topicId) return []
    const sources = await collectTopicSources(
      { analyses: this.analyses, chunks: this.chunks },
      session.projectId,
      session.topicId,
      SOURCE_CHUNK_LIMIT,
    )
    return formatTopicSources(sources)
  }
}