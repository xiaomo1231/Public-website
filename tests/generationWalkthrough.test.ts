import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import {
  HomeworkWalkthroughService,
  walkthroughPausedRun,
} from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { AbortedError } from '@/infrastructure/ai/errors'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'

const isFrame = (system: string) => system.includes('opening and the closing')

type Handler = (call: number, system: string, signal?: AbortSignal) => Promise<unknown> | unknown

function stubAI(handler: Handler) {
  const calls: string[] = []
  const streamJSON = vi.fn(
    async (
      messages: Array<{ content: string }>,
      _onDelta: unknown,
      options?: { signal?: AbortSignal },
    ) => {
      const system = messages[0]!.content
      calls.push(isFrame(system) ? 'frame' : messages[1]!.content.match(/question (\d+)\./)![1]!)
      return { data: await handler(calls.length, system, options?.signal), raw: {} }
    },
  )
  return {
    calls,
    // Two requests at once: these tests pin down pause / resume order.
    ai: {
      streamJSON,
      chatJSON: streamJSON,
      maxOutputTokens: 8192,
      concurrency: 2,
    } as unknown as AIService,
  }
}

const answer = (system: string) =>
  isFrame(system)
    ? { status: 'ready', overview: 'Tools.', summary: 'Summary.', suggestions: [] }
    : { status: 'ready', conclusion: 'Done.', body: 'Worked.' }

let db: AppDatabase
let setId: string

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  const projectId = (await new ProjectService(db).create({ name: 'Calc', subject: 'calculus' })).id
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId,
    type: 'text',
    materialType: 'homework',
    name: 'hw.pdf',
    sizeBytes: 0,
  })
  const repo = new HomeworkRepository(db)
  setId = crypto.randomUUID()
  await repo.upsertSet({
    id: setId,
    projectId,
    documentId: doc.id,
    documentName: 'hw.pdf',
    title: 'HW',
    status: 'ready',
    language: 'en',
    questionCount: 4,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  })
  for (let i = 1; i <= 4; i++) {
    const q: HomeworkQuestion = {
      id: `q${i}`,
      projectId,
      setId,
      documentId: doc.id,
      documentName: 'hw.pdf',
      order: i,
      number: String(i),
      prompt: `Differentiate x^${i}.`,
      sourceRefs: [],
      hints: [],
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    }
    await repo.upsertQuestion(q)
  }
})

const service = (ai: AIService | null) =>
  new HomeworkWalkthroughService({ ai, db, homework: new HomeworkService({ ai, db }) })

async function sections() {
  const state = await service(null).state(setId)
  return state.plan.map((entry) => [entry.id, entry.section?.status ?? null])
}

describe('pausing the walkthrough', () => {
  it('pause keeps the finished sections; continue writes only what is left', async () => {
    let run: GenerationRun = createGenerationRun()
    let pauseOnce = true
    const { ai, calls } = stubAI((_call, system) => {
      if (pauseOnce) run.requestPause()
      pauseOnce = false
      return answer(system)
    })
    const first = await service(ai).generate(setId, { control: run })
    expect(first).toMatchObject({ generated: 2, failed: 0, paused: true })
    expect(first.stopped).toBeUndefined()
    // The two sections in flight finished; nothing failed; no frame yet.
    expect(calls).toEqual(['1', '2'])
    expect(await sections()).toEqual([
      ['overview', null],
      ['q:q1', 'ready'],
      ['q:q2', 'ready'],
      ['q:q3', null],
      ['q:q4', null],
      ['summary', null],
    ])
    expect(walkthroughPausedRun(setId)).toMatchObject({ done: 2, total: 6, stopped: false })

    calls.length = 0
    run = createGenerationRun()
    const second = await service(ai).resume(setId, { control: run })
    expect(second).toEqual({ generated: 4, failed: 0 })
    expect(calls).toEqual(['3', '4', 'frame', 'frame'])
    expect(walkthroughPausedRun(setId)).toBeUndefined()
    expect((await sections()).every(([, status]) => status === 'ready')).toBe(true)
  })

  it('stopNow aborts the requests in flight without failing them', async () => {
    const run = createGenerationRun()
    const { ai, calls } = stubAI(
      (_call, _system, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new AbortedError()))
          if (calls.length === 2) queueMicrotask(() => run.stopNow())
        }),
    )
    const result = await service(ai).generate(setId, { control: run })
    expect(result).toMatchObject({ generated: 0, failed: 0, paused: true, stopped: true })
    // Aborted requests are not retried and nothing is written as failed.
    expect(calls).toEqual(['1', '2'])
    expect((await sections()).every(([, status]) => status === null)).toBe(true)
    expect(walkthroughPausedRun(setId)).toMatchObject({ done: 0, stopped: true })
  })

  it('a paused "regenerate all" does not redo what it already rewrote', async () => {
    const { ai, calls } = stubAI((_call, system) => answer(system))
    await service(ai).generate(setId)
    expect(calls).toHaveLength(6)
    await new Promise((resolve) => setTimeout(resolve, 5))

    calls.length = 0
    let run: GenerationRun = createGenerationRun()
    let pauseOnce = true
    const forced = stubAI((_call, system) => {
      if (pauseOnce) run.requestPause()
      pauseOnce = false
      return answer(system)
    })
    const first = await service(forced.ai).generate(setId, { force: true, control: run })
    expect(first).toMatchObject({ generated: 2, paused: true })
    expect(forced.calls).toEqual(['1', '2'])

    forced.calls.length = 0
    run = createGenerationRun()
    const second = await service(forced.ai).resume(setId, { control: run })
    expect(second).toEqual({ generated: 4, failed: 0 })
    // Only the sections the forced run had not rewritten, then the opening and summary.
    expect(forced.calls).toEqual(['3', '4', 'frame', 'frame'])
  })
})
