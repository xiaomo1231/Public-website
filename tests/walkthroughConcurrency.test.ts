import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import {
  HomeworkWalkthroughService,
  walkthroughRunProgress,
  type WalkthroughProgress,
} from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { AbortedError, OutputTruncatedError } from '@/infrastructure/ai/errors'
import { createGenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  walkthroughAttemptText,
  walkthroughInFlightText,
  walkthroughProgressHeadline,
} from '@/widgets/homework/walkthrough/walkthroughProgressText'
import { t } from '@/i18n'

interface Call {
  kind: 'frame' | 'question' | 'part'
  id: string
  maxTokens?: number
}

function classify(system: string, user: string): Call {
  if (system.includes('opening and the closing')) return { kind: 'frame', id: 'frame' }
  if (system.includes('ONE sub-part')) {
    const match = user.match(/question (\S+), sub-part \((\w)\) only/)!
    return { kind: 'part', id: `${match[1]}${match[2]}` }
  }
  return { kind: 'question', id: user.match(/question (\S+)\./)![1]! }
}

type Handler = (call: Call, signal?: AbortSignal) => Promise<unknown> | unknown

/** A fake model that records how many requests (of each kind) run at once. */
function stubAI(handler: Handler, extra: Record<string, unknown> = {}) {
  const calls: Call[] = []
  let active = 0
  const peak = { all: 0, frame: 0, part: 0 }
  const activeBy = { frame: 0, part: 0, question: 0 }
  const streamJSON = vi.fn(
    async (
      messages: Array<{ content: string }>,
      _onDelta: unknown,
      options?: { signal?: AbortSignal; maxTokens?: number },
    ) => {
      const call = {
        ...classify(messages[0]!.content, messages[1]!.content),
        ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      }
      calls.push(call)
      active += 1
      activeBy[call.kind] += 1
      peak.all = Math.max(peak.all, active)
      peak.frame = Math.max(peak.frame, activeBy.frame)
      peak.part = Math.max(peak.part, activeBy.part)
      try {
        return { data: await handler(call, options?.signal), raw: {} }
      } finally {
        active -= 1
        activeBy[call.kind] -= 1
      }
    },
  )
  return {
    calls,
    peak,
    ai: {
      streamJSON,
      chatJSON: streamJSON,
      maxOutputTokens: 8192,
      concurrency: 4,
      ...extra,
    } as unknown as AIService,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const answer = (call: Call) =>
  call.kind === 'frame'
    ? { status: 'ready', overview: 'Tools.', summary: 'Summary.', suggestions: [] }
    : call.kind === 'part'
      ? {
          status: 'ready',
          heading: `Part ${call.id}`,
          conclusion: `(${call.id.slice(-1)}) result ${call.id}`,
          body: `Work for ${call.id}.`,
        }
      : { status: 'ready', conclusion: `Done ${call.id}.`, body: `Worked ${call.id}.` }

let db: AppDatabase
let setId: string

async function setup(prompts: string[]): Promise<void> {
  db = new AppDatabase()
  setDbForTesting(db)
  const projectId = (await new ProjectService(db).create({ name: 'Calc', subject: 'calculus' })).id
  const doc = await new DocumentRepository(db).create({
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
    questionCount: prompts.length,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  })
  for (const [index, prompt] of prompts.entries()) {
    const q: HomeworkQuestion = {
      id: `q${index + 1}`,
      projectId,
      setId,
      documentId: doc.id,
      documentName: 'hw.pdf',
      order: index,
      number: String(index + 1),
      prompt,
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
}

const service = (ai: AIService | null) =>
  new HomeworkWalkthroughService({ ai, db, homework: new HomeworkService({ ai, db }) })

async function section(id: string) {
  return (await service(null).state(setId)).plan.find((entry) => entry.id === id)!.section
}

afterEach(() => {
  db?.close()
})

describe('完整讲解: several requests at once', () => {
  it('writes the questions 4 at a time, then the opening and summary together', async () => {
    const n = 8
    const DELAY = 100
    await setup(Array.from({ length: n }, (_, i) => `Differentiate x^${i + 2}.`))
    const snapshots: WalkthroughProgress[] = []
    const { ai, peak, calls } = stubAI(async (call) => {
      const progress = walkthroughRunProgress(setId)
      if (progress) snapshots.push(progress)
      await sleep(DELAY)
      return answer(call)
    })
    const startedAt = Date.now()
    expect(await service(ai).generate(setId)).toEqual({ generated: n + 2, failed: 0 })
    const elapsed = Date.now() - startedAt
    // 4 at once (the setting), the opening and the summary side by side.
    expect(peak.all).toBe(4)
    expect(peak.frame).toBe(2)
    expect(calls.filter((call) => call.kind === 'question')).toHaveLength(n)
    // ceil(8 / 4) + 1 rounds of requests; two at a time would need at least 5.
    expect(elapsed).toBeLessThan(5 * DELAY)
    // Every section was listed while it was written, and the counts add up.
    const seen = new Set(snapshots.flatMap((progress) => progress.running))
    expect([...seen].sort()).toEqual(
      ['overview', 'summary', ...Array.from({ length: n }, (_, i) => `q:q${i + 1}`)].sort(),
    )
    expect(snapshots.every((progress) => progress.done <= progress.total)).toBe(true)
    const busiest = snapshots.find((progress) => progress.running.length === 4)!
    expect(walkthroughProgressHeadline(busiest, t)).toBe(
      t('homework.walkthrough.progressRunningQuestions', {
        running: 4,
        done: busiest.done,
        total: n + 2,
      }),
    )
    const inFlight = walkthroughInFlightText(busiest, (id) => `«${id}»`, t)!
    for (const id of busiest.running) expect(inFlight).toContain(`«${id}»`)
    expect((await section('summary'))?.status).toBe('ready')
  })

  it('writes the sub-parts after the first at the same time; a stop keeps the finished ones', async () => {
    await setup(['Answer each part. (a) Find w. (b) Find x. (c) Find y. (d) Find z.'])
    const run = createGenerationRun()
    const first = stubAI(async (call, signal) => {
      if (call.id === '1c') {
        // Still working when the student stops.
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new AbortedError())),
        )
      }
      // (d) finishes before (b): completion order is not sub-part order.
      if (call.id === '1d') await sleep(5)
      if (call.id === '1b') {
        await sleep(30)
        setTimeout(() => run.stopNow(), 20)
      }
      return answer(call)
    })
    const stopped = await service(first.ai).generate(setId, { control: run })
    expect(stopped).toMatchObject({ paused: true, stopped: true, failed: 0 })
    expect(first.calls.map((call) => call.id)).toEqual(['1a', '1b', '1c', '1d'])
    // (a) alone, then (b) (c) (d) together.
    expect(first.peak.part).toBe(3)
    const partial = (await section('q:q1'))!
    expect(partial.status).toBe('partial')
    expect(partial.draft!.parts.map((part) => part.label)).toEqual(['a', 'b', 'd'])

    const second = stubAI((call) => answer(call))
    expect(await service(second.ai).resume(setId)).toEqual({ generated: 3, failed: 0 })
    expect(second.calls.map((call) => call.id)).toEqual(['1c', 'frame', 'frame'])
    const done = (await section('q:q1'))!
    expect(done.status).toBe('ready')
    expect(done.draft).toBeUndefined()
    expect(done.parts!.map((part) => part.label)).toEqual(['a', 'b', 'c', 'd'])
    expect(done.conclusion).toBe('(a) result 1a\n\n(b) result 1b\n\n(c) result 1c\n\n(d) result 1d')
  })
})

describe('完整讲解: retries that change something', () => {
  it('a reply cut off at the cap is never asked again with the same budget', async () => {
    await setup(['Differentiate x^2.'])
    const { ai, calls } = stubAI(
      (call) => {
        if (call.kind === 'question') throw new OutputTruncatedError(call.maxTokens)
        return answer(call)
      },
      { maxOutputTokens: 2048, modelMaxOutputTokens: 2048 },
    )
    const result = await service(ai).generate(setId)
    expect(result.failed).toBe(1)
    const questions = calls.filter((call) => call.kind === 'question')
    expect(questions).toHaveLength(1)
    expect((await section('q:q1'))!.error).toBe(
      t('friendlyError.outputTruncatedModelMax', { limit: 2048 }),
    )
  })

  it('a cut-off below the model limit is not asked again with a larger budget', async () => {
    await setup(['Differentiate x^2.'])
    const { ai, calls } = stubAI(
      (call) => {
        if (call.kind === 'question') throw new OutputTruncatedError()
        return answer(call)
      },
      { maxOutputTokens: 65_536 },
    )
    const result = await service(ai).generate(setId)
    expect(result.failed).toBe(1)
    const questions = calls.filter((call) => call.kind === 'question')
    // One request, at the cap (AIService sends it: no per-call budget).
    expect(questions).toHaveLength(1)
    expect(questions[0]!.maxTokens).toBeUndefined()
    expect((await section('q:q1'))!.error).toContain('65536')
  })

  it('a multipart question cut off at the cap is written sub-part by sub-part, and says so', async () => {
    await setup(['Do it. (a) Find x. (b) Find y.'])
    const notes: string[] = []
    const { ai, calls } = stubAI(
      (call) => {
        if (call.kind === 'question') throw new OutputTruncatedError(call.maxTokens)
        const attempt = walkthroughRunProgress(setId)?.attempts?.['q:q1']
        if (attempt && call.kind === 'part') notes.push(walkthroughAttemptText(attempt, t))
        return answer(call)
      },
      { maxOutputTokens: 2048, modelMaxOutputTokens: 2048 },
    )
    expect(await service(ai).generate(setId)).toEqual({ generated: 3, failed: 0 })
    expect(calls.filter((call) => call.kind === 'question')).toHaveLength(1)
    expect(notes[0]).toContain(t('homework.walkthrough.change.split'))
  })
})
