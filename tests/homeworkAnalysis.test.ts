import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { HomeworkService } from '@/services/homeworkService'
import { ANALYZER_OUTPUT_CEILING } from '@/entities/homework/tokenBudget'
import { ContextTooLongError, OutputLimitError, QuotaExceededError, RateLimitedError } from '@/infrastructure/ai/errors'
import type { AIService } from '@/services/aiService'
import type { DocumentChunk } from '@/entities/chunk/types'

/**
 * The analyzer reads a document in bounded batches and must classify a failure
 * by its real stage — extraction, request, output, source validation or
 * per-question generation — instead of reporting everything as "no questions".
 */

type StubMessage = { role: string; content: string }
type StubHandler = (system: string, user: string) => unknown
interface StubCall {
  system: string
  user: string
  maxTokens?: number
}

function stubAI(
  handler: StubHandler,
  opts: { calls?: StubCall[]; maxTokens?: number } = {},
): AIService {
  const respond = async (
    messages: StubMessage[],
    _onDelta?: unknown,
    options?: { maxTokens?: number },
  ) => {
    opts.calls?.push({
      system: messages[0]?.content ?? '',
      user: messages[1]?.content ?? '',
      ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    })
    return {
      data: await handler(messages[0]?.content ?? '', messages[1]?.content ?? ''),
      raw: {},
    }
  }
  const respondChat = async (messages: StubMessage[], options?: { maxTokens?: number }) =>
    respond(messages, undefined, options)
  return {
    chatJSON: respondChat,
    streamJSON: respond,
    maxOutputTokens: opts.maxTokens ?? 2_048,
    chat: async () => ({ content: 'Start by writing down what is given.' }),
  } as unknown as AIService
}

/** One question per cited chunk — mirrors a model echoing the closed set. */
function questionsFromUser(user: string): { questions: Array<Record<string, unknown>> } {
  const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
  return {
    questions: ids.map((id, index) => ({
      number: String(index + 1),
      prompt: `Question about ${id}.`,
      sourceChunkIds: [id],
    })),
  }
}

