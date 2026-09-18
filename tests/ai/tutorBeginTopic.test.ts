import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { TutorService } from '@/services/tutorService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { AIService } from '@/services/aiService'

/**
 * Regression guard for the tutor introduction being generated twice.
 *
 * `beginTopic` used to call `chat()` internally while the panel separately
 * called `streamChat()` — two billed AI requests and two potentially
 * different introductions. It must now make exactly one call.
 */
function scriptedAI(streamedText: string) {
  const chat = vi.fn().mockResolvedValue({ content: 'NON-STREAMED INTRO', model: 'fake' })
  const streamChat = vi.fn(
    async (
      _messages: unknown,
      onDelta: (delta: string) => void,
    ): Promise<{ content: string; model: string }> => {
      const parts = streamedText.split(' ')
      let acc = ''
      for (let i = 0; i < parts.length; i++) {
        const delta = (i === 0 ? '' : ' ') + parts[i]
        acc += delta
        onDelta(delta)
      }
      return { content: acc, model: 'fake' }
    },
  )
  const ai = {
    chat,
    chatJSON: vi.fn().mockResolvedValue({
      data: {
        prompt: 'What is a derivative?',
        type: 'short_answer',
        expectedAnswer: 'rate of change',
        explanation: '',
        knowledgePoint: 'Derivatives',
        difficulty: 'basic',
        sourceRefs: [],
        hints: [],
      },
      raw: { content: '{}', model: 'fake' },
    }),
    streamChat,
    testConnection: vi.fn(),
    reset: vi.fn(),
    currentProvider: {},
  } as unknown as AIService
  return { ai, chat, streamChat }
}

describe('TutorService.beginTopic — single AI call', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function setup() {
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
        text: 'The derivative measures the rate of change of a function.',
        sourceReference: 'c.txt',
        order: 0,
      },
    ])
    const topicId = 'topic-1'
    await analyses.reseedProject(
      p.id,
      {
        topics: [{ name: 'Derivatives', description: '', sourceRefs: [{ documentId: doc.id, documentName: 'c.txt' }] }],
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
    return { project: p, topicId, projects, docs, chunks, analyses }
  }

  it('streams the introduction and persists the streamed text (one call)', async () => {
    const { project, topicId, projects, docs, chunks, analyses } = await setup()
    const streamedText = 'A derivative measures how a function changes.'
    const { ai, chat, streamChat } = scriptedAI(streamedText)

    const tutor = new TutorService({ ai, projects, db, sessions: undefined as never, analyses, chunks })
    void docs

    const session = await tutor.startSession({
      projectId: project.id,
      topicId,
      topicName: 'Derivatives',
      topicDescription: '',
      language: 'en',
    })

    const deltas: string[] = []
    const result = await tutor.beginTopic(session.id, { onDelta: (d) => deltas.push(d) })

    // Exactly one AI request for the introduction.
    expect(streamChat).toHaveBeenCalledTimes(1)
    expect(chat).not.toHaveBeenCalled()

    // The streamed text is exactly what was persisted.
    expect(deltas.join('')).toBe(streamedText)
    const introTurn = result.session.turns.find((t) => t.kind === 'introduction')
    expect(introTurn?.content).toBe(streamedText)

    // The persisted assistant message matches too.
    const assistantMessage = result.session.messages.find((m) => m.role === 'assistant')
    expect(assistantMessage?.content).toBe(streamedText)
  })

  it('falls back to a single non-streaming call when no onDelta is given', async () => {
    const { project, topicId, projects, chunks, analyses } = await setup()
    const { ai, chat, streamChat } = scriptedAI('unused')

    const tutor = new TutorService({ ai, projects, db, sessions: undefined as never, analyses, chunks })
    const session = await tutor.startSession({
      projectId: project.id,
      topicId,
      topicName: 'Derivatives',
      topicDescription: '',
      language: 'en',
    })

    const result = await tutor.beginTopic(session.id)

    expect(chat).toHaveBeenCalledTimes(1)
    expect(streamChat).not.toHaveBeenCalled()
    const introTurn = result.session.turns.find((t) => t.kind === 'introduction')
    expect(introTurn?.content).toBe('NON-STREAMED INTRO')
  })
})
