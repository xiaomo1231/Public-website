import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProjectService } from '@/services/projectService'
import {
  DocumentAnalysisService,
  clearAnalyzedPartsForTesting,
  rememberedAnalysisPartCount,
} from '@/services/documentAnalysisService'
import {
  CourseContentService,
  clearEnsureAnalyzedInFlightForTesting,
  courseAnalysisRun,
  pausedCourseAnalysis,
  recoverInterruptedAnalyses,
} from '@/services/courseContentService'
import { buildAIServices } from '@/services/aiServices'
import { AbortedError } from '@/infrastructure/ai/errors'
import {
  GenerationPausedError,
  createGenerationRun,
  type GenerationRun,
} from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { AIServicesBundle } from '@/services/aiServices'
import type { ChatMessage } from '@/infrastructure/ai/types'

vi.mock('@/services/aiServices', () => ({ buildAIServices: vi.fn() }))

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  clearAnalyzedPartsForTesting()
  clearEnsureAnalyzedInFlightForTesting()
})

/**
 * A model answering each part with one topic. `onCall(n, signal)` runs as
 * call `n` starts (e.g. to pause); with `hang` the call waits for its signal.
 */
function partAI(options: { onCall?: (n: number) => void; hang?: (n: number) => boolean } = {}) {
  let calls = 0
  const streamJSON = vi.fn(
    async (messages: ChatMessage[], _onDelta: unknown, opts?: { signal?: AbortSignal }) => {
      calls++
      const n = calls
      options.onCall?.(n)
      if (options.hang?.(n)) {
        await new Promise((_resolve, reject) => {
          const signal = opts?.signal
          if (signal?.aborted) reject(new AbortedError())
          signal?.addEventListener('abort', () => reject(new AbortedError()), { once: true })
        })
      }
      await Promise.resolve()
      const user = messages[1]!.content
      const firstChunk = /\[c:([^\s\]·]+)/.exec(user)![1]!
      const part = /This is part (\d+) of/.exec(user)?.[1] ?? '1'
      return {
        data: {
          language: 'en',
          topics: [
            {
              name: `Topic ${part}`,
              description: 'd',
              sourceChunkIds: [firstChunk],
              sourceRefs: [],
            },
          ],
        },
        raw: { content: '{}', finishReason: 'stop', model: 'm' },
      }
    },
  )
  const ai = {
    streamJSON,
    chatJSON: vi.fn(),
    currentProvider: { id: 'custom' },
    maxOutputTokens: 2048,
  } as unknown as AIService
  return { ai, streamJSON }
}

/** A four-part textbook (4 chapters, each too long to share a request). */
async function seedBook() {
  const projects = new ProjectService(db)
  const p = await projects.create({ name: 'Anatomy', subject: 'medicine' })
  const docs = new DocumentRepository(db)
  const doc = await docs.create({ projectId: p.id, type: 'pdf', name: 'atlas.pdf', sizeBytes: 1 })
  await docs.update(doc.id, { status: 'ready' })
  await new ChunkRepository(db).addMany(
    Array.from({ length: 240 }, (_, i) => {
      const ch = Math.floor(i / 60) + 1
      return {
        documentId: doc.id,
        projectId: p.id,
        contentType: 'paragraph' as const,
        text: `Chapter ${ch} passage ${i} `.padEnd(500, 'x'),
        sourceReference: 'atlas.pdf',
        order: i,
        chapterId: `ch-${ch}`,
        chapterNumber: String(ch),
      }
    }),
  )
  return { projects, projectId: p.id }
}