describe('HomeworkService — analysis reliability', () => {
  let db: AppDatabase
  let documentId: string
  let chunks: DocumentChunk[]

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })

    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId: project.id,
      type: 'text',
      materialType: 'homework',
      name: 'hw.pdf',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    documentId = doc.id

    // 12 chunks × 600 chars ≈ 7.7k chars → two analyzer batches at 6k.
    chunks = await new ChunkRepository(db).addMany(
      Array.from({ length: 12 }, (_, i) => ({
        documentId,
        projectId: project.id,
        materialType: 'homework' as const,
        pageNumber: i + 1,
        contentType: 'paragraph' as const,
        text: `Passage ${i}. `.padEnd(600, 'x'),
        sourceReference: `hw.pdf · Page ${i + 1}`,
        order: i,
      })),
    )
  })

  it('reads a long assignment in multiple batches and keeps every question', async () => {
    let analyzerCalls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (system.includes('extract the individual questions')) {
          analyzerCalls += 1
          return questionsFromUser(user)
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')
    expect(set.analysisNote).toBeUndefined()
    expect(analyzerCalls).toBeGreaterThanOrEqual(2)

    const questions = await service.listQuestions(set.id)
    expect(questions).toHaveLength(chunks.length)
    // Order preserved across batches; every source is a real chunk.
    const realIds = new Set(chunks.map((c) => c.id))
    for (const question of questions) {
      for (const ref of question.sourceRefs) expect(realIds.has(ref.chunkId ?? '')).toBe(true)
    }
  })

  it('accepts a bare JSON array when the model omits the wrapper object', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (system.includes('extract the individual questions')) {
          const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
          return ids.map((id, index) => ({ number: String(index + 1), prompt: `Q ${id}.`, sourceChunkIds: [id] }))
        }
        return { hints: ['h'], solution: 's' }
      }),
    })
    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')
    expect((await service.listQuestions(set.id)).length).toBeGreaterThan(0)
  })

  it('deduplicates the same question read from two batches', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (system.includes('extract the individual questions')) {
          const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
          // Every batch returns the same question text → one question total.
          return { questions: [{ number: '1', prompt: 'The same question.', sourceChunkIds: [ids[0]!] }] }
        }
        return { hints: ['h'], solution: 's' }
      }),
    })
    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')
    expect(await service.listQuestions(set.id)).toHaveLength(1)
  })

  it('keeps the good batch when another batch fails, and notes the gap', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (system.includes('extract the individual questions')) {
          if (user.includes('Passage 11')) throw new Error('AI request timed out after 70000 ms')
          return questionsFromUser(user)
        }
        return { hints: ['h'], solution: 's' }
      }),
    })
    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')
    expect(set.analysisNote).toBeTruthy()
    const questions = await service.listQuestions(set.id)
    expect(questions.length).toBeGreaterThan(0)
    expect(questions.length).toBeLessThan(chunks.length)
  })

  it('classifies invalid source ids as a source problem, not "no questions"', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          return { questions: [{ number: '1', prompt: 'Q.', sourceChunkIds: ['invented-id'] }] }
        }
        return { hints: ['h'], solution: 's' }
      }),
    })
    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('failed')
    expect(set.errorMessage).toMatch(/source/i)
    expect(await service.listQuestions(set.id)).toHaveLength(0)
  })

  it('classifies an empty payload as "no questions found"', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) return { questions: [] }
        return { hints: ['h'], solution: 's' }
      }),
    })
    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('failed')
    expect(set.errorMessage).toMatch(/no questions/i)
  })

  it('classifies an AI request failure as a request problem', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          throw new Error('Failed to fetch')
        }
        return { hints: ['h'], solution: 's' }
      }),
    })
    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('failed')
    expect(set.errorMessage).toBeTruthy()
  })

  it('reports unreadable extraction text before ever calling the AI', async () => {
    // Replace the chunks with whitespace only.
    const chunksRepo = new ChunkRepository(db)
    await chunksRepo.deleteByDocument(documentId)
    await chunksRepo.addMany([
      {
        documentId,
        projectId: (await new DocumentRepository(db).get(documentId)).projectId,
        materialType: 'homework',
        pageNumber: 1,
        contentType: 'paragraph',
        text: '    ',
        sourceReference: 'hw.pdf · Page 1',
        order: 0,
      },
    ])

    let called = false
    const service = new HomeworkService({
      db,
      ai: stubAI(() => {
        called = true
        return { questions: [] }
      }),
    })
    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('failed')
    expect(set.errorMessage).toMatch(/readable text/i)
    expect(called).toBe(false)
  })

  it('sends a controlled max_tokens per analyzer batch, never the raw setting', async () => {
    const calls: StubCall[] = []
    const service = new HomeworkService({
      db,
      ai: stubAI(
        (system, user) => {
          if (system.includes('extract the individual questions')) return questionsFromUser(user)
          return { hints: ['h'], solution: 's' }
        },
        { calls, maxTokens: 32_000 },
      ),
    })

    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')

    const analyzerCalls = calls.filter((call) =>
      call.system.includes('extract the individual questions'),
    )
    expect(analyzerCalls.length).toBeGreaterThan(0)
    for (const call of analyzerCalls) {
      expect(call.maxTokens).toBeGreaterThan(0)
      expect(call.maxTokens).toBeLessThanOrEqual(ANALYZER_OUTPUT_CEILING)
      expect(call.maxTokens).toBeLessThan(32_000)
    }
  })

  it('splits a batch that overflows the context window, keeping order and real sources', async () => {
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (system.includes('extract the individual questions')) {
          const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
          // A multi-chunk request is "too long"; the service must halve it.
          if (ids.length > 1) throw new ContextTooLongError('too long')
          return { questions: [{ number: '1', prompt: `Q ${ids[0]}`, sourceChunkIds: [ids[0]] }] }
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')
    const questions = await service.listQuestions(set.id)
    expect(questions).toHaveLength(chunks.length)
    const realIds = new Set(chunks.map((chunk) => chunk.id))
    for (const question of questions) {
      for (const ref of question.sourceRefs) expect(realIds.has(ref.chunkId ?? '')).toBe(true)
    }
  })

  it('retries a rejected output cap once with a smaller budget', async () => {
    const calls: StubCall[] = []
    let rejectedOnce = false
    const service = new HomeworkService({
      db,
      ai: stubAI(
        (system, user) => {
          if (system.includes('extract the individual questions')) {
            if (!rejectedOnce) {
              rejectedOnce = true
              throw new OutputLimitError('max_tokens too large')
            }
            return questionsFromUser(user)
          }
          return { hints: ['h'], solution: 's' }
        },
        { calls, maxTokens: 32_000 },
      ),
    })

    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')
    const analyzerCalls = calls.filter((call) =>
      call.system.includes('extract the individual questions'),
    )
    expect(analyzerCalls.length).toBeGreaterThanOrEqual(2)
    expect(analyzerCalls[1]!.maxTokens!).toBeLessThan(analyzerCalls[0]!.maxTokens!)
  })

  it('stops the whole run when the account is out of credit', async () => {
    let calls = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          calls += 1
          throw new QuotaExceededError('insufficient quota')
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('failed')
    expect(set.errorMessage).toMatch(/quota|credit/i)
    // Two batches were planned, but the first fatal error must stop the rest.
    expect(calls).toBe(1)
  })

  it('retries a transient rate limit once before continuing', async () => {
    let attempts = 0
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (system.includes('extract the individual questions')) {
          attempts += 1
          if (attempts === 1) throw new RateLimitedError('slow down')
          return questionsFromUser(user)
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId)
    expect(set.status).toBe('ready')
    expect(attempts).toBeGreaterThanOrEqual(3)
  })

  it('reports identifying + generating progress and clears it once ready', async () => {
    // Two small chunks → one batch → two questions.
    const chunksRepo = new ChunkRepository(db)
    await chunksRepo.deleteByDocument(documentId)
    const projectId = (await new DocumentRepository(db).get(documentId)).projectId
    await chunksRepo.addMany(
      [0, 1].map((i) => ({
        documentId,
        projectId,
        materialType: 'homework' as const,
        pageNumber: i + 1,
        contentType: 'paragraph' as const,
        text: `Passage ${i}. `.padEnd(120, 'x'),
        sourceReference: `hw.pdf · Page ${i + 1}`,
        order: i,
      })),
    )
    const repo = new HomeworkRepository(db)
    let seenIdentifying: string | undefined
    let seenIdentifyingTotal: number | undefined
    let releaseContent: () => void = () => {}
    const contentGate = new Promise<void>((resolve) => {
      releaseContent = resolve
    })
    const service = new HomeworkService({
      db,
      ai: stubAI(async (system, user) => {
        if (system.includes('extract the individual questions')) {
          const current = (await repo.listSets(projectId))[0]
          seenIdentifying = current?.progress?.stage
          seenIdentifyingTotal = current?.progress?.total
          return questionsFromUser(user)
        }
        await contentGate
        return { hints: ['h'], solution: 's' }
      }),
    })

    const run = service.createFromDocument(documentId)
    let seenGenerating: { total?: number; completed: number } | undefined
    await vi.waitFor(
      async () => {
        const current = (await repo.listSets(projectId))[0]
        if (current?.progress?.stage === 'generating') {
          seenGenerating = { total: current.progress.total, completed: current.progress.completed }
        }
        expect(current?.progress?.stage).toBe('generating')
      },
      { timeout: 4000, interval: 20 },
    )

    releaseContent()
    const set = await run
    expect(seenIdentifying).toBe('identifying')
    expect(seenIdentifyingTotal).toBe(1)
    expect(seenGenerating?.total).toBe(2)
    expect(seenGenerating?.completed).toBe(0)
    expect(set.status).toBe('ready')
    expect(set.progress).toBeUndefined()
  })
})
