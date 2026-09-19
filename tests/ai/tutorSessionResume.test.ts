import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { TutorService } from '@/services/tutorService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { AIService } from '@/services/aiService'

const QUESTION = {
  prompt: 'What is A cap B?',
  type: 'numeric',
  expectedAnswer: 'the intersection',
  explanation: '',
  knowledgePoint: 'Sets',
  difficulty: 'basic',
  sourceRefs: [],
  hints: [],
}

function stubAI() {
  const chat = vi.fn().mockResolvedValue({ content: 'Intro text', model: 'fake' })
  const chatJSON = vi.fn().mockResolvedValue({
    data: QUESTION,
    raw: { content: '{}', model: 'fake' },
  })
  const streamChat = vi.fn(async (_m: unknown, onDelta: (d: string) => void) => {
    onDelta('Intro text')
    return { content: 'Intro text', model: 'fake' }
  })
  return {
    chat,
    chatJSON,
    streamChat,
    ai: { chat, chatJSON, streamChat, currentProvider: { id: 'fake' } } as unknown as AIService,
  }
}

describe('Interactive Tutor session resume', () => {
  let db: AppDatabase
  let projects: ProjectService
  let projectId: string
  let topicId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
    const project = await projects.create({ name: 'Sets', subject: 'calculus' })
    projectId = project.id

    const docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId, type: 'text', name: 'sets.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    const chunks = new ChunkRepository(db)
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'The intersection of A and B contains the shared elements.',
        sourceReference: 'sets.txt',
        order: 0,
      },
    ])

    const analyses = new CourseAnalysisRepository(db)
    topicId = 'topic-sets'
    await analyses.reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Set Operations',
            description: '',
            sourceRefs: [{ documentId: doc.id, documentName: 'sets.txt' }],
          },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Set Operations', topicId]]),
        documentIds: [doc.id],
      },
      'en',
    )
  })

  const input = () => ({
    projectId,
    topicId,
    topicName: 'Set Operations',
    topicDescription: '',
    language: 'en' as const,
  })

  it('starts a new session the first time', async () => {
    const { ai } = stubAI()
    const tutor = new TutorService({ ai, db, projects })

    const { session, resumed } = await tutor.findOrStartSession(input())

    expect(resumed).toBe(false)
    expect(session.turns).toHaveLength(0)
  })

  it('resumes the existing conversation on the next visit', async () => {
    const { ai, chat } = stubAI()
    const tutor = new TutorService({ ai, db, projects })

    const first = await tutor.findOrStartSession(input())
    await tutor.beginTopic(first.session.id)
    const callsAfterFirstVisit = chat.mock.calls.length

    // Reopening the page must not start over.
    const second = await tutor.findOrStartSession(input())

    expect(second.resumed).toBe(true)
    expect(second.session.id).toBe(first.session.id)
    expect(second.session.turns.length).toBeGreaterThan(0)
    // The introduction was generated exactly once, and resuming added nothing.
    expect(chat.mock.calls.length).toBe(callsAfterFirstVisit)
  })

  it('keeps a separate conversation per language', async () => {
    const { ai } = stubAI()
    const tutor = new TutorService({ ai, db, projects })

    const english = await tutor.findOrStartSession(input())
    await tutor.beginTopic(english.session.id)

    const chinese = await tutor.findOrStartSession({ ...input(), language: 'zh' })

    expect(chinese.resumed).toBe(false)
    expect(chinese.session.id).not.toBe(english.session.id)
  })

  it('does not resume an abandoned conversation', async () => {
    const { ai } = stubAI()
    const tutor = new TutorService({ ai, db, projects })

    const first = await tutor.findOrStartSession(input())
    await tutor.beginTopic(first.session.id)
    await tutor.abandon(first.session.id)

    const next = await tutor.findOrStartSession(input())
    expect(next.resumed).toBe(false)
  })
})
