import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { QuizService, adaptiveHistory } from '@/services/quizService'
import { MasteryService } from '@/services/masteryService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import type { AIService } from '@/services/aiService'
import type { QuizConfig } from '@/entities/quiz/types'
import type { Question } from '@/entities/question/types'

function fakeAI(chatJSON: ReturnType<typeof vi.fn>): AIService {
  return {
    chatJSON,
    chat: vi.fn(),
    streamChat: vi.fn(),
    testConnection: vi.fn(),
    reset: vi.fn(),
    currentProvider: {},
  } as unknown as AIService
}

async function seedProjectWithAnalysis(db: AppDatabase) {
  const projects = new ProjectService(db)
  const p = await projects.create({ name: 'Calculus', subject: 'calculus' })
  const docs = new DocumentRepository(db)
  const chunks = new ChunkRepository(db)
  const analyses = new CourseAnalysisRepository(db)
  const doc = await docs.create({ projectId: p.id, type: 'text', name: 'calc.txt', sizeBytes: 0 })
  await docs.update(doc.id, { status: 'ready' })
  await chunks.addMany([
    {
      documentId: doc.id,
      projectId: p.id,
      contentType: 'paragraph',
      text: 'The derivative of x^2 is 2x. The chain rule handles compositions.',
      sourceReference: 'calc.txt',
      order: 0,
    },
  ])
  const topicId = 'topic-derivatives'
  await analyses.reseedProject(
    p.id,
    {
      topics: [{ name: 'Derivatives', description: 'rates of change', sourceRefs: [{ documentId: doc.id, documentName: 'calc.txt' }] }],
      concepts: [
        { name: 'Chain Rule', definition: 'derivative of composition', topicNames: ['Derivatives'], sourceRefs: [{ documentId: doc.id, documentName: 'calc.txt' }] },
      ],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map([['Derivatives', topicId]]),
    },
    'en',
  )
  return { project: p, topicId, analyses, chunks }
}

function buildService(db: AppDatabase, ai: AIService) {
  return new QuizService({
    ai,
    db,
    questions: new QuestionRepository(db),
    attempts: new QuestionAttemptRepository(db),
    quizzes: new QuizRepository(db),
    analyses: new CourseAnalysisRepository(db),
    chunks: new ChunkRepository(db),
    mastery: new MasteryService(db),
  })
}

const baseConfig: QuizConfig = {
  mode: 'topic',
  count: 2,
  difficulty: 'adaptive',
  types: ['numeric'],
}

