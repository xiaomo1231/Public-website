import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { TutorService } from '@/services/tutorService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { AIService } from '@/services/aiService'
import type { MistakeService } from '@/services/mistakeService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { AIProviderError } from '@/infrastructure/ai/errors'
import { AppError } from '@/infrastructure/errors/AppError'
import { friendlyTutorError } from '@/shared/lib/aiErrors'

/**
 * Regression guard for the tutor being coupled to question generation.
 *
 * `beginTopic` used to `return this.askQuestion(...)`, so a model that failed to
 * emit a JSON question made the *whole* tutor fail 鈥?the student saw
 * "Tutor unavailable / the AI did not return a usable question" even though the
 * explanation had already been streamed successfully. The explanation and the
 * practice question must now fail independently.
 */

const VALID_QUESTION = {
  prompt: 'What is a derivative?',
  type: 'numeric',
  expectedAnswer: 'rate of change',
  explanation: 'It measures how fast a function changes.',
  knowledgePoint: 'Derivatives',
  difficulty: 'basic',
  sourceRefs: [],
  hints: ['Think about slope'],
}

interface StubOptions {
  intro?: string
  introError?: unknown
  question?: unknown
  questionError?: unknown
}

function stubAI(opts: StubOptions = {}) {
  const intro = opts.intro ?? 'A derivative measures how a function changes.'
  const streamChat = vi.fn(async (_m: unknown, onDelta?: (d: string) => void) => {
    if (opts.introError) throw opts.introError
    const parts = intro.split(' ')
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      const delta = (i === 0 ? '' : ' ') + parts[i]
      acc += delta
      onDelta?.(delta)
    }
    return { content: acc, model: 'fake' }
  })
  const chat = vi.fn(async (_messages: ChatMessage[]) => {
    if (opts.introError) throw opts.introError
    return { content: intro, model: 'fake' }
  })
  const chatJSON = vi.fn(async (_messages: ChatMessage[], _options?: unknown) => {
    if (opts.questionError) throw opts.questionError
    return { data: opts.question ?? VALID_QUESTION, raw: { content: '{}', model: 'fake' } }
  })
  const ai = {
    chat,
    chatJSON,
    streamChat,
    testConnection: vi.fn(),
    reset: vi.fn(),
    currentProvider: { id: 'fake' },
  } as unknown as AIService
  return { ai, chat, chatJSON, streamChat }
}

