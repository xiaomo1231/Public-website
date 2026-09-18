import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '@/infrastructure/db/database'
import { setDbForTesting } from '@/infrastructure/db/database'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProjectService } from '@/services/projectService'
import { DocumentAnalysisService } from '@/services/documentAnalysisService'
import { TutorService } from '@/services/tutorService'
import { TranslationService } from '@/services/translationService'
import { AppError } from '@/infrastructure/errors/AppError'
import type { AIService } from '@/services/aiService'

function fakeAI(handlers: {
  chat?: ReturnType<typeof vi.fn>
  chatJSON?: ReturnType<typeof vi.fn>
  streamChat?: ReturnType<typeof vi.fn>
} = {}): AIService {
  return {
    chat: handlers.chat ?? vi.fn(),
    chatJSON: handlers.chatJSON ?? vi.fn(),
    streamChat: handlers.streamChat ?? vi.fn(),
    testConnection: vi.fn(),
    currentProvider: {} as never,
    reset: vi.fn(),
  } as unknown as AIService
}

describe('DocumentAnalysisService', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('throws NO_DOCUMENTS when no processed files exist', async () => {
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new DocumentAnalysisService({
      ai: fakeAI(),
      projects,
      db,
      documents: new DocumentRepository(db),
      chunks: new ChunkRepository(db),
      analyses: new CourseAnalysisRepository(db),
    })
    await expect(svc.analyzeProject(p.id)).rejects.toMatchObject({ code: 'NO_DOCUMENTS' })
  })

  it('persists topics, formulas, and symbols from AI output', async () => {
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'Calc', subject: 'calculus' })
    const docsRepo = new DocumentRepository(db)
    const chunksRepo = new ChunkRepository(db)
    const analysesRepo = new CourseAnalysisRepository(db)

    // Seed a ready document + chunk so the pipeline has input.
    const doc = await docsRepo.create({
      projectId: p.id,
      type: 'text',
      name: 'intro.txt',
      sizeBytes: 0,
    })
    await docsRepo.update(doc.id, { status: 'ready' })
    await chunksRepo.addMany([
      {
        documentId: doc.id,
        projectId: p.id,
        contentType: 'paragraph',
        text: 'Derivatives are rates of change.',
        sourceReference: 'intro.txt',
        order: 0,
      },
    ])
    await analysesRepo.upsert({
      id: 'placeholder-analysis-id',
      projectId: p.id,
      status: 'analyzing',
      language: 'en',
      progress: 0,
      documentIds: [doc.id],
      topicCount: 0,
      formulaCount: 0,
      symbolCount: 0,
      startedAt: Date.now(),
      promptVersion: 'v1',
    })

    const ai = fakeAI({
      chatJSON: vi.fn().mockResolvedValue({
        data: {
          language: 'en',
          topics: [{ name: 'Derivatives', description: 'rate of change', sourceRefs: [{ documentId: doc.id, documentName: 'intro.txt' }] }],
          concepts: [{ name: 'Derivative', definition: 'limit of difference quotient', topicNames: ['Derivatives'], sourceRefs: [{ documentId: doc.id, documentName: 'intro.txt' }] }],
          formulas: [{ name: 'Leibniz', latex: '\\frac{df}{dx}', description: 'derivative notation', variables: [{ symbol: 'f', meaning: 'function' }], sourceRefs: [{ documentId: doc.id, documentName: 'intro.txt' }] }],
          symbols: [{ symbol: 'd', meaning: 'differential operator', context: 'calculus', sourceRefs: [{ documentId: doc.id, documentName: 'intro.txt' }] }],
          examples: [],
          exercises: [],
          prerequisites: [],
        },
        raw: { content: '{}', model: 'gpt-test' },
      }),
    })

    const svc = new DocumentAnalysisService({
      ai,
      projects,
      db,
      documents: docsRepo,
      chunks: chunksRepo,
      analyses: analysesRepo,
    })
    const result = await svc.analyzeProject(p.id, { subject: 'calculus' })
    void result

    const analysis = await analysesRepo.getByProject(p.id)
    expect(analysis?.status).toBe('ready')
    expect(analysis?.topicCount).toBe(1)
    expect(analysis?.formulaCount).toBe(1)
    expect(analysis?.symbolCount).toBe(1)

    const topics = await analysesRepo.listTopics(p.id)
    expect(topics).toHaveLength(1)
    expect(topics[0]!.name).toBe('Derivatives')

    const formulas = await analysesRepo.listFormulas(p.id)
    expect(formulas[0]!.latex).toBe('\\frac{df}{dx}')

    const symbols = await analysesRepo.listSymbols(p.id)
    expect(symbols[0]!.symbol).toBe('d')
  })
})

