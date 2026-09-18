import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentService } from '@/services/documentService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { MistakeService } from '@/services/mistakeService'
import { QuizService } from '@/services/quizService'
import { QuizRepository } from '@/entities/quiz/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { MasteryService } from '@/services/masteryService'
import { TutorService } from '@/services/tutorService'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { TranslationRepository } from '@/entities/translation/repository'
import { WeaknessService } from '@/services/weaknessService'
import { DataManagementService } from '@/services/dataManagementService'
import { NotFoundError } from '@/infrastructure/errors/AppError'
import type { AIService } from '@/services/aiService'

const NOOP_AI = {
  chatJSON: vi.fn(),
  chat: vi.fn(),
  streamChat: vi.fn(),
  testConnection: vi.fn(),
  reset: vi.fn(),
  currentProvider: {},
} as unknown as AIService

const MISSING_PROJECT = 'project-that-does-not-exist'

describe('Unauthorized project access', () => {
  let db: AppDatabase
  let projects: ProjectService

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
  })

  it('document service refuses to create documents for an unknown project', async () => {
    const svc = new DocumentService({
      documents: new DocumentRepository(db),
      projects,
    })
    await expect(
      svc.create({ projectId: MISSING_PROJECT, type: 'text', name: 'x.txt', sizeBytes: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('document service reports a foreign document as not-in-project', async () => {
    const a = await projects.create({ name: 'A', subject: 'cs' })
    const b = await projects.create({ name: 'B', subject: 'physics' })
    const repo = new DocumentRepository(db)
    const doc = await repo.create({ projectId: a.id, type: 'text', name: 'a.txt', sizeBytes: 0 })
    const svc = new DocumentService({ documents: repo, projects })

    expect(await svc.existsInProject(doc.id, a.id)).toBe(true)
    expect(await svc.existsInProject(doc.id, b.id)).toBe(false)
    expect(await svc.existsInProject('missing', a.id)).toBe(false)
  })

  it('quiz generation refuses an unknown project', async () => {
    const quiz = new QuizService({
      ai: NOOP_AI,
      db,
      questions: new QuestionRepository(db),
      attempts: new QuestionAttemptRepository(db),
      quizzes: new QuizRepository(db),
      analyses: new CourseAnalysisRepository(db),
      chunks: new ChunkRepository(db),
      mastery: new MasteryService(db),
      projects,
    })
    await expect(
      quiz.generateQuiz(MISSING_PROJECT, {
        mode: 'mixed',
        count: 3,
        difficulty: 'adaptive',
        types: ['short_answer'],
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('tutor refuses to start a session for an unknown project', async () => {
    const tutor = new TutorService({
      ai: NOOP_AI,
      db,
      projects,
      sessions: new TutorSessionRepository(db),
      analyses: new CourseAnalysisRepository(db),
      chunks: new ChunkRepository(db),
    })
    await expect(
      tutor.startSession({
        projectId: MISSING_PROJECT,
        topicId: 't1',
        topicName: 'T',
        topicDescription: '',
        language: 'en',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('mistake service returns nothing for an unknown project', async () => {
    const mistakes = new MistakeService(db)
    expect(await mistakes.list(MISSING_PROJECT)).toEqual([])
    expect((await mistakes.stats(MISSING_PROJECT)).total).toBe(0)
  })

  it('weakness analysis returns nothing for an unknown project', async () => {
    const report = await new WeaknessService(db).analyze(MISSING_PROJECT)
    expect(report.areas).toEqual([])
    expect(report.totalMistakes).toBe(0)
  })
})

describe('Cross-project data isolation', () => {
  let db: AppDatabase
  let a: { id: string }
  let b: { id: string }

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projects = new ProjectService(db)
    a = await projects.create({ name: 'Calculus', subject: 'calculus' })
    b = await projects.create({ name: 'Physics', subject: 'physics' })
  })

  it('documents and chunks never bleed across projects', async () => {
    const docs = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    await docs.create({ projectId: a.id, type: 'text', name: 'a.txt', sizeBytes: 0 })
    await chunks.addMany([
      {
        documentId: 'da',
        projectId: a.id,
        contentType: 'paragraph',
        text: 'alpha-only-marker',
        sourceReference: 'a',
        order: 0,
      },
    ])
    await docs.create({ projectId: b.id, type: 'text', name: 'b.txt', sizeBytes: 0 })
    await chunks.addMany([
      {
        documentId: 'db',
        projectId: b.id,
        contentType: 'paragraph',
        text: 'beta-only-marker',
        sourceReference: 'b',
        order: 0,
      },
    ])

    expect((await docs.listByProject(a.id)).map((d) => d.name)).toEqual(['a.txt'])
    expect((await docs.listByProject(b.id)).map((d) => d.name)).toEqual(['b.txt'])
    expect(await chunks.searchByProject(a.id, 'beta-only-marker')).toHaveLength(0)
    expect(await chunks.searchByProject(b.id, 'alpha-only-marker')).toHaveLength(0)
  })

  it('mistakes never bleed across projects', async () => {
    const mistakes = new MistakeService(db)
    await mistakes.addManual({
      projectId: a.id,
      question: 'QA',
      studentAnswer: 'x',
      correctAnswer: 'y',
      knowledgePoint: 'KP-A',
    })
    expect(await mistakes.list(a.id)).toHaveLength(1)
    expect(await mistakes.list(b.id)).toHaveLength(0)
  })

  it('mastery never bleeds across projects', async () => {
    const mastery = new MasteryService(db)
    await mastery.record({
      id: 'x',
      projectId: a.id,
      questionId: 'q',
      knowledgePoint: 'Shared',
      questionType: 'short_answer',
      difficulty: 'basic',
      userAnswer: 'a',
      evaluation: { isCorrect: true, method: 'exact', confidence: 1 },
      hintsUsed: 0,
      createdAt: Date.now(),
    })
    expect(await mastery.listByProject(a.id)).toHaveLength(1)
    expect(await mastery.listByProject(b.id)).toHaveLength(0)
    // Even a same-named knowledge point stays scoped.
    expect(await mastery.get(b.id, 'Shared')).toBeUndefined()
  })

  it('translations never bleed across projects', async () => {
    const repo = new TranslationRepository(db)
    await repo.add({
      id: 't1',
      projectId: a.id,
      sourceText: 'moment',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      translation: '力矩',
      contextNote: '',
      alternatives: [],
      context: { surrounding: '' },
      createdAt: Date.now(),
    })
    expect(await repo.listByProject(a.id)).toHaveLength(1)
    expect(await repo.listByProject(b.id)).toHaveLength(0)
  })

  it('deleting one project leaves the other untouched', async () => {
    const docs = new DocumentRepository(db)
    const mistakes = new MistakeService(db)
    await docs.create({ projectId: a.id, type: 'text', name: 'a.txt', sizeBytes: 1, blob: new Blob(['x']) })
    await docs.create({ projectId: b.id, type: 'text', name: 'b.txt', sizeBytes: 1, blob: new Blob(['y']) })
    await mistakes.addManual({
      projectId: a.id,
      question: 'QA',
      studentAnswer: 'x',
      correctAnswer: 'y',
      knowledgePoint: 'KP',
    })

    await new DataManagementService(db).deleteProject(a.id)

    expect(await docs.listByProject(a.id)).toHaveLength(0)
    expect(await mistakes.list(a.id)).toHaveLength(0)
    expect(await docs.listByProject(b.id)).toHaveLength(1)
    expect(await new ProjectService(db).get(b.id)).toBeDefined()
  })
})
