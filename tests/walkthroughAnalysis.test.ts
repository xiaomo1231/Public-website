import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import {
  HomeworkWalkthroughService,
  SECTION_TOTAL_MS,
  sectionKeyPoints,
  walkthroughRunControl,
  walkthroughRunProgress,
  type WalkthroughProgress,
} from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import { walkthroughId } from '@/entities/homework/walkthrough'
import { tidyBoxedPunctuation } from '@/entities/homework/walkthroughFormat'
import { AbortedError } from '@/infrastructure/ai/errors'
import * as V2 from '@/infrastructure/ai/prompts/homework-walkthrough/v2'
import * as V3 from '@/infrastructure/ai/prompts/homework-walkthrough/v3'
import { prompts } from '@/infrastructure/ai/prompts'
import { createGenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'

type Kind = 'frame' | 'analysis' | 'question' | 'part'
interface Call {
  kind: Kind
  system: string
  user: string
}
type Handler = (call: Call, signal?: AbortSignal) => Promise<unknown> | unknown

function kindOf(system: string): Kind {
  if (system.includes('opening and the closing')) return 'frame'
  if (system.includes('question analysis (题目分析)')) return 'analysis'
  if (system.includes('ONE sub-part')) return 'part'
  return 'question'
}

function stubAI(handler: Handler) {
  const calls: Call[] = []
  const streamJSON = vi.fn(
    async (
      messages: Array<{ content: string }>,
      _onDelta: unknown,
      options?: { signal?: AbortSignal },
    ) => {
      const system = messages[0]!.content
      const call = { kind: kindOf(system), system, user: messages[1]!.content }
      calls.push(call)
      return { data: await handler(call, options?.signal), raw: {} }
    },
  )
  return {
    calls,
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

const LONG_BODY = `### Step one\n\n${'Long worked text. '.repeat(400)}\n\n**pivot** column.`

const model: Handler = (call) => {
  if (call.kind === 'frame')
    return { status: 'ready', overview: 'Tools.', summary: 'Summary.', suggestions: [] }
  if (call.kind === 'analysis') return { status: 'ready', analysis: '- Asks for x.' }
  return { status: 'ready', analysis: '- What is asked.', conclusion: 'Done.', body: LONG_BODY }
}

/** Never answers; rejects only when its request is aborted. */
const hang: Handler = (_call, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new AbortedError()))
  })

let db: AppDatabase
let setId: string