describe('QuizService.generateQuiz', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('throws NO_ANALYSIS when the project has not been analysed', async () => {
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'Empty', subject: 'cs' })
    const svc = buildService(db, fakeAI(vi.fn()))
    await expect(svc.generateQuiz(p.id, baseConfig)).rejects.toMatchObject({ code: 'NO_ANALYSIS' })
  })

  it('generates, stores, and returns a ready quiz', async () => {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const chatJSON = vi.fn().mockResolvedValue({
      data: {
        questions: [
          { prompt: 'What is the derivative of x^2?', type: 'numeric', correctAnswer: '2x', solution: 'power rule', knowledgePoint: 'Power Rule', difficulty: 'basic', hints: ['use the power rule'] },
          { prompt: 'Differentiate sin(x)', type: 'numeric', correctAnswer: 'cos(x)', solution: 'standard derivative', knowledgePoint: 'Trig Derivatives', difficulty: 'intermediate', hints: [] },
        ],
      },
      raw: { content: '{}', model: 'gpt-test' },
    })
    const svc = buildService(db, fakeAI(chatJSON))
    const quiz = await svc.generateQuiz(project.id, { ...baseConfig, topicId, topicName: 'Derivatives' })
    expect(quiz.status).toBe('ready')
    expect(quiz.questionIds).toHaveLength(2)
    const questions = await svc.getQuestions(quiz.id)
    expect(questions).toHaveLength(2)
    expect(questions[0]!.projectId).toBe(project.id)
    expect(questions[0]!.topicId).toBe(topicId)
  })

  it('fills a missing knowledge point from the topic material, not "General"', async () => {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const chatJSON = vi.fn().mockResolvedValue({
      data: {
        questions: [
          { prompt: 'd/dx x^3 at x=1?', type: 'numeric', correctAnswer: '3', solution: '', difficulty: 'basic', hints: [] },
          { prompt: 'd/dx x^2 at x=2?', type: 'numeric', correctAnswer: '4', solution: '', knowledgePoint: '', difficulty: 'basic', hints: [] },
        ],
      },
      raw: { content: '{}', model: 'gpt-test' },
    })
    const svc = buildService(db, fakeAI(chatJSON))
    const quiz = await svc.generateQuiz(project.id, { ...baseConfig, topicId, topicName: 'Derivatives' })
    const points = (await svc.getQuestions(quiz.id)).map((q) => q.knowledgePoint)
    expect(points).not.toContain('General')
    expect(points.every((point) => point.length > 0)).toBe(true)
  })

  it('retries once then fails on malformed AI output', async () => {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const chatJSON = vi.fn().mockResolvedValue({ data: { notQuestions: true }, raw: { content: '{}', model: 'm' } })
    const svc = buildService(db, fakeAI(chatJSON))
    await expect(
      svc.generateQuiz(project.id, { ...baseConfig, topicId }),
    ).rejects.toMatchObject({ code: 'QUIZ_GENERATION_FAILED' })
    expect(chatJSON).toHaveBeenCalledTimes(2)
  })

  it('rejects multiple-choice questions without a correct option', async () => {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const chatJSON = vi.fn().mockResolvedValue({
      data: {
        questions: [
          { prompt: 'Bad MC', type: 'multiple_choice', options: [{ label: 'A', isCorrect: false }, { label: 'B', isCorrect: false }], correctAnswer: 'A', knowledgePoint: 'KP', difficulty: 'basic', hints: [] },
        ],
      },
      raw: { content: '{}', model: 'm' },
    })
    const svc = buildService(db, fakeAI(chatJSON))
    await expect(svc.generateQuiz(project.id, { ...baseConfig, count: 1, topicId, types: ['multiple_choice'] })).rejects.toMatchObject({
      code: 'QUIZ_GENERATION_FAILED',
    })
  })

  it('rejects out-of-range question counts', async () => {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const svc = buildService(db, fakeAI(vi.fn()))
    await expect(svc.generateQuiz(project.id, { ...baseConfig, count: 999, topicId })).rejects.toMatchObject({
      code: 'INVALID_COUNT',
    })
  })

  it('builds an escalating adaptive difficulty plan', async () => {
    await seedProjectWithAnalysis(db)
    const svc = buildService(db, fakeAI(vi.fn()))
    const plan = svc.buildDifficultyPlan({ ...baseConfig, count: 7, difficulty: 'adaptive' })
    expect(plan[0]).toBe('basic')
    expect(plan[6]).not.toBe('basic')
    // Never skips more than one level per step.
    for (let i = 1; i < plan.length; i++) {
      const delta = ['beginner', 'basic', 'intermediate', 'advanced', 'challenge'].indexOf(plan[i]!) - ['beginner', 'basic', 'intermediate', 'advanced', 'challenge'].indexOf(plan[i - 1]!)
      expect(delta).toBeLessThanOrEqual(1)
    }
  })
})