describe('TutorService 鈥?explanation and question are independent', () => {
  let db: AppDatabase
  let projectId: string
  let topicId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'Calculus', subject: 'calculus' })
    projectId = p.id

    const docs = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    const doc = await docs.create({ projectId, type: 'text', name: 'c.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    const stored = await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'The derivative measures the rate of change of a function.',
        sourceReference: 'c.txt',
        order: 0,
      },
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'Unrelated material about integration by parts and series convergence.',
        sourceReference: 'c.txt',
        order: 1,
      },
    ])

    const analyses = new CourseAnalysisRepository(db)
    topicId = 'topic-derivatives'
    await analyses.reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Derivatives',
            description: 'Rates of change.',
            sourceRefs: [
              {
                documentId: doc.id,
                documentName: 'c.txt',
                quote: 'The derivative measures the rate of change',
              },
            ],
          },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Derivatives', topicId]]),
        documentIds: [doc.id],
      },
      'en',
    )
    void stored
  })

  async function makeTutor(ai: AIService) {
    return new TutorService({ ai, db, projects: new ProjectService(db) })
  }

  async function start(tutor: TutorService) {
    return tutor.startSession({
      projectId,
      topicId,
      topicName: 'Derivatives',
      topicDescription: 'Rates of change.',
      language: 'en',
    })
  }

  it('streams the explanation and generates the first question', async () => {
    const { ai, streamChat } = stubAI()
    const tutor = await makeTutor(ai)
    const session = await start(tutor)

    const deltas: string[] = []
    const result = await tutor.beginTopic(session.id, { onDelta: (d) => deltas.push(d) })

    expect(streamChat).toHaveBeenCalledTimes(1)
    expect(deltas.join('')).toBe('A derivative measures how a function changes.')
    expect(result.session.turns.find((t) => t.kind === 'introduction')?.content).toContain(
      'A derivative measures',
    )
    expect(result.session.pendingQuestion?.prompt).toBe('What is a derivative?')
    expect(result.questionError).toBeUndefined()
  })

  it('keeps the lesson when the question half fails (the original bug)', async () => {
    const { ai } = stubAI({
      questionError: new Error('model returned prose instead of JSON'),
    })
    const tutor = await makeTutor(ai)
    const session = await start(tutor)

    // Must resolve, not throw 鈥?the explanation already succeeded.
    const result = await tutor.beginTopic(session.id)

    expect(result.session.turns.find((t) => t.kind === 'introduction')?.content).toContain(
      'A derivative measures',
    )
    expect(result.session.pendingQuestion).toBeUndefined()
    expect(result.questionError).toBeTruthy()
  })

  it('surfaces an unreadable question as a parsing message, not a tutor outage', async () => {
    const { ai } = stubAI({ question: { unexpected: 'shape' } })
    const tutor = await makeTutor(ai)
    const session = await start(tutor)

    const result = await tutor.beginTopic(session.id)

    expect(result.session.pendingQuestion).toBeUndefined()
    expect(result.questionError).toBe('The AI tutor returned data that could not be read. Please try again.')
  })

  it('does not fail the question half when the quiz-style output is empty', async () => {
    const { ai } = stubAI({ question: { prompt: '', expectedAnswer: '' } })
    const tutor = await makeTutor(ai)
    const session = await start(tutor)

    const result = await tutor.beginTopic(session.id)
    expect(result.questionError).toBeTruthy()
    expect(result.session.turns.some((t) => t.kind === 'introduction')).toBe(true)
  })

  it('fails when the AI returns no explanation at all', async () => {
    const { ai } = stubAI({ intro: '   ' })
    const tutor = await makeTutor(ai)
    const session = await start(tutor)

    await expect(tutor.beginTopic(session.id)).rejects.toMatchObject({
      code: 'EMPTY_TUTOR_RESPONSE',
    })
  })

  it('propagates a provider failure from the explanation request', async () => {
    const { ai } = stubAI({
      introError: new AIProviderError('upstream down', 'PROVIDER_UNAVAILABLE'),
    })
    const tutor = await makeTutor(ai)
    const session = await start(tutor)

    await expect(tutor.beginTopic(session.id)).rejects.toBeInstanceOf(AIProviderError)
  })

  it('reports a missing topic content instead of a question error', async () => {
    const projects = new ProjectService(db)
    const empty = await projects.create({ name: 'Empty', subject: 'calculus' })
    const analyses = new CourseAnalysisRepository(db)
    const emptyTopicId = 'topic-empty'
    await analyses.reseedProject(
      empty.id,
      {
        topics: [{ name: 'Nothing', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Nothing', emptyTopicId]]),
        documentIds: [],
      },
      'en',
    )

    const { ai } = stubAI()
    const tutor = new TutorService({ ai, db, projects })
    const session = await tutor.startSession({
      projectId: empty.id,
      topicId: emptyTopicId,
      topicName: 'Nothing',
      topicDescription: '',
      language: 'en',
    })

    const result = await tutor.beginTopic(session.id)
    expect(result.session.pendingQuestion).toBeUndefined()
    expect(result.questionError).toBe('This topic has no course content to explain.')

    // An explicit askQuestion is a hard failure the caller can retry.
    await expect(tutor.askQuestion(session.id)).rejects.toMatchObject({
      code: 'NO_TOPIC_CONTENT',
    })
  })

  it('asks questions without a pending question left behind on failure', async () => {
    const { ai, chatJSON } = stubAI()
    const tutor = await makeTutor(ai)
    const session = await start(tutor)
    await tutor.beginTopic(session.id)

    chatJSON.mockResolvedValueOnce({ data: { prompt: '' }, raw: { content: '{}', model: 'fake' } })
    await expect(tutor.askQuestion(session.id)).rejects.toMatchObject({
      code: 'MALFORMED_QUESTION',
    })
  })

  it('carries the topic description into the prompt instead of an empty string', async () => {
    const { ai, chatJSON } = stubAI()
    const tutor = await makeTutor(ai)
    const session = await start(tutor)
    await tutor.beginTopic(session.id)

    const messages = chatJSON.mock.calls[0]?.[0] ?? []
    expect(messages[1]?.content).toContain('Description: Rates of change.')
  })
})