beforeEach(async () => {
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
    questionCount: 2,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  })
  for (let i = 1; i <= 2; i++) {
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

afterEach(() => {
  vi.useRealTimers()
  db?.close()
})

const service = (ai: AIService | null) =>
  new HomeworkWalkthroughService({ ai, db, homework: new HomeworkService({ ai, db }) })

async function stored(id: string) {
  return (await service(null).state(setId)).plan.find((entry) => entry.id === id)!.section
}

describe('homework-walkthrough/v3 prompts', () => {
  it('are byte-identical to v2 without the v3 options; the cache version stays v1', () => {
    for (const linearSystems of [true, false]) {
      expect(V3.buildQuestionSystemPrompt({ linearSystems })).toBe(
        V2.buildQuestionSystemPrompt({ linearSystems }),
      )
      expect(V3.buildPartSystemPrompt({ linearSystems })).toBe(
        V2.buildPartSystemPrompt({ linearSystems }),
      )
    }
    expect(V3.buildFrameSystemPrompt()).toBe(V2.buildFrameSystemPrompt())
    const part = {
      label: '2',
      question: '(a) x (b) y',
      sourceText: '',
      language: 'en' as const,
      part: 'a',
      parts: ['a', 'b'],
      earlier: [],
    }
    expect(V3.buildPartUserPrompt(part)).toBe(V2.buildPartUserPrompt(part))
    expect(prompts.homeworkWalkthrough.VERSION).toBe('v3')
    expect(prompts.homeworkWalkthrough.CACHE_VERSION).toBe('v1')
  })

  it('asks for the analysis and the punctuation rule with the v3 options', () => {
    const system = V3.buildQuestionSystemPrompt({ linearSystems: true, analysis: true })
    expect(system).toContain('{"status":"ready","analysis":"...","conclusion":"..."')
    expect(system).toContain('"analysis": a short Markdown analysis')
    expect(system).toContain(V3.PUNCTUATION_RULE)
    // The security footer stays last.
    expect(
      system.endsWith(V2.buildQuestionSystemPrompt({ linearSystems: true }).split('\n').pop()!),
    ).toBe(true)
    const first = V3.buildPartUserPrompt({
      label: '2',
      question: '(a) x (b) y',
      sourceText: '',
      language: 'en',
      part: 'a',
      parts: ['a', 'b'],
      earlier: [],
      analysis: true,
    })
    expect(first).toContain('covering the WHOLE question 2')
    expect(first.endsWith('Return JSON only.')).toBe(true)
  })

  it('the compact frame prompt carries key points, not worked text', () => {
    const user = V3.buildFrameKeyPointsUserPrompt({
      title: 'HW $1',
      language: 'en',
      questions: [{ label: '1', question: 'Q', conclusion: 'C', keyPoints: '- Step one' }],
      revision: { target: 'summary', suggestion: 'Shorter.' },
    })
    expect(user).toContain('Assignment: HW $1\nQuestion 1')
    expect(user).toContain('KEY POINTS 1')
    expect(user).not.toContain('SECTION START')
    expect(user).toContain('Shorter.')
    expect(user.endsWith('Return JSON only.')).toBe(true)
    expect(V3.buildFrameSystemPrompt({ keyPoints: true })).toContain(
      'the key points of its section',
    )
  })
})

describe('题目分析', () => {
  it('new sections carry the analysis; the frame request sees key points only', async () => {
    const { ai, calls } = stubAI(model)
    expect(await service(ai).generate(setId)).toEqual({ generated: 3, failed: 0 })
    expect((await stored('q:q1'))?.analysis).toBe('- What is asked.')
    const frame = calls.find((call) => call.kind === 'frame')!
    expect(frame.user).not.toContain('Long worked text')
    expect(frame.user).toContain('- Step one')
    expect(frame.user).toContain('- pivot')
    expect(frame.user.length).toBeLessThan(4_000)
  })

  it('补充题目分析 writes only the analysis of an older section', async () => {
    const { ai } = stubAI(model)
    await service(ai).generate(setId)
    const repo = new WalkthroughRepository(db)
    const before = (await stored('q:q1'))!
    const { analysis: _dropped, ...old } = before
    const base = {
      id: walkthroughId(setId, 'zh_terms'),
      projectId: '',
      setId,
      language: 'zh_terms' as const,
    }
    const walkthrough = await repo.get(base.id)
    await repo.putSection({ ...base, projectId: walkthrough!.projectId }, old)

    const second = stubAI(model)
    const result = await service(second.ai).addAnalysis(setId, 'q:q1')
    expect(result).toEqual({ generated: 1, failed: 0 })
    expect(second.calls.map((call) => call.kind)).toEqual(['analysis'])
    const after = (await stored('q:q1'))!
    expect(after.analysis).toBe('- Asks for x.')
    expect(after.body).toBe(before.body)
    expect(after.inputHash).toBe(before.inputHash)
    expect(after.previous).toBeUndefined()
    const plan = (await service(null).state(setId)).plan
    expect(plan.every((entry) => !entry.needsWork)).toBe(true)
  })

  it('stopping 补充题目分析 leaves the section unchanged', async () => {
    const { ai } = stubAI((call) =>
      call.kind === 'question'
        ? { status: 'ready', conclusion: 'Done.', body: 'Worked.' }
        : model(call),
    )
    await service(ai).generate(setId)
    const run = createGenerationRun()
    const stopper = stubAI((call, signal) => {
      queueMicrotask(() => run.stopNow())
      return hang(call, signal)
    })
    const result = await service(stopper.ai).addAnalysis(setId, 'q:q2', { control: run })
    expect(result).toMatchObject({ paused: true, stopped: true })
    expect((await stored('q:q2'))?.analysis).toBeUndefined()
    expect((await stored('q:q2'))?.status).toBe('ready')
  })
})

describe('a section that never finishes', () => {
  it('is saved as failed ("timed out, try again") within the total cap; the run moves on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const start = Date.now()
    const seen: WalkthroughProgress[] = []
    const { ai, calls } = stubAI((call, signal) => {
      // Question 1 hangs on every attempt; everything else answers.
      if (call.kind === 'question' && call.user.includes('question 1.')) {
        const progress = walkthroughRunProgress(setId)
        if (progress) seen.push(progress)
        return hang(call, signal)
      }
      return model(call)
    })
    let settled = false
    const promise = service(ai)
      .generate(setId)
      .finally(() => {
        settled = true
      })
    for (let step = 0; step < 200 && !settled; step++) await vi.advanceTimersByTimeAsync(5_000)
    const result = await promise
    expect(result).toEqual({ generated: 2, failed: 1 })
    const failed = (await stored('q:q1'))!
    // Given up once the section's total time was used (not 20+ minutes later).
    expect(failed.generatedAt - start).toBeLessThanOrEqual(SECTION_TOTAL_MS + 10_000)
    expect(failed.generatedAt - start).toBeGreaterThanOrEqual(SECTION_TOTAL_MS - 10_000)
    expect(failed.status).toBe('failed')
    expect(failed.error).toMatch(/超时，可重试|Timed out — try again/)
    expect((await stored('q:q2'))?.status).toBe('ready')
    // The frame was still written after the failure.
    expect(calls.some((call) => call.kind === 'frame')).toBe(true)
    // A retry was shown with its attempt number and the last failure.
    expect(seen.some((progress) => progress.attempts?.['q:q1']?.attempt === 2)).toBe(true)
    expect(
      seen.find((progress) => progress.attempts?.['q:q1'])?.attempts?.['q:q1']?.lastFailure,
    ).toBe('timeout')
    expect(walkthroughRunControl(setId)).toBeUndefined()
  })

  it('a stop during a retry still ends as a stop, not a failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const run = createGenerationRun()
    const { ai } = stubAI(hang)
    const promise = service(ai).generate(setId, { control: run })
    await vi.advanceTimersByTimeAsync(250_000)
    run.stopNow()
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await promise
    expect(result).toMatchObject({ failed: 0, paused: true, stopped: true })
    expect((await stored('q:q1'))?.status).toBeUndefined()
  })
})