describe('QuizService.submitAnswer', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function setupQuiz(questions: Array<Partial<Question> & { type: Question['type']; correctAnswer: string }>) {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const questionRepo = new QuestionRepository(db)
    const stored = await questionRepo.addMany(
      questions.map((q, i) => ({
        projectId: project.id,
        topicId,
        knowledgePoint: q.knowledgePoint ?? 'Power Rule',
        type: q.type,
        difficulty: q.difficulty ?? 'basic',
        prompt: q.prompt ?? `Question ${i + 1}`,
        correctAnswer: q.correctAnswer,
        ...(q.options ? { options: q.options } : {}),
        hints: [],
      })),
    )
    const quizRepo = new QuizRepository(db)
    const quiz = await quizRepo.upsert({
      id: crypto.randomUUID(),
      projectId: project.id,
      title: 'T',
      config: { ...baseConfig, count: stored.length, topicId },
      questionIds: stored.map((q) => q.id),
      status: 'in_progress',
      difficultyPlan: stored.map((q) => q.difficulty),
      startedAt: Date.now(),
      promptVersion: 'v1',
    })
    const svc = buildService(db, fakeAI(vi.fn()))
    return { project, quiz, stored, svc }
  }

  it('grades an answer and records an attempt', async () => {
    const { quiz, stored, svc } = await setupQuiz([{ type: 'numeric', correctAnswer: '2.5' }])
    const result = await svc.submitAnswer(quiz.id, stored[0]!.id, '2.5')
    expect(result.evaluation.isCorrect).toBe(true)
    const attempts = await svc.getAttempts(quiz.id)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.quizId).toBe(quiz.id)
  })

  it('updates knowledge mastery after an attempt', async () => {
    const { project, quiz, stored, svc } = await setupQuiz([
      { type: 'numeric', correctAnswer: '2.5', knowledgePoint: 'Derivative' },
    ])
    await svc.submitAnswer(quiz.id, stored[0]!.id, '2.5')
    const mastery = await new MasteryService(db).get(project.id, 'Derivative')
    expect(mastery).toBeDefined()
    expect(mastery!.attempts).toBe(1)
    expect(mastery!.correct).toBe(1)
    expect(mastery!.mastery).toBeGreaterThan(0.5)
  })

  it('completes the quiz after the final question and computes a score', async () => {
    const { quiz, stored, svc } = await setupQuiz([
      { type: 'numeric', correctAnswer: '9.81' },
      { type: 'numeric', correctAnswer: '3.14' },
    ])
    const first = await svc.submitAnswer(quiz.id, stored[0]!.id, '9.81')
    expect(first.isLastQuestion).toBe(false)
    const second = await svc.submitAnswer(quiz.id, stored[1]!.id, '2.5')
    expect(second.isLastQuestion).toBe(true)
    const completed = await svc.getQuiz(quiz.id)
    expect(completed.status).toBe('completed')
    expect(completed.score?.correct).toBe(1)
    expect(completed.score?.wrong).toBe(1)
    expect(completed.score?.percentage).toBe(50)
  })

  it('counts distinct answered questions, so re-answering one does not finish the quiz early', async () => {
    const { quiz, stored, svc } = await setupQuiz([
      { type: 'numeric', correctAnswer: '1' },
      { type: 'numeric', correctAnswer: '2' },
      { type: 'numeric', correctAnswer: '3' },
    ])
    await svc.submitAnswer(quiz.id, stored[0]!.id, '1')
    // A reopened quiz used to restart at question 1 and answer it again.
    const again = await svc.submitAnswer(quiz.id, stored[0]!.id, '1')
    expect(again.isLastQuestion).toBe(false)
    const second = await svc.submitAnswer(quiz.id, stored[1]!.id, '2')
    expect(second.isLastQuestion).toBe(false)
    expect((await svc.getQuiz(quiz.id)).status).toBe('in_progress')
    const third = await svc.submitAnswer(quiz.id, stored[2]!.id, '3')
    expect(third.isLastQuestion).toBe(true)
  })

  it('stores the number of hints revealed with the attempt', async () => {
    const { quiz, stored, svc } = await setupQuiz([{ type: 'numeric', correctAnswer: '2' }])
    const result = await svc.submitAnswer(quiz.id, stored[0]!.id, '2', { hintsUsed: 2 })
    expect(result.attempt.hintsUsed).toBe(2)
  })

  it('rebuilds mastery after a dispute from quiz AND practice work, keeping flashcard reviews', async () => {
    const { project, quiz, stored, svc } = await setupQuiz([
      { type: 'numeric', correctAnswer: '2', knowledgePoint: 'calc.txt' },
    ])
    const mastery = new MasteryService(db)
    // A flashcard review on the same point, stored only on the mastery row.
    await mastery.recordObservation(project.id, 'calc.txt', undefined, {
      at: Date.now() - 5000,
      isCorrect: true,
      difficulty: 'basic',
      questionType: 'flashcard',
      credit: 1,
      weight: 0.5,
    })
    // A graded practice attempt whose knowledge point (document name) matches.
    const { PracticeRepository } = await import('@/entities/practice/repository')
    const practice = new PracticeRepository(db)
    await practice.addQuestions([
      {
        id: 'pq1',
        projectId: project.id,
        setId: 'set-1',
        documentId: 'doc-p',
        documentName: 'calc.txt',
        order: 0,
        type: 'numeric',
        prompt: 'P1',
        options: [],
        expectedAnswer: '4',
        answerSource: 'professor',
        confidence: 1,
        status: 'verified',
        createdAt: Date.now(),
      } as never,
    ])
    await practice.addAttempt({
      id: 'pa1',
      projectId: project.id,
      setId: 'set-1',
      questionId: 'pq1',
      userAnswer: '4',
      isCorrect: true,
      method: 'numeric',
      attemptNumber: 1,
      submittedAt: Date.now() - 4000,
    })
    const wrong = await svc.submitAnswer(quiz.id, stored[0]!.id, '5')
    await svc.disputeAttempt(wrong.attempt.id)
    const row = await mastery.get(project.id, 'calc.txt')
    // The disputed quiz attempt is gone; the practice answer and flashcard remain.
    expect(row!.observations).toHaveLength(2)
    expect(row!.observations.some((o) => o.questionType === 'flashcard')).toBe(true)
    expect(row!.observations.every((o) => o.isCorrect === true)).toBe(true)
  })

  it('excludes unverified answers from the percentage', async () => {
    const { quiz, stored, svc } = await setupQuiz([
      { type: 'numeric', correctAnswer: '9.81' },
      { type: 'numeric', correctAnswer: 'rate of change' },
    ])
    await svc.submitAnswer(quiz.id, stored[0]!.id, '9.81')
    // A free-text answer with no keyword overlap cannot be graded reliably.
    await svc.submitAnswer(quiz.id, stored[1]!.id, 'something unrelated entirely')
    const completed = await svc.getQuiz(quiz.id)
    expect(completed.score?.correct).toBe(1)
    expect(completed.score?.unverified).toBe(1)
    expect(completed.score?.percentage).toBe(100)
  })

  it('returns an adaptive next difficulty without demoting on one mistake', async () => {
    const { quiz, stored, svc } = await setupQuiz([
      { type: 'numeric', correctAnswer: '9.81', difficulty: 'intermediate' },
      { type: 'numeric', correctAnswer: '3.14', difficulty: 'intermediate' },
    ])
    await svc.submitAnswer(quiz.id, stored[0]!.id, '9.81')
    const second = await svc.submitAnswer(quiz.id, stored[1]!.id, '2.5')
    expect(second.nextDifficulty).not.toBe('beginner')
    expect(second.difficultyReason).toBeTruthy()
  })

  it('grades math expressions equivalently', async () => {
    const { quiz, stored, svc } = await setupQuiz([
      { type: 'math_expr', correctAnswer: 'x^2/2', knowledgePoint: 'Integrals' },
    ])
    const result = await svc.submitAnswer(quiz.id, stored[0]!.id, '0.5x²')
    expect(result.evaluation.isCorrect).toBe(true)
    expect(result.evaluation.method).toBe('math_equivalent')
  })

  it('grades numeric answers with tolerance', async () => {
    const { quiz, stored, svc } = await setupQuiz([
      { type: 'numeric', correctAnswer: '9.81', knowledgePoint: 'Gravity' },
    ])
    expect((await svc.submitAnswer(quiz.id, stored[0]!.id, '9.8')).evaluation.isCorrect).toBe(true)
  })

  it('reports NO_ACTIVE quiz gracefully when question id is unknown', async () => {
    const { quiz, svc } = await setupQuiz([{ type: 'numeric', correctAnswer: 'a' }])
    await expect(svc.submitAnswer(quiz.id, 'missing-question', 'a')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('QuizService.generateMore', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('generates a harder follow-up quiz', async () => {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const chatJSON = vi.fn().mockResolvedValue({
      data: {
        questions: [
          { prompt: 'Harder?', type: 'numeric', correctAnswer: 'x', solution: '', knowledgePoint: 'KP', difficulty: 'advanced', hints: [] },
        ],
      },
      raw: { content: '{}', model: 'm' },
    })
    const svc = buildService(db, fakeAI(chatJSON))
    const quiz = await svc.generateQuiz(project.id, {
      mode: 'topic',
      count: 1,
      difficulty: 'intermediate',
      types: ['numeric'],
      topicId,
    })
    const harder = await svc.generateMore(quiz.id, 'harder')
    expect(harder.config.difficulty).toBe('advanced')
    expect(harder.id).not.toBe(quiz.id)
  })

  it('generates an easier follow-up quiz', async () => {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const chatJSON = vi.fn().mockResolvedValue({
      data: {
        questions: [
          { prompt: 'Easier?', type: 'numeric', correctAnswer: 'x', solution: '', knowledgePoint: 'KP', difficulty: 'basic', hints: [] },
        ],
      },
      raw: { content: '{}', model: 'm' },
    })
    const svc = buildService(db, fakeAI(chatJSON))
    const quiz = await svc.generateQuiz(project.id, {
      mode: 'topic',
      count: 1,
      difficulty: 'intermediate',
      types: ['numeric'],
      topicId,
    })
    const easier = await svc.generateMore(quiz.id, 'easier')
    expect(easier.config.difficulty).toBe('basic')
  })

  it('targets weak knowledge points for weakness training', async () => {
    const { project, topicId } = await seedProjectWithAnalysis(db)
    const chatJSON = vi.fn().mockResolvedValue({
      data: {
        questions: [
          { prompt: 'Weak?', type: 'numeric', correctAnswer: 'x', solution: '', knowledgePoint: 'Chain Rule', difficulty: 'basic', hints: [] },
        ],
      },
      raw: { content: '{}', model: 'm' },
    })
    const svc = buildService(db, fakeAI(chatJSON))
    // Seed a weak mastery row.
    await new MasteryService(db).rebuild(project.id, [
      {
        id: 'a1',
        projectId: project.id,
        questionId: 'q',
        topicId,
        knowledgePoint: 'Chain Rule',
        questionType: 'numeric',
        difficulty: 'basic',
        userAnswer: 'x',
        evaluation: { isCorrect: false, method: 'exact', confidence: 1 },
        hintsUsed: 0,
        createdAt: Date.now(),
      },
    ])
    const quiz = await svc.generateQuiz(project.id, {
      mode: 'topic',
      count: 1,
      difficulty: 'adaptive',
      types: ['numeric'],
      topicId,
    })
    const more = await svc.generateMore(quiz.id, 'weakness')
    expect(more.config.mode).toBe('weakness')
    expect(more.config.topicName).toMatch(/Chain Rule|Weakness/i)
    expect(more.config.focusKnowledgePoints).toEqual(['Chain Rule'])
  })
})

describe('adaptiveHistory', () => {
  it('treats a disputed judgement as unverified', () => {
    const base = { projectId: 'p', questionId: 'q', knowledgePoint: 'K', questionType: 'numeric', difficulty: 'basic', userAnswer: 'x', hintsUsed: 0, createdAt: 1 }
    const history = [
      { ...base, id: 'a1', evaluation: { isCorrect: false, method: 'exact' as const, confidence: 1 } },
      { ...base, id: 'a2', evaluation: { isCorrect: false, method: 'rubric_ai' as const, confidence: 1, disputed: true } },
    ]
    const { recentResults, streaks } = adaptiveHistory(history)
    expect(recentResults.map((r) => r.isCorrect)).toEqual([false, null])
    expect(streaks).toEqual({ consecutiveCorrect: 0, consecutiveWrong: 1 })
  })
})