describe('TutorService', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function setupProject() {
    const projects = new ProjectService(db)
    const analysesRepo = new CourseAnalysisRepository(db)
    const docsRepo = new DocumentRepository(db)
    const chunksRepo = new ChunkRepository(db)
    const p = await projects.create({ name: 'Course', subject: 'calculus' })
    const doc = await docsRepo.create({ projectId: p.id, type: 'text', name: 'l.txt', sizeBytes: 0 })
    await docsRepo.update(doc.id, { status: 'ready' })
    await chunksRepo.addMany([
      {
        documentId: doc.id,
        projectId: p.id,
        contentType: 'paragraph',
        text: 'Derivatives are rates of change.',
        sourceReference: 'l.txt',
        order: 0,
      },
    ])
    const topicId = 'topic-id'
    await analysesRepo.reseedProject(
      p.id,
      {
        topics: [{ name: 'Derivatives', description: '', sourceRefs: [{ documentId: doc.id, documentName: 'l.txt' }] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Derivatives', topicId]]),
      },
      'en',
    )
    return { p, topicId, analyses: analysesRepo, chunks: chunksRepo }
  }

  it('runs begin → ask → submit happy path', async () => {
    const { p, topicId } = await setupProject()
    const ai = fakeAI({
      chat: vi.fn().mockResolvedValue({ content: 'Welcome to derivatives.', model: 'gpt-test' }),
      chatJSON: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            prompt: 'What is a derivative?',
            type: 'short_answer',
            expectedAnswer: 'rate of change',
            explanation: 'limit of difference quotient',
            knowledgePoint: 'derivative',
            difficulty: 'basic',
            sourceRefs: [],
            hints: ['think slope'],
          },
          raw: { content: '', model: 'gpt-test' },
        })
        .mockResolvedValueOnce({
          data: {
            isCorrect: true,
            partialCredit: null,
            feedback: 'great',
            breakdown: ['1'],
            nextSteps: 'try harder',
            groundedExplanation: 'derivative is rate of change',
            isSupplementary: false,
          },
          raw: { content: '', model: 'gpt-test' },
        }),
    })

    const projects = new ProjectService(db)
    const tutor = new TutorService({
      ai,
      projects,
      db,
      sessions: undefined as never,
      analyses: undefined as never,
      chunks: undefined as never,
    })
    const session = await tutor.startSession({
      projectId: p.id,
      topicId,
      topicName: 'Derivatives',
      topicDescription: '',
      language: 'en',
    })
    const intro = await tutor.beginTopic(session.id)
    expect(intro.session.turns.length).toBeGreaterThan(0)
    expect(intro.session.pendingQuestion?.prompt).toMatch(/derivative/)
    const submit = await tutor.submitAnswer(session.id, 'rate of change')
    expect(submit.session.mastery).toBeGreaterThan(0)
    expect(submit.turn.evaluation?.isCorrect).toBe(true)
  })

  it('raises NO_ACTIVE_QUESTION when submitting without a pending question', async () => {
    const { p, topicId } = await setupProject()
    const ai = fakeAI({
      chat: vi.fn().mockResolvedValue({ content: 'intro', model: 'gpt-test' }),
    })
    const projects = new ProjectService(db)
    const tutor = new TutorService({
      ai,
      projects,
      db,
      sessions: undefined as never,
      analyses: undefined as never,
      chunks: undefined as never,
    })
    const session = await tutor.startSession({
      projectId: p.id,
      topicId,
      topicName: 'Derivatives',
      topicDescription: '',
      language: 'en',
    })
    await expect(tutor.submitAnswer(session.id, 'x')).rejects.toBeInstanceOf(AppError)
  })

  it('marks feedback as supplementary when the AI says so', async () => {
    const { p, topicId } = await setupProject()
    const ai = fakeAI({
      chat: vi.fn().mockResolvedValue({ content: 'intro', model: 'gpt-test' }),
      chatJSON: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            prompt: 'Q',
            type: 'short_answer',
            expectedAnswer: 'A',
            explanation: 'E',
            knowledgePoint: 'KP',
            difficulty: 'basic',
            sourceRefs: [],
            hints: [],
          },
          raw: { content: '', model: 'gpt-test' },
        })
        .mockResolvedValueOnce({
          data: {
            isCorrect: false,
            feedback: 'missed',
            breakdown: [],
            nextSteps: 'review',
            groundedExplanation: 'extra detail',
            isSupplementary: true,
          },
          raw: { content: '', model: 'gpt-test' },
        }),
    })
    const projects = new ProjectService(db)
    const tutor = new TutorService({
      ai,
      projects,
      db,
      sessions: undefined as never,
      analyses: undefined as never,
      chunks: undefined as never,
    })
    const session = await tutor.startSession({
      projectId: p.id,
      topicId,
      topicName: 'Derivatives',
      topicDescription: '',
      language: 'en',
    })
    await tutor.beginTopic(session.id)
    const result = await tutor.submitAnswer(session.id, 'wrong')
    expect(result.turn.evaluation?.isSupplementary).toBe(true)
    expect(result.turn.content).toMatch(/Supplementary explanation/)
  })
})

describe('TranslationService', () => {
  it('translates and persists an entry', async () => {
    const ai = fakeAI({
      chatJSON: vi.fn().mockResolvedValue({
        data: { translation: '扭矩', contextNote: 'physics term', alternatives: ['力矩'] },
        raw: { content: '', model: 'gpt-test' },
      }),
    })
    const svc = new TranslationService({ ai, repo: undefined as never })
    const entry = await svc.translate({
      projectId: 'p',
      selectedText: 'moment',
      surroundingContext: 'torque and moment of inertia',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      topic: 'physics',
    })
    expect(entry.translation).toBe('扭矩')
    expect(entry.alternatives).toContain('力矩')
    expect(entry.context.topic).toBe('physics')
  })
})