describe('sectionKeyPoints', () => {
  it('lists headings and bold terms, bounded', () => {
    const points = sectionKeyPoints({
      body: `### (a) Row reduce\n\nUse the **pivot** and the **pivot** again.\n${'#### Step\n'.repeat(3)}${Array.from({ length: 200 }, (_, i) => `**term${i}**`).join(' ')}`,
    })
    expect(points.startsWith('- (a) Row reduce\n- Step\n- pivot')).toBe(true)
    expect(points.length).toBeLessThanOrEqual(600)
  })
})

describe('tidyBoxedPunctuation', () => {
  it('drops a stop after the box at the end of a display formula', () => {
    expect(tidyBoxedPunctuation('$$x = \\boxed{3}.$$')).toBe('$$x = \\boxed{3}$$')
    expect(tidyBoxedPunctuation('$$\n\\boxed{x = \\frac{1}{2}} ,\n$$')).toBe(
      '$$\n\\boxed{x = \\frac{1}{2}}\n$$',
    )
    expect(tidyBoxedPunctuation('$$\\boxed{3}\\,\\text{.}$$')).toBe('$$\\boxed{3}$$')
    expect(tidyBoxedPunctuation('\\[\\boxed{3}。\\]')).toBe('\\[\\boxed{3}\\]')
  })

  it('drops a stop right after a display formula that ends with a box', () => {
    expect(tidyBoxedPunctuation('So\n$$\\boxed{3}$$.\nNext.')).toBe('So\n$$\\boxed{3}$$\nNext.')
    expect(tidyBoxedPunctuation('$$\\boxed{3}$$。')).toBe('$$\\boxed{3}$$')
  })

  it('drops 。 right after an inline box at the end of a line', () => {
    expect(tidyBoxedPunctuation('答案为 $x = \\boxed{3}$。')).toBe('答案为 $x = \\boxed{3}$')
    expect(tidyBoxedPunctuation('(a) $\\boxed{2}$。\n(b) $\\boxed{5}$。')).toBe(
      '(a) $\\boxed{2}$\n(b) $\\boxed{5}$',
    )
  })

  it('leaves punctuation everywhere else alone', () => {
    const untouched = [
      '$$x = 3.$$',
      '$$\\boxed{3} + 1.$$',
      '$$x = 3$$.',
      '答案为 $\\boxed{3}$。接着看下一问。',
      'Result $\\boxed{3}$.',
      '答案为 $x = 3$。',
      'Use `$\\boxed{3}$。` in code.',
      '```\n$$\\boxed{3}.$$\n```',
      'Price \\$5. And $\\boxed{2}$ is fine, really.',
      'No math here. 句号。',
    ]
    for (const text of untouched) expect(tidyBoxedPunctuation(text)).toBe(text)
  })

  it('handles nested braces and escaped braces inside the box', () => {
    expect(tidyBoxedPunctuation('$$\\boxed{\\{1, \\frac{a}{b}\\}}.$$')).toBe(
      '$$\\boxed{\\{1, \\frac{a}{b}\\}}$$',
    )
  })
})
