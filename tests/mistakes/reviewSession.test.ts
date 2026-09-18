import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ReviewSessionService } from '@/services/reviewSessionService'
import { QuizService } from '@/services/quizService'
import { MistakeService } from '@/services/mistakeService'
import { MasteryService } from '@/services/masteryService'
import { WeaknessService } from '@/services/weaknessService'
import { ProjectService } from '@/services/projectService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import type { AIService } from '@/services/aiService'

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

function generated(questions: Array<{ prompt: string; kp: string; answer: string }>) {
  return {
    data: {
      questions: questions.map((q) => ({
        prompt: q.prompt,
        type: 'short_answer',
        correctAnswer: q.answer,
        solution: '',
        knowledgePoint: q.kp,
        difficulty: 'basic',
        hints: [],
      })),
    },
    raw: { content: '{}', model: 'm' },
  }
}

async function setup() {
  const db = new AppDatabase()
  setDbForTesting(db)
  const projects = new ProjectService(db)
  const p = await projects.create({ name: 'Calculus', subject: 'calculus' })
  const docs = new DocumentRepository(db)
  const chunks = new ChunkRepository(db)
  const analyses = new CourseAnalysisRepository(db)
  const doc = await docs.create({ projectId: p.id, type: 'text', name: 'c.txt', sizeBytes: 0 })
  await docs.update(doc.id, { status: 'ready' })
  await chunks.addMany([
    {
      documentId: doc.id,
      projectId: p.id,
      contentType: 'paragraph',
      text: 'The chain rule differentiates composite functions.',
      sourceReference: 'c.txt',
      order: 0,
    },
  ])
  await analyses.reseedProject(
    p.id,
    {
      topics: [{ name: 'Differentiation', description: '', sourceRefs: [{ documentId: doc.id, documentName: 'c.txt' }] }],
      concepts: [
        { name: 'Chain Rule', definition: '', topicNames: ['Differentiation'], sourceRefs: [{ documentId: doc.id, documentName: 'c.txt' }] },
      ],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map([['Differentiation', 'topic-1']]),
    },
    'en',
  )
  const mistakes = new MistakeService(db)
  const mastery = new MasteryService(db)
  const weakness = new WeaknessService(db)
  const quiz = new QuizService({
    ai: fakeAI(vi.fn()),
    db,
    questions: new QuestionRepository(db),
    attempts: new QuestionAttemptRepository(db),
    quizzes: new QuizRepository(db),
    analyses,
    chunks,
    mastery,
    mistakes,
  })
  const review = new ReviewSessionService({ quiz, mistakes, weakness, db })
  return { db, project: p, mistakes, mastery, quiz, review }
}

