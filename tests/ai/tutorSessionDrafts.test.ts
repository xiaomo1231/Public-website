import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { TutorService, findResumableSession } from '@/services/tutorService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import type { TutorSession } from '@/entities/tutorSession/types'
import { AIProviderError } from '@/infrastructure/ai/errors'
import type { AIService } from '@/services/aiService'

/**
 * R07 / R08: a tutor visit whose first AI request fails must not leave an
 * empty "0 turns" conversation in the history, and reopening the tutor must
 * resume the real conversation even when an empty row is newer.
 */

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

function stubAI(failIntro = false) {
  const chat = failIntro
    ? vi.fn().mockRejectedValue(new AIProviderError('bad key', 'AUTH_FAILED'))
    : vi.fn().mockResolvedValue({ content: 'Intro text', model: 'fake' })
  const chatJSON = vi.fn().mockResolvedValue({ data: QUESTION, raw: { content: '{}', model: 'f' } })
  return { chat, ai: { chat, chatJSON, currentProvider: { id: 'fake' } } as unknown as AIService }
}

describe('Tutor sessions are saved only once they hold a turn', () => {
  let db: AppDatabase
  let projects: ProjectService
  let projectId: string
  const topicId = 'topic-sets'

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
    projectId = (await projects.create({ name: 'Sets', subject: 'calculus' })).id
    const docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId, type: 'text', name: 'sets.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    await new ChunkRepository(db).addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'The intersection of A and B contains the shared elements.',
        sourceReference: 'sets.txt',
        order: 0,
      },
    ])
    await new CourseAnalysisRepository(db).reseedProject(
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

  const rows = () => db.table<TutorSession, string>('tutorSessions').toArray()

  it('does not write a row before the introduction exists', async () => {
    const tutor = new TutorService({ ai: stubAI().ai, db, projects })
    const { session, resumed } = await tutor.findOrStartSession(input())
    expect(resumed).toBe(false)
    expect(await rows()).toHaveLength(0)

    await tutor.beginTopic(session.id)
    const saved = await rows()
    expect(saved).toHaveLength(1)
    expect(saved[0]!.turns.length).toBeGreaterThan(0)
  })

  it('leaves nothing behind when the first request fails', async () => {
    const tutor = new TutorService({ ai: stubAI(true).ai, db, projects })
    const { session } = await tutor.findOrStartSession(input())
    await expect(tutor.beginTopic(session.id)).rejects.toBeInstanceOf(AIProviderError)
    expect(await rows()).toHaveLength(0)
  })

  it('resumes the real conversation even when an empty row is newer, and clears the empty row', async () => {
    const ok = new TutorService({ ai: stubAI().ai, db, projects })
    const first = await ok.findOrStartSession(input())
    await ok.beginTopic(first.session.id)

    // An empty row left by an older version after a failed visit.
    const sessions = new TutorSessionRepository(db)
    await sessions.upsert({
      ...(await ok.getSession(first.session.id)),
      id: 'empty-newer',
      turns: [],
      messages: [],
      pendingQuestion: undefined,
      updatedAt: Date.now() + 60_000,
    } as TutorSession)

    const again = await ok.findOrStartSession(input())
    expect(again.resumed).toBe(true)
    expect(again.session.id).toBe(first.session.id)
    expect((await rows()).map((row) => row.id)).toEqual([first.session.id])
  })

  it('finds the conversation to show without any AI provider', async () => {
    const tutor = new TutorService({ ai: stubAI().ai, db, projects })
    const { session } = await tutor.findOrStartSession(input())
    await tutor.beginTopic(session.id)

    const found = await findResumableSession(
      { projectId, topicId, language: 'en' },
      new TutorSessionRepository(db),
    )
    expect(found?.id).toBe(session.id)
    expect(
      await findResumableSession(
        { projectId, topicId, language: 'zh' },
        new TutorSessionRepository(db),
      ),
    ).toBeUndefined()
  })

  it('history lists only conversations with turns', async () => {
    const tutor = new TutorService({ ai: stubAI().ai, db, projects })
    const { session } = await tutor.findOrStartSession(input())
    await tutor.beginTopic(session.id)
    const sessions = new TutorSessionRepository(db)
    await sessions.upsert({
      ...(await tutor.getSession(session.id)),
      id: 'empty',
      turns: [],
    })

    const listed = await sessions.listConversations(projectId)
    expect(listed.map((row) => row.id)).toEqual([session.id])
  })
})
