import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { TutorLessonService, computeLessonContentHash } from '@/services/tutorLessonService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { TutorLessonRepository } from '@/entities/tutorLesson/repository'
import type { AIService } from '@/services/aiService'
import { AppError } from '@/infrastructure/errors/AppError'

const LESSON = [
  '## Overview',
  '',
  'The intersection of two sets is written as \\(X \\cap Y\\).',
  '',
  '\\[',
  'X \\cap Y = \\{c\\}',
  '\\]',
].join('\n')

function stubAI(content = LESSON) {
  const chat = vi.fn().mockResolvedValue({ content, model: 'fake' })
  const streamChat = vi.fn(async (_m: unknown, onDelta: (d: string) => void) => {
    onDelta(content)
    return { content, model: 'fake' }
  })
  return {
    chat,
    streamChat,
    ai: { chat, streamChat, currentProvider: { id: 'fake' } } as unknown as AIService,
  }
}

describe('TutorLessonService — cache-first', () => {
  let db: AppDatabase
  let projectId: string
  let topicId: string
  let analyses: CourseAnalysisRepository
  let chunks: ChunkRepository
  let projects: ProjectService

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
    const project = await projects.create({ name: 'Set Theory', subject: 'calculus' })
    projectId = project.id

    const docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId, type: 'text', name: 'sets.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    chunks = new ChunkRepository(db)
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'The intersection of two sets A and B contains the elements common to both.',
        sourceReference: 'sets.txt',
        order: 0,
      },
    ])

    analyses = new CourseAnalysisRepository(db)
    topicId = 'topic-sets'
    await analyses.reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Set Operations',
            description: 'Union and intersection.',
            sourceRefs: [
              { documentId: doc.id, documentName: 'sets.txt', quote: 'The intersection of two sets' },
            ],
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

  function service(ai: AIService) {
    return new TutorLessonService({ ai, db, analyses, chunks })
  }

  const input = () => ({
    projectId,
    topicId,
    topicName: 'Set Operations',
    topicDescription: 'Union and intersection.',
    language: 'en' as const,
  })

  it('calls the AI on the first visit and stores the lesson', async () => {
    const { ai, chat } = stubAI()
    const result = await service(ai).getOrGenerate(input())

    expect(chat).toHaveBeenCalledTimes(1)
    expect(result.fromCache).toBe(false)
    expect(result.lesson.content).toContain('X \\cap Y')
  })

  it('does not call the AI on the second visit', async () => {
    const { ai, chat } = stubAI()
    const tutor = service(ai)

    await tutor.getOrGenerate(input())
    const second = await tutor.getOrGenerate(input())

    expect(chat).toHaveBeenCalledTimes(1)
    expect(second.fromCache).toBe(true)
    expect(second.lesson.content).toContain('X \\cap Y')
  })

  it('does not call the AI after a page refresh (new service instance)', async () => {
    const { ai, chat } = stubAI()
    await service(ai).getOrGenerate(input())

    // A fresh instance simulates a remount / reload: only IndexedDB survives.
    const afterReload = await service(ai).getOrGenerate(input())

    expect(chat).toHaveBeenCalledTimes(1)
    expect(afterReload.fromCache).toBe(true)
  })

  it('keeps a separate cache per topic', async () => {
    const { ai, chat } = stubAI()
    const tutor = service(ai)
    await tutor.getOrGenerate(input())

    const secondTopicId = 'topic-logic'
    await analyses.addTopics([
      {
        id: secondTopicId,
        projectId,
        name: 'Logic',
        description: '',
        order: 1,
        sourceRefs: [],
        createdAt: Date.now(),
      },
    ])

    const second = await tutor.getOrGenerate({ ...input(), topicId: secondTopicId, topicName: 'Logic' })

    expect(chat).toHaveBeenCalledTimes(2)
    expect(second.fromCache).toBe(false)
    // Topic A's cache is untouched.
    const backToFirst = await tutor.getOrGenerate(input())
    expect(backToFirst.fromCache).toBe(true)
  })

  it('never serves one topic the content of another', async () => {
    const { ai } = stubAI()
    const tutor = service(ai)
    await tutor.getOrGenerate(input())

    const otherTopicId = 'topic-empty'
    await analyses.addTopics([
      {
        id: otherTopicId,
        projectId,
        name: 'Empty',
        description: '',
        order: 2,
        sourceRefs: [],
        createdAt: Date.now(),
      },
    ])

    const other = await tutor.load({ projectId, topicId: otherTopicId, language: 'en' })
    expect(other).toBeUndefined()
  })

  it('invalidates the cache when the topic changes', async () => {
    const { ai, chat } = stubAI()
    const tutor = service(ai)
    await tutor.getOrGenerate(input())

    // Re-analysing the course rewrites the topic.
    await analyses.addTopics([
      {
        id: topicId,
        projectId,
        name: 'Set Operations',
        description: 'Rewritten description.',
        order: 0,
        sourceRefs: [],
        createdAt: Date.now(),
      },
    ])

    const after = await tutor.getOrGenerate({ ...input(), topicDescription: 'Rewritten description.' })

    expect(chat).toHaveBeenCalledTimes(2)
    expect(after.fromCache).toBe(false)
  })

  it('keeps a separate cache per language', async () => {
    const { ai, chat } = stubAI()
    const tutor = service(ai)

    await tutor.getOrGenerate(input())
    await tutor.getOrGenerate({ ...input(), language: 'zh' })

    expect(chat).toHaveBeenCalledTimes(2)

    // Switching back is still a cache hit.
    const backToEnglish = await tutor.getOrGenerate(input())
    expect(backToEnglish.fromCache).toBe(true)
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('coalesces two concurrent opens into a single AI request', async () => {
    const { ai, chat } = stubAI()
    const tutor = service(ai)

    const [a, b] = await Promise.all([tutor.getOrGenerate(input()), tutor.getOrGenerate(input())])

    expect(chat).toHaveBeenCalledTimes(1)
    expect(a.lesson.id).toBe(b.lesson.id)
  })

  it('persists the extracted symbols with the lesson', async () => {
    const { ai } = stubAI()
    const result = await service(ai).getOrGenerate(input())

    expect(result.lesson.symbols.map((s) => s.latex)).toContain('\\cap')

    // And they survive a reload without another AI call.
    const reloaded = await service(ai).getOrGenerate(input())
    expect(reloaded.lesson.symbols.map((s) => s.latex)).toContain('\\cap')
  })

  it('only extracts symbols from real maths, never from code samples', async () => {
    const withCode = [
      '## Overview',
      '',
      'The intersection \\(X \\cap Y\\).',
      '',
      '```',
      'path = C:\\Users\\test',
      '```',
    ].join('\n')
    const { ai } = stubAI(withCode)

    const result = await service(ai).getOrGenerate(input())
    const latex = result.lesson.symbols.map((s) => s.latex)

    expect(latex).toContain('\\cap')
    expect(latex).not.toContain('\\Users')
    expect(latex).not.toContain('\\test')
  })

  it('stores a lesson free of Private Use Area characters', async () => {
    const dirty = [
      '## Symmetric Difference',
      '',
      'The symmetric difference is \\(A \u25B3 B\\) and the union is \uF0C8.',
      '',
      'Unrecoverable glyph: \uE000',
    ].join('\n')
    const { ai } = stubAI(dirty)

    const result = await service(ai).getOrGenerate(input())

    // No PUA may survive into stored content...
    expect(result.lesson.content).not.toMatch(/[\uE000-\uF8FF]/)
    // ...the maths is canonical LaTeX...
    expect(result.lesson.content).toContain('\\triangle')
    expect(result.lesson.content).toContain('\\cup')
    // ...and the unrecoverable character is an explicit marker, not a glyph.
    expect(result.lesson.content).toContain('[?]')

    // Symbols are extracted from the canonical LaTeX, not the Unicode chars.
    const latex = result.lesson.symbols.map((s) => s.latex)
    expect(latex).toContain('\\triangle')
    expect(latex).toContain('\\cup')
  })

  it('coalesces concurrent opens across separate service instances', async () => {
    const first = stubAI()
    const second = stubAI()

    // `buildAIServices()` hands out a new service each time, so the guard has
    // to live above the instance for these two to share one request.
    const [a, b] = await Promise.all([
      service(first.ai).getOrGenerate(input()),
      service(second.ai).getOrGenerate(input()),
    ])

    const totalCalls = first.chat.mock.calls.length + second.chat.mock.calls.length
    expect(totalCalls).toBe(1)
    expect(a.lesson.id).toBe(b.lesson.id)
  })

  it('persists the real source chunk ids', async () => {
    const { ai } = stubAI()
    const result = await service(ai).getOrGenerate(input())

    expect(result.lesson.sourceChunkIds.length).toBeGreaterThan(0)
    // Every recorded id must resolve to a real chunk — we cite storage, never
    // a copy of the course text.
    for (const chunkId of result.lesson.sourceChunkIds) {
      expect(await chunks.get(chunkId)).toBeDefined()
    }
  })

  it('does not store a failed generation', async () => {
    const chat = vi.fn().mockRejectedValue(new Error('provider exploded'))
    const ai = { chat, currentProvider: { id: 'fake' } } as unknown as AIService
    const tutor = service(ai)

    await expect(tutor.getOrGenerate(input())).rejects.toThrow('provider exploded')

    // Nothing was written, so a later attempt is a real generation.
    const { ai: okAI, chat: okChat } = stubAI()
    const result = await service(okAI).getOrGenerate(input())
    expect(okChat).toHaveBeenCalledTimes(1)
    expect(result.fromCache).toBe(false)
  })

  it('does not store an empty response as a lesson', async () => {
    const { ai, chat } = stubAI('   ')
    const tutor = service(ai)

    await expect(tutor.getOrGenerate(input())).rejects.toMatchObject({
      code: 'EMPTY_TUTOR_RESPONSE',
    })
    expect(chat).toHaveBeenCalledTimes(1)

    // The empty result must not have been persisted.
    const stored = await tutor.load({ projectId, topicId, language: 'en' })
    expect(stored).toBeUndefined()
  })

  it('keeps serving the stored lesson when a refresh fails', async () => {
    const { ai } = stubAI()
    const tutor = service(ai)
    await tutor.getOrGenerate(input())

    // The course is re-analysed (invalidating the cache) and the AI is now down.
    await analyses.addTopics([
      {
        id: topicId,
        projectId,
        name: 'Set Operations',
        description: 'Rewritten.',
        order: 0,
        sourceRefs: [],
        createdAt: Date.now(),
      },
    ])
    const failing = {
      chat: vi.fn().mockRejectedValue(new AppError('down', 'PROVIDER_UNAVAILABLE')),
      currentProvider: { id: 'fake' },
    } as unknown as AIService

    const result = await service(failing).getOrGenerate({ ...input(), topicDescription: 'Rewritten.' })

    expect(result.fromCache).toBe(true)
    expect(result.refreshError).toBeTruthy()
    expect(result.lesson.content).toContain('X \\cap Y')
  })

  it('regenerate always calls the AI and replaces the stored lesson', async () => {
    const { ai, chat } = stubAI()
    const tutor = service(ai)
    await tutor.getOrGenerate(input())

    const fresh = await tutor.regenerate(input())

    expect(chat).toHaveBeenCalledTimes(2)
    expect(fresh.fromCache).toBe(false)

    // Only one lesson row remains for the key.
    const lessons = await new TutorLessonRepository(db).listByProject(projectId)
    expect(lessons).toHaveLength(1)
    expect(lessons[0]!.id).toBe(fresh.lesson.id)
  })
})

describe('computeLessonContentHash', () => {
  const topic = {
    name: 'Sets',
    description: 'd',
    sourceRefs: [
      { documentId: 'doc-1', documentName: 'sets.txt', page: 3, section: 's', quote: 'q', chunkId: 'c1' },
    ],
  }

  it('is stable for the same topic and prompt version', () => {
    expect(computeLessonContentHash(topic, 'v1')).toBe(computeLessonContentHash(topic, 'v1'))
  })

  it('changes when the prompt version changes', () => {
    expect(computeLessonContentHash(topic, 'v1')).not.toBe(computeLessonContentHash(topic, 'v2'))
  })

  it('changes when the topic name changes', () => {
    expect(computeLessonContentHash(topic, 'v1')).not.toBe(
      computeLessonContentHash({ ...topic, name: 'Other' }, 'v1'),
    )
  })

  it('changes when the citations change', () => {
    expect(computeLessonContentHash(topic, 'v1')).not.toBe(
      computeLessonContentHash({ ...topic, sourceRefs: [] }, 'v1'),
    )
  })
})