describe('ReviewSessionService', () => {
  let ctx: Awaited<ReturnType<typeof setup>>

  beforeEach(async () => {
    ctx = await setup()
  })

  it('throws NO_MISTAKES when the book is empty', async () => {
    await expect(ctx.review.createReviewSession(ctx.project.id)).rejects.toMatchObject({ code: 'NO_MISTAKES' })
  })

  it('creates a review session weighted toward weak knowledge points', async () => {
    await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q2', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q3', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Limits' })

    const chatJSON = vi.fn().mockResolvedValue(
      generated([
        { prompt: 'Chain rule practice', kp: 'Chain Rule', answer: 'x' },
        { prompt: 'Another chain rule', kp: 'Chain Rule', answer: 'y' },
      ]),
    )
    // Swap in a quiz service with a working AI.
    const quiz = new QuizService({
      ai: fakeAI(chatJSON),
      db: ctx.db,
      questions: new QuestionRepository(ctx.db),
      attempts: new QuestionAttemptRepository(ctx.db),
      quizzes: new QuizRepository(ctx.db),
      analyses: new CourseAnalysisRepository(ctx.db),
      chunks: new ChunkRepository(ctx.db),
      mastery: ctx.mastery,
      mistakes: ctx.mistakes,
    })
    const review = new ReviewSessionService({ quiz, mistakes: ctx.mistakes, db: ctx.db })

    const session = await review.createReviewSession(ctx.project.id, { count: 2 })
    expect(session.config.mode).toBe('review')
    expect(session.config.difficulty).toBe('adaptive')
    expect(session.config.focusKnowledgePoints).toContain('Chain Rule')
    expect(session.questionIds).toHaveLength(2)
  })

  it('honours the requested question count and difficulty', async () => {
    await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    const chatJSON = vi.fn().mockResolvedValue(
      generated([{ prompt: 'P1', kp: 'Chain Rule', answer: 'a' }, { prompt: 'P2', kp: 'Chain Rule', answer: 'b' }, { prompt: 'P3', kp: 'Chain Rule', answer: 'c' }]),
    )
    const quiz = new QuizService({
      ai: fakeAI(chatJSON),
      db: ctx.db,
      questions: new QuestionRepository(ctx.db),
      attempts: new QuestionAttemptRepository(ctx.db),
      quizzes: new QuizRepository(ctx.db),
      analyses: new CourseAnalysisRepository(ctx.db),
      chunks: new ChunkRepository(ctx.db),
      mastery: ctx.mastery,
      mistakes: ctx.mistakes,
    })
    const review = new ReviewSessionService({ quiz, mistakes: ctx.mistakes, db: ctx.db })
    const session = await review.createReviewSession(ctx.project.id, { count: 3, difficulty: 'intermediate' })
    expect(session.config.count).toBe(3)
    expect(session.config.difficulty).toBe('intermediate')
    expect(session.questionIds).toHaveLength(3)
  })

  it('excludes archived mistakes from review candidates', async () => {
    const m = await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await ctx.mistakes.archive(m.id)
    await expect(ctx.review.createReviewSession(ctx.project.id)).rejects.toMatchObject({ code: 'NO_MISTAKES' })
  })

  it('generates practice for a single mistake — same concept', async () => {
    const m = await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule', difficulty: 'intermediate' })
    const chatJSON = vi.fn().mockResolvedValue(generated([{ prompt: 'Same concept', kp: 'Chain Rule', answer: 'a' }]))
    const quiz = new QuizService({
      ai: fakeAI(chatJSON),
      db: ctx.db,
      questions: new QuestionRepository(ctx.db),
      attempts: new QuestionAttemptRepository(ctx.db),
      quizzes: new QuizRepository(ctx.db),
      analyses: new CourseAnalysisRepository(ctx.db),
      chunks: new ChunkRepository(ctx.db),
      mastery: ctx.mastery,
      mistakes: ctx.mistakes,
    })
    const review = new ReviewSessionService({ quiz, mistakes: ctx.mistakes, db: ctx.db })
    const session = await review.practiceMistake(m.id, 'same_concept')
    expect(session.config.focusKnowledgePoints).toEqual(['Chain Rule'])
    expect(session.config.sourceMistakeId).toBe(m.id)
    expect(session.config.topicName).toMatch(/Chain Rule/)
  })

  it('raises the difficulty for "harder" practice', async () => {
    const m = await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule', difficulty: 'intermediate' })
    const chatJSON = vi.fn().mockResolvedValue(generated([{ prompt: 'Harder', kp: 'Chain Rule', answer: 'a' }]))
    const quiz = new QuizService({
      ai: fakeAI(chatJSON),
      db: ctx.db,
      questions: new QuestionRepository(ctx.db),
      attempts: new QuestionAttemptRepository(ctx.db),
      quizzes: new QuizRepository(ctx.db),
      analyses: new CourseAnalysisRepository(ctx.db),
      chunks: new ChunkRepository(ctx.db),
      mastery: ctx.mastery,
      mistakes: ctx.mistakes,
    })
    const review = new ReviewSessionService({ quiz, mistakes: ctx.mistakes, db: ctx.db })
    const session = await review.practiceMistake(m.id, 'harder')
    expect(session.config.difficulty).toBe('advanced')
  })

  it('lowers the difficulty for "easier" practice', async () => {
    const m = await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule', difficulty: 'advanced' })
    const chatJSON = vi.fn().mockResolvedValue(generated([{ prompt: 'Easier', kp: 'Chain Rule', answer: 'a' }]))
    const quiz = new QuizService({
      ai: fakeAI(chatJSON),
      db: ctx.db,
      questions: new QuestionRepository(ctx.db),
      attempts: new QuestionAttemptRepository(ctx.db),
      quizzes: new QuizRepository(ctx.db),
      analyses: new CourseAnalysisRepository(ctx.db),
      chunks: new ChunkRepository(ctx.db),
      mastery: ctx.mastery,
      mistakes: ctx.mistakes,
    })
    const review = new ReviewSessionService({ quiz, mistakes: ctx.mistakes, db: ctx.db })
    const session = await review.practiceMistake(m.id, 'easier')
    expect(session.config.difficulty).toBe('intermediate')
  })

  it('builds weakness training from multiple mistakes', async () => {
    const m = await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await ctx.mistakes.addManual({ projectId: ctx.project.id, question: 'Q2', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Limits' })
    const chatJSON = vi.fn().mockResolvedValue(generated([{ prompt: 'Weakness', kp: 'Chain Rule', answer: 'a' }]))
    const quiz = new QuizService({
      ai: fakeAI(chatJSON),
      db: ctx.db,
      questions: new QuestionRepository(ctx.db),
      attempts: new QuestionAttemptRepository(ctx.db),
      quizzes: new QuizRepository(ctx.db),
      analyses: new CourseAnalysisRepository(ctx.db),
      chunks: new ChunkRepository(ctx.db),
      mastery: ctx.mastery,
      mistakes: ctx.mistakes,
    })
    const review = new ReviewSessionService({ quiz, mistakes: ctx.mistakes, db: ctx.db })
    const session = await review.practiceMistake(m.id, 'weakness')
    expect(session.config.mode).toBe('weakness')
    expect(session.config.focusKnowledgePoints!.length).toBeGreaterThan(1)
  })

  it('throws NOT_FOUND for an unknown mistake', async () => {
    await expect(ctx.review.practiceMistake('missing', 'same_concept')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})