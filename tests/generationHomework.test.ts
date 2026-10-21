import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkService } from '@/services/homeworkService'
import { planAnalyzerBatches } from '@/entities/homework/analyzerBatching'
import { AbortedError } from '@/infrastructure/ai/errors'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { DocumentChunk } from '@/entities/chunk/types'

/**
 * Pausing / stopping homework generation: finished parts are kept, nothing
 * aborted is recorded as failed, the set never stays `analyzing`, and
 * 「继续」 asks only for what is left.
 */

type Handler = (
  system: string,
  user: string,
  signal: AbortSignal | undefined,
) => unknown | Promise<unknown>

const HANG = Symbol('hang')

function stubAI(handler: Handler): AIService {
  const respond = async (
    messages: Array<{ content: string }>,
    _onDelta?: unknown,
    options?: { signal?: AbortSignal },
  ) => {
    const result = await handler(
      messages[0]?.content ?? '',
      messages[1]?.content ?? '',
      options?.signal,
    )
    if (result === HANG) {
      // A request that only ends when the student stops it.
      await new Promise((_, reject) => {
        const signal = options?.signal
        if (!signal) return
        if (signal.aborted) reject(new AbortedError())
        signal.addEventListener('abort', () => reject(new AbortedError()))
      })
    }
    return { data: result, raw: {} }
  }
  return {
    streamJSON: respond,
    chatJSON: (messages: Array<{ content: string }>, options?: { signal?: AbortSignal }) =>
      respond(messages, undefined, options),
    chat: async () => ({ content: 'ok' }),
    maxOutputTokens: 4_096,
  } as unknown as AIService
}

const isAnalyzer = (system: string) => system.includes('extract the individual questions')

function questionsFromUser(user: string) {
  const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
  return {
    questions: ids.map((id, index) => ({
      number: String(index + 1),
      prompt: `Question about ${id}.`,
      sourceChunkIds: [id],
    })),
  }
}

describe('homework generation control', () => {
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
    chunks = await new ChunkRepository(db).addMany(
      Array.from({ length: 30 }, (_, i) => ({
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

  it('pauses recognition between batches and continues with only the rest', async () => {
    const batches = planAnalyzerBatches(chunks).batches.length
    expect(batches).toBeGreaterThanOrEqual(3)
    let analyzerCalls = 0
    let run: GenerationRun = createGenerationRun()
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (isAnalyzer(system)) {
          analyzerCalls += 1
          if (analyzerCalls === 2) run.requestPause()
          return questionsFromUser(user)
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const paused = await service.createFromDocument(documentId, { control: run })
    expect(run.finish()).toBe('paused')
    expect(analyzerCalls).toBe(2)
    expect(paused.status).toBe('paused')
    expect(paused.progress?.stage).toBe('identifying')
    expect(paused.progress?.completed).toBe(2)
    // Nothing was committed while reading was incomplete.
    expect(await service.listQuestions(paused.id)).toHaveLength(0)

    run = createGenerationRun()
    const resumed = await service.resumeSet(paused.id, { control: run })
    expect(resumed?.paused).toBeFalsy()
    // The two batches already read were reused, not requested again.
    expect(analyzerCalls).toBe(batches)
    expect(resumed?.set.status).toBe('ready')
    expect(await service.listQuestions(paused.id)).toHaveLength(chunks.length)
  })

  it('stopNow during recognition leaves a paused set, never analyzing or failed', async () => {
    let analyzerCalls = 0
    const run = createGenerationRun()
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (isAnalyzer(system)) {
          analyzerCalls += 1
          if (analyzerCalls === 2) {
            setTimeout(() => run.stopNow(), 0)
            return HANG
          }
          return questionsFromUser(user)
        }
        return { hints: ['h'], solution: 's' }
      }),
    })
    const set = await service.createFromDocument(documentId, { control: run })
    expect(run.finish()).toBe('stopped')
    expect(set.status).toBe('paused')
    expect(set.errorMessage).toBeUndefined()
  })

  it('pauses hint generation, keeps finished questions and resumes only pending ones', async () => {
    let hintCalls = 0
    let run: GenerationRun = createGenerationRun()
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (isAnalyzer(system)) return questionsFromUser(user)
        hintCalls += 1
        if (hintCalls === 4) run.requestPause()
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId, { control: run })
    expect(run.finish()).toBe('paused')
    expect(set.status).toBe('paused')
    expect(set.progress?.stage).toBe('generating')
    const afterPause = await service.listQuestions(set.id)
    expect(afterPause).toHaveLength(chunks.length)
    expect(afterPause.some((q) => q.generationStatus === 'failed')).toBe(false)
    const readyAfterPause = afterPause.filter((q) => q.generationStatus === 'ready').length
    expect(readyAfterPause).toBe(hintCalls)
    expect(readyAfterPause).toBeLessThan(chunks.length)

    run = createGenerationRun()
    const resumed = await service.resumeSet(set.id, { control: run })
    expect(resumed?.set.status).toBe('ready')
    // Each question was prepared exactly once over both runs.
    expect(hintCalls).toBe(chunks.length)
    const finalQuestions = await service.listQuestions(set.id)
    expect(finalQuestions.every((q) => q.generationStatus === 'ready')).toBe(true)
  })

  it('stopNow aborts in-flight questions without marking them failed', async () => {
    let hintCalls = 0
    const run = createGenerationRun()
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (isAnalyzer(system)) return questionsFromUser(user)
        hintCalls += 1
        if (hintCalls >= 3) {
          if (hintCalls === 3) setTimeout(() => run.stopNow(), 0)
          return HANG
        }
        return { hints: ['h'], solution: 's' }
      }),
    })

    const set = await service.createFromDocument(documentId, { control: run })
    expect(run.finish()).toBe('stopped')
    expect(set.status).toBe('paused')
    const questions = await service.listQuestions(set.id)
    expect(questions.some((q) => q.generationStatus === 'failed')).toBe(false)
    expect(questions.filter((q) => q.generationStatus === 'ready')).toHaveLength(2)
    expect(questions.filter((q) => q.generationStatus === 'pending').length).toBe(chunks.length - 2)
  })

  it('a stopped single regeneration keeps the existing help', async () => {
    let hang = false
    const service = new HomeworkService({
      db,
      ai: stubAI((system, user) => {
        if (isAnalyzer(system)) return questionsFromUser(user)
        return hang ? HANG : { hints: ['first hint'], solution: 'first solution' }
      }),
    })
    const set = await service.createFromDocument(documentId)
    const [question] = await service.listQuestions(set.id)
    hang = true
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 0)
    const next = await service.generateContent(question!.id, { signal: controller.signal })
    expect(next?.generationStatus).toBe('ready')
    expect(next?.hints).toEqual(['first hint'])
    expect(next?.solution).toBe('first solution')
    expect(next?.generationError).toBeUndefined()
  })
})