describe('pausing a multi-part course analysis', () => {
  it('stops after the parts in flight, stores nothing, and continues with the rest', async () => {
    const { projects, projectId } = await seedBook()
    const run = createGenerationRun()
    const first = partAI({ onCall: (n) => n === 2 && run.requestPause() })
    const service = new DocumentAnalysisService({ ai: first.ai, projects, db })

    await expect(service.analyzeProject(projectId, { control: run })).rejects.toBeInstanceOf(
      GenerationPausedError,
    )
    // Two parts were in flight (concurrency 2); they finished, nothing else started.
    expect(first.streamJSON).toHaveBeenCalledTimes(2)
    expect(run.finish()).toBe('paused')
    // No `analyzing` / `failed` row was left behind.
    expect(await new CourseAnalysisRepository(db).getByProject(projectId)).toBeUndefined()
    expect(rememberedAnalysisPartCount()).toBe(2)

    const second = partAI()
    await new DocumentAnalysisService({ ai: second.ai, projects, db }).analyzeProject(projectId)
    // Only the two remaining parts were requested.
    expect(second.streamJSON).toHaveBeenCalledTimes(2)
    const analyses = new CourseAnalysisRepository(db)
    expect(await analyses.getByProject(projectId)).toMatchObject({ status: 'ready', inputParts: 4 })
    expect((await analyses.listTopics(projectId)).map((t) => t.name).sort()).toEqual([
      'Topic 1',
      'Topic 2',
      'Topic 3',
      'Topic 4',
    ])
    expect(rememberedAnalysisPartCount()).toBe(0)
  })

  it('keeps the previous analysis untouched', async () => {
    const { projects, projectId } = await seedBook()
    await new DocumentAnalysisService({ ai: partAI().ai, projects, db }).analyzeProject(projectId)
    const analyses = new CourseAnalysisRepository(db)
    const before = await analyses.getByProject(projectId)
    const topics = await analyses.listTopics(projectId)

    const run = createGenerationRun()
    const paused = partAI({ onCall: (n) => n === 2 && run.requestPause() })
    await expect(
      new DocumentAnalysisService({ ai: paused.ai, projects, db }).analyzeProject(projectId, {
        control: run,
      }),
    ).rejects.toBeInstanceOf(GenerationPausedError)
    expect(await analyses.getByProject(projectId)).toEqual(before)
    expect((await analyses.listTopics(projectId)).map((t) => t.id)).toEqual(topics.map((t) => t.id))
  })

  it('stopNow aborts the parts in flight without recording a failure', async () => {
    const { projects, projectId } = await seedBook()
    const run = createGenerationRun()
    const ai = partAI({
      // Part 1 answers; part 2 hangs until the stop aborts it.
      hang: (n) => n === 2,
      onCall: (n) => n === 2 && run.stopNow(),
    })
    const error = await new DocumentAnalysisService({ ai: ai.ai, projects, db })
      .analyzeProject(projectId, { control: run })
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(GenerationPausedError)
    expect((error as GenerationPausedError).stopped).toBe(true)
    expect(ai.streamJSON).toHaveBeenCalledTimes(2)
    expect(await new CourseAnalysisRepository(db).getByProject(projectId)).toBeUndefined()
    // The finished part is kept for 继续; the aborted one is not.
    expect(rememberedAnalysisPartCount()).toBe(1)
  })
})

describe('pausing through the content service', () => {
  function mockServices(projects: ProjectService, ai: AIService) {
    vi.mocked(buildAIServices).mockResolvedValue({
      documentAnalysis: new DocumentAnalysisService({ ai, projects, db }),
    } as unknown as AIServicesBundle)
  }

  it('reports paused, offers 继续, and recovery never marks it failed', async () => {
    const { projects, projectId } = await seedBook()
    let live: GenerationRun | undefined
    const first = partAI({
      onCall: (n) => {
        if (n !== 2) return
        live = courseAnalysisRun(projectId)?.run
        live?.requestPause()
      },
    })
    mockServices(projects, first.ai)
    const result = await new CourseContentService().ensureAnalyzed(projectId, { force: true })
    expect(live).toBeDefined()
    expect(result).toMatchObject({ analyzed: false, reason: 'paused', stopped: false })
    expect(first.streamJSON).toHaveBeenCalledTimes(2)
    expect(courseAnalysisRun(projectId)).toBeUndefined()
    expect(pausedCourseAnalysis(projectId)).toEqual({
      force: true,
      stopped: false,
      parts: { done: 2, total: 4 },
    })

    // Much later (a reload would lose the parts, but the database is clean).
    expect(await recoverInterruptedAnalyses(db, Date.now() + 60 * 60_000)).toBe(0)
    expect(await new CourseAnalysisRepository(db).getByProject(projectId)).toBeUndefined()

    const second = partAI()
    mockServices(projects, second.ai)
    const resumed = await new CourseContentService().ensureAnalyzed(projectId, { force: true })
    expect(resumed.reason).toBe('analyzed')
    expect(second.streamJSON).toHaveBeenCalledTimes(2)
    expect(pausedCourseAnalysis(projectId)).toBeUndefined()
  })
})