describe('TutorService.collectSources 鈥?grounded in the topic, not the project', () => {
  let db: AppDatabase
  let projectId: string
  let topicId: string
  let docId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'Calculus', subject: 'calculus' })
    projectId = p.id

    const docs = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    const doc = await docs.create({ projectId, type: 'text', name: 'c.txt', sizeBytes: 0 })
    docId = doc.id
    await docs.update(doc.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'The derivative measures the instantaneous rate of change.',
        sourceReference: 'c.txt',
        order: 0,
      },
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'Integration by parts reverses the product rule.',
        sourceReference: 'c.txt',
        order: 1,
      },
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'A geometric series converges when the ratio is below one.',
        sourceReference: 'c.txt',
        order: 2,
      },
    ])

    const analyses = new CourseAnalysisRepository(db)
    topicId = 'topic-derivatives'
    await analyses.reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Derivatives',
            description: '',
            // The analyser cites an excerpt rather than a chunk id.
            sourceRefs: [
              {
                documentId: doc.id,
                documentName: 'c.txt',
                quote: 'The derivative measures the instantaneous rate of change.',
              },
            ],
          },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Derivatives', topicId]]),
        documentIds: [doc.id],
      },
      'en',
    )
  })

  it('grounds the prompt in the chunk the topic actually cited', async () => {
    const { ai, chatJSON } = stubAI()
    const tutor = new TutorService({ ai, db, projects: new ProjectService(db) })
    const session = await tutor.startSession({
      projectId,
      topicId,
      topicName: 'Derivatives',
      topicDescription: '',
      language: 'en',
    })

    await tutor.beginTopic(session.id)

    const messages = chatJSON.mock.calls[0]?.[0] ?? []
    const prompt = messages[1]?.content ?? ''
    expect(prompt).toContain('instantaneous rate of change')
    // Unrelated chunks from the same document must not crowd the prompt.
    expect(prompt).not.toContain('Integration by parts')
    expect(prompt).not.toContain('geometric series')
  })

  it('prefers an explicit chunk id when the reference carries one', async () => {
    const analyses = new CourseAnalysisRepository(db)
    const chunks = new ChunkRepository(db)
    const all = await chunks.listByDocument(docId)
    const target = all.find((c) => c.text.includes('geometric series'))!

    await analyses.addTopics([
      {
        id: 'topic-series',
        projectId,
        name: 'Series',
        description: '',
        order: 1,
        sourceRefs: [
          { documentId: docId, documentName: 'c.txt', chunkId: target.id, quote: 'geometric series' },
        ],
        createdAt: Date.now(),
      },
    ])

    const { ai, chatJSON } = stubAI()
    const tutor = new TutorService({ ai, db, projects: new ProjectService(db) })
    const session = await tutor.startSession({
      projectId,
      topicId: 'topic-series',
      topicName: 'Series',
      topicDescription: '',
      language: 'en',
    })

    await tutor.beginTopic(session.id)

    const messages = chatJSON.mock.calls[0]?.[0] ?? []
    expect(messages[1]?.content).toContain('geometric series')
    expect(messages[1]?.content).not.toContain('instantaneous rate of change')
  })
})

describe('Tutor is architecturally independent of Quiz', () => {
  it('does not depend on the quiz service at all', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'src/services/tutorService.ts'), 'utf8')
    // Course Analysis feeds the tutor and the quiz as siblings. If the tutor
    // ever reaches into the quiz again, the failure of one would take down the
    // other 鈥?the exact bug this suite guards against.
    expect(source).not.toMatch(/quizService/)
    expect(source).not.toMatch(/\bQuizService\b/)
    expect(source).not.toMatch(/generateQuiz/)
  })

  it('keeps the lesson running when the mistake book fails', async () => {
    const db2 = new AppDatabase()
    setDbForTesting(db2)
    const projects = new ProjectService(db2)
    const p = await projects.create({ name: 'Calculus', subject: 'calculus' })
    const docs = new DocumentRepository(db2)
    const chunks = new ChunkRepository(db2)
    const doc = await docs.create({ projectId: p.id, type: 'text', name: 'c.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId: p.id,
        contentType: 'paragraph',
        text: 'The derivative measures the rate of change of a function.',
        sourceReference: 'c.txt',
        order: 0,
      },
    ])
    const analyses = new CourseAnalysisRepository(db2)
    const topicId = 'topic-1'
    await analyses.reseedProject(
      p.id,
      {
        topics: [
          { name: 'Derivatives', description: '', sourceRefs: [{ documentId: doc.id, documentName: 'c.txt' }] },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Derivatives', topicId]]),
        documentIds: [doc.id],
      },
      'en',
    )

    const { ai } = stubAI()
    const recordFromAttempt = vi.fn().mockRejectedValue(new Error('book unavailable'))
    const mistakes = { recordFromAttempt } as unknown as MistakeService
    const tutor = new TutorService({ ai, db: db2, projects, mistakes })
    const session = await tutor.startSession({
      projectId: p.id,
      topicId,
      topicName: 'Derivatives',
      topicDescription: '',
      language: 'en',
    })
    await tutor.beginTopic(session.id)

    const { ai: wrongAI } = stubAI({
      question: { ...VALID_QUESTION, type: 'numeric', expectedAnswer: '42' },
    })
    vi.mocked(wrongAI.chatJSON).mockResolvedValue({
      data: {
        isCorrect: false,
        feedback: 'Not quite.',
        breakdown: [],
        nextSteps: 'Try again.',
        groundedExplanation: 'A derivative is a rate of change.',
        isSupplementary: false,
      },
      raw: { content: '{}', model: 'fake' },
    } as never)

    // Re-run the wrong-answer path against a broken mistake book.
    const tutor2 = new TutorService({ ai: wrongAI, db: db2, projects, mistakes })
    const result = await tutor2.submitAnswer(session.id, '41')

    expect(result.turn.evaluation?.isCorrect).toBe(false)
    expect(recordFromAttempt).toHaveBeenCalled()
  })
})

describe('friendlyTutorError', () => {
  it('maps tutor-specific failures to their own messages', () => {
    expect(friendlyTutorError(new AppError('x', 'NO_TOPIC_CONTENT'))).toBe(
      'This topic has no course content to explain.',
    )
    expect(friendlyTutorError(new AppError('x', 'EMPTY_TUTOR_RESPONSE'))).toBe(
      'The AI tutor returned no explanation.',
    )
    expect(friendlyTutorError(new AppError('x', 'MALFORMED_QUESTION'))).toBe(
      'The AI tutor returned data that could not be read. Please try again.',
    )
  })

  it('maps provider timeouts and outages', () => {
    expect(friendlyTutorError(new AIProviderError('slow', 'TIMEOUT'))).toBe(
      'The AI tutor timed out. Please try again in a moment.',
    )
    expect(friendlyTutorError(new AIProviderError('down', 'PROVIDER_UNAVAILABLE'))).toBe(
      'The AI tutor cannot reach the AI service right now.',
    )
  })
})
