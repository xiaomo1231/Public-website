import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { AbortedError, OutputTruncatedError } from '@/infrastructure/ai/errors'
import * as V1 from '@/infrastructure/ai/prompts/homework-walkthrough/v1'
import * as V2 from '@/infrastructure/ai/prompts/homework-walkthrough/v2'
import { prompts } from '@/infrastructure/ai/prompts'
import { shouldSplitWalkthrough, walkthroughSubparts } from '@/entities/homework/splitQuestion'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import {
  sectionSources,
  walkthroughId,
  type WalkthroughSection,
} from '@/entities/homework/walkthrough'

interface Call {
  kind: 'frame' | 'question' | 'part'
  /** Question number, and the sub-part for part requests (`2b`). */
  id: string
  system: string
  user: string
}

type Handler = (call: Call, signal?: AbortSignal) => Promise<unknown> | unknown

function classify(system: string, user: string): Call {
  if (system.includes('opening and the closing'))
    return { kind: 'frame', id: 'frame', system, user }
  if (system.includes('ONE sub-part')) {
    const match = user.match(/question (\S+), sub-part \((\w)\) only/)!
    return { kind: 'part', id: `${match[1]}${match[2]}`, system, user }
  }
  return { kind: 'question', id: user.match(/question (\S+)\./)![1]!, system, user }
}

function stubAI(handler: Handler) {
  const calls: Call[] = []
  const streamJSON = vi.fn(
    async (
      messages: Array<{ content: string }>,
      _onDelta: unknown,
      options?: { signal?: AbortSignal },
    ) => {
      const call = classify(messages[0]!.content, messages[1]!.content)
      calls.push(call)
      return { data: await handler(call, options?.signal), raw: {} }
    },
  )
  return {
    calls,
    ids: () => calls.map((call) => call.id),
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

let version = 0
/** A model that answers every kind of request; text carries a version counter. */
const model: Handler = (call) => {
  version += 1
  if (call.kind === 'frame')
    return {
      status: 'ready',
      overview: `Tools v${version}.`,
      summary: `Summary v${version}.`,
      suggestions: [`Redo 1 (v${version}).`],
    }
  if (call.kind === 'part')
    return {
      status: 'ready',
      heading: `Part ${call.id}`,
      conclusion: `(${call.id.slice(-1)}) result ${call.id}`,
      body: `Work for ${call.id} v${version}.`,
    }
  return { status: 'ready', conclusion: `Done ${call.id}.`, body: `Worked ${call.id} v${version}.` }
}

let db: AppDatabase
let setId: string
let projectId: string
let documentId: string

async function setup(subject: 'calculus' | 'linear_algebra', prompts: string[]): Promise<void> {
  db = new AppDatabase()
  setDbForTesting(db)
  projectId = (await new ProjectService(db).create({ name: 'Course', subject })).id
  const doc = await new DocumentRepository(db).create({
    projectId,
    type: 'text',
    materialType: 'homework',
    name: 'hw.pdf',
    sizeBytes: 0,
  })
  documentId = doc.id
  const repo = new HomeworkRepository(db)
  setId = crypto.randomUUID()
  await repo.upsertSet({
    id: setId,
    projectId,
    documentId,
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
      documentId,
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

async function plan() {
  return (await service(null).state(setId)).plan
}
async function section(id: string) {
  return (await plan()).find((entry) => entry.id === id)!
}

const SPLIT_PROMPT = 'Answer each part. (a) Find x. (b) Find y. (c) Find z.'

beforeEach(() => {
  version = 0
})

afterEach(() => {
  db?.close()
})

describe('homework-walkthrough/v2 prompts', () => {
  it('are byte-identical to v1 without a revision block, and keep the v1 cache version', async () => {
    const input = {
      label: '2',
      question: 'Solve it.',
      sourceText: 'Passage.',
      professorAnswer: 'x = 1',
      previousSolution: 'Old.',
      language: 'zh_terms' as const,
    }
    expect(V2.buildQuestionUserPrompt(input)).toBe(V1.buildQuestionUserPrompt(input))
    expect(V2.buildQuestionSystemPrompt({ linearSystems: true })).toBe(
      V1.buildQuestionSystemPrompt({ linearSystems: true }),
    )
    const frame = {
      title: 'HW',
      language: 'en' as const,
      questions: [{ label: '1', question: 'Q', conclusion: 'C', excerpt: 'E' }],
    }
    expect(V2.buildFrameUserPrompt(frame)).toBe(V1.buildFrameUserPrompt(frame))
    expect(V2.buildFrameSystemPrompt()).toBe(V1.buildFrameSystemPrompt())
    expect(prompts.homeworkWalkthrough.VERSION).toBe('v7')
    expect(prompts.homeworkWalkthrough.CACHE_VERSION).toBe('v1')

    await setup('calculus', ['Differentiate x^2.'])
    expect((await service(null).state(setId)).promptVersion).toMatch(/^homework-walkthrough\/v1/)

    const revised = V2.buildQuestionUserPrompt({
      ...input,
      revision: { current: { conclusion: 'Old result', body: 'Old body' }, suggestion: 'Use s.' },
    })
    expect(revised).toContain('Old body')
    expect(revised).toContain('Use s.')
    expect(revised.endsWith('Return JSON only.')).toBe(true)
  })
})

describe('splitting long multipart questions', () => {
  it('detects sub-parts and applies the thresholds', () => {
    expect(walkthroughSubparts(SPLIT_PROMPT).map((part) => part.label)).toEqual(['a', 'b', 'c'])
    expect(walkthroughSubparts('（a）求 x；（b）求 y').map((part) => part.label)).toEqual([
      'a',
      'b',
    ])
    // Letters out of sequence (a formula's (x)) are not sub-parts.
    expect(walkthroughSubparts('Let g (x) = 1. Find g.')).toEqual([])
    expect(shouldSplitWalkthrough(SPLIT_PROMPT)).toBe(true)
    expect(shouldSplitWalkthrough('Do it. (a) x (b) y')).toBe(false)
    expect(shouldSplitWalkthrough(`${'Long context. '.repeat(120)} (a) x (b) y`)).toBe(true)
    expect(shouldSplitWalkthrough('x'.repeat(3_000))).toBe(false)
  })

  it('writes one sub-part per request, saving progress; pause continues with only the rest', async () => {
    await setup('calculus', [SPLIT_PROMPT])
    let run: GenerationRun = createGenerationRun()
    let pauseOnce = true
    const { ai, calls, ids } = stubAI((call) => {
      if (pauseOnce && call.kind === 'part') {
        pauseOnce = false
        run.requestPause()
      }
      return model(call)
    })
    const first = await service(ai).generate(setId, { control: run })
    expect(first).toMatchObject({ paused: true, failed: 0 })
    expect(ids()).toEqual(['1a'])
    const partial = (await section('q:q1')).section!
    expect(partial.status).toBe('partial')
    expect(partial.draft).toMatchObject({ labels: ['a', 'b', 'c'], mode: 'generate' })
    expect(partial.draft!.parts.map((part) => part.label)).toEqual(['a'])
    expect((await section('q:q1')).needsWork).toBe(true)

    calls.length = 0
    run = createGenerationRun()
    expect(await service(ai).resume(setId, { control: run })).toEqual({ generated: 3, failed: 0 })
    // Only the unfinished sub-parts, then the frame.
    expect(ids()).toEqual(['1b', '1c', 'frame', 'frame'])
    // Later sub-parts see the earlier ones.
    expect(calls[1]!.user).toContain('ALREADY WRITTEN (a)')
    expect(calls[1]!.user).toContain('ALREADY WRITTEN (b)')
    const done = (await section('q:q1')).section!
    expect(done.status).toBe('ready')
    expect(done.draft).toBeUndefined()
    expect(done.parts?.map((part) => part.label)).toEqual(['a', 'b', 'c'])
    expect(done.body).toMatch(/^### \(a\) Part 1a\n\nWork for 1a/)
    expect(done.body).toContain('### (c) Part 1c')
    expect(done.conclusion).toBe('(a) result 1a\n\n(b) result 1b\n\n(c) result 1c')
  })

  it('falls back to split mode when a whole-question request ends truncated', async () => {
    await setup('calculus', ['Do it. (a) Find x. (b) Find y.'])
    const { ai, calls } = stubAI((call) => {
      if (call.kind === 'question') throw new OutputTruncatedError(8192)
      return model(call)
    })
    expect(await service(ai).generate(setId)).toEqual({ generated: 3, failed: 0 })
    expect(calls.filter((call) => call.kind === 'part').map((call) => call.id)).toEqual([
      '1a',
      '1b',
    ])
    expect((await section('q:q1')).section).toMatchObject({ status: 'ready' })
    expect((await section('q:q1')).section!.parts).toHaveLength(2)
  })

  it('checks the row reduction of each sub-part under its label', async () => {
    await setup('linear_algebra', [
      'Solve each system with an augmented matrix. (a) x = 1 (b) y = 2 (c) z = 3',
    ])
    const systems: Record<string, unknown> = {
      a: { augmented: [[1, 2, 3]], rref: [[1, 2, 3]], solution: 'infinite' },
      b: {
        label: '#1',
        augmented: [
          [0, 1, 2],
          [2, 0, 1],
        ],
        rref: [
          [1, 0, '1/3'],
          [0, 1, 2],
        ],
        solution: 'unique',
      },
    }
    const { ai, calls } = stubAI((call) => {
      const base = model(call) as Record<string, unknown>
      if (call.kind !== 'part') return base
      const system = systems[call.id.slice(-1)]
      return { ...base, linearSystems: system ? [system] : [] }
    })
    await service(ai).generate(setId)
    expect(calls[0]!.system).toContain('"linearSystems"')
    const checks = (await section('q:q1')).section!.checks!
    expect(checks.map((check) => [check.label, check.rrefMatches])).toEqual([
      ['(a)', true],
      ['(b)', false],
    ])
    expect((await section('q:q1')).section!.parts![1]!.checks).toHaveLength(1)
  })
})

describe('regenerating one section', () => {
  it('rewrites one question with the suggestion, keeps the previous version, and toggles back', async () => {
    await setup('calculus', ['Differentiate x^2.', 'Differentiate x^3.'])
    const { ai, calls } = stubAI(model)
    await service(ai).generate(setId)
    const before = await plan()
    const oldQ2 = before.find((entry) => entry.id === 'q:q2')!.section!
    await new Promise((resolve) => setTimeout(resolve, 5))

    calls.length = 0
    const result = await service(ai).regenerateSection(setId, 'q:q2', {
      suggestion: 'Use s for the free variable.',
    })
    expect(result).toEqual({ generated: 1, failed: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.user).toContain('CURRENT VERSION OF THIS SECTION')
    expect(calls[0]!.user).toContain(oldQ2.body)
    expect(calls[0]!.user).toContain('Use s for the free variable.')

    const after = await plan()
    for (const entry of after) {
      // Only q2 changed; nothing is marked out of date.
      expect(entry.needsWork).toBe(false)
      expect(entry.outdated).toBe(false)
      const old = before.find((item) => item.id === entry.id)!.section!
      if (entry.id === 'q:q2') expect(entry.section!.body).not.toBe(old.body)
      else expect(entry.section).toEqual(old)
    }
    const q2 = after.find((entry) => entry.id === 'q:q2')!.section!
    expect(q2.inputHash).toBe(oldQ2.inputHash)
    expect(q2.previous).toMatchObject({ body: oldQ2.body, conclusion: oldQ2.conclusion })

    await service(ai).restorePrevious(setId, 'q:q2')
    const restored = (await section('q:q2')).section!
    expect(restored.body).toBe(oldQ2.body)
    expect(restored.previous?.body).toBe(q2.body)
    await service(ai).restorePrevious(setId, 'q:q2')
    expect((await section('q:q2')).section!.body).toBe(q2.body)
  })

  it('rewrites only the opening or only the summary', async () => {
    await setup('calculus', ['Differentiate x^2.'])
    const { ai, calls } = stubAI(model)
    await service(ai).generate(setId)
    const oldOverview = (await section('overview')).section!
    const oldSummary = (await section('summary')).section!

    calls.length = 0
    await service(ai).regenerateSection(setId, 'overview', { suggestion: 'Add a table.' })
    expect(calls.map((call) => call.kind)).toEqual(['frame'])
    expect(calls[0]!.user).toContain(oldOverview.body)
    expect(calls[0]!.user).toContain('Add a table.')
    // Only the opening is asked for.
    expect(calls[0]!.system).toContain('ONLY the opening')
    expect(calls[0]!.user).toContain('The student asked for the opening (tools) to be rewritten.')
    const overview = (await section('overview')).section!
    expect(overview.body).not.toBe(oldOverview.body)
    expect(overview.previous?.body).toBe(oldOverview.body)
    expect((await section('summary')).section).toEqual(oldSummary)

    calls.length = 0
    await service(ai).regenerateSection(setId, 'summary', { suggestion: 'Shorter.' })
    expect(calls[0]!.user).toContain('Redo 1 (v')
    const summary = (await section('summary')).section!
    expect(summary.body).not.toBe(oldSummary.body)
    expect(summary.previous).toMatchObject({ body: oldSummary.body })
    expect((await section('overview')).section!.body).toBe(overview.body)
  })

  it('a stopped regeneration leaves the section as it was', async () => {
    await setup('calculus', ['Differentiate x^2.'])
    const stub = stubAI(model)
    await service(stub.ai).generate(setId)
    const old = (await section('q:q1')).section!

    const run = createGenerationRun()
    const hanging = stubAI(
      (_call, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new AbortedError()))
          queueMicrotask(() => run.stopNow())
        }),
    )
    const result = await service(hanging.ai).regenerateSection(setId, 'q:q1', {
      suggestion: 'More detail.',
      control: run,
    })
    expect(result).toMatchObject({ paused: true, stopped: true, generated: 0 })
    expect((await section('q:q1')).section).toEqual(old)
  })

  it('a failed regeneration leaves the section as it was', async () => {
    await setup('calculus', ['Differentiate x^2.'])
    const stub = stubAI(model)
    await service(stub.ai).generate(setId)
    const old = (await section('q:q1')).section!
    const broken = stubAI(() => ({ status: 'ready' }))
    await expect(service(broken.ai).regenerateSection(setId, 'q:q1')).rejects.toThrow()
    expect((await section('q:q1')).section).toEqual(old)
  })

  it('rewrites a split question sub-part by sub-part with the suggestion; a pause keeps the old text', async () => {
    await setup('calculus', [SPLIT_PROMPT])
    const stub = stubAI(model)
    await service(stub.ai).generate(setId)
    const old = (await section('q:q1')).section!
    expect(old.parts).toHaveLength(3)

    let run = createGenerationRun()
    const revised = stubAI((call) => {
      if (call.id === '1a') run.requestPause()
      return model(call)
    })
    const first = await service(revised.ai).regenerateSection(setId, 'q:q1', {
      suggestion: 'More detail.',
      control: run,
    })
    expect(first).toMatchObject({ paused: true })
    const pausedSection = (await section('q:q1')).section!
    // The ready text is unchanged; the rewritten sub-part waits in the draft.
    expect(pausedSection.body).toBe(old.body)
    expect(pausedSection.status).toBe('ready')
    expect(pausedSection.draft).toMatchObject({ mode: 'regenerate', suggestion: 'More detail.' })
    expect(pausedSection.draft!.parts).toHaveLength(1)

    revised.calls.length = 0
    run = createGenerationRun()
    await service(revised.ai).regenerateSection(setId, 'q:q1', {
      suggestion: 'More detail.',
      control: run,
    })
    expect(revised.ids()).toEqual(['1b', '1c'])
    for (const call of revised.calls) {
      expect(call.user).toContain('More detail.')
      // Each sub-part sees its own current version.
      expect(call.user).toContain(`Work for ${call.id}`)
    }
    const done = (await section('q:q1')).section!
    expect(done.draft).toBeUndefined()
    expect(done.body).not.toBe(old.body)
    expect(done.previous?.body).toBe(old.body)
    expect((await section('overview')).outdated).toBe(false)
  })
})

describe('generated and imported sources', () => {
  /** Save an imported version of a section, as 导入讲解 would. */
  async function importSection(id: string, body: string): Promise<void> {
    const state = await service(null).state(setId)
    const entry = state.plan.find((item) => item.id === id)!
    await new WalkthroughRepository(db).putSection(
      { id: walkthroughId(setId, state.language), projectId, setId, language: state.language },
      {
        id,
        kind: entry.kind,
        ...(entry.question ? { questionId: entry.question.id } : {}),
        title: id,
        body,
        status: 'ready',
        origin: 'imported',
        inputHash: entry.inputHash,
        generatedAt: Date.now(),
      },
    )
  }

  it('regenerating keeps the import, shows the new generated version, and keeps the old one as 上一版', async () => {
    await setup('calculus', ['Differentiate x^2.', 'Differentiate x^3.'])
    const { ai, calls } = stubAI(model)
    await service(ai).generate(setId)
    const generated = (await section('q:q1')).section!
    await importSection('q:q1', 'Imported working.')
    let entry = await section('q:q1')
    expect(entry.section!.origin).toBe('imported')
    expect(entry.generated!.body).toBe(generated.body)
    // 可更新 follows the generated source, which is current.
    expect(entry.needsWork).toBe(false)

    calls.length = 0
    await service(ai).regenerateSection(setId, 'q:q1', { suggestion: 'Shorter.' })
    // The generated version is what gets rewritten, not the import shown.
    expect(calls[0]!.user).toContain(generated.body)
    expect(calls[0]!.user).not.toContain('Imported working.')
    entry = await section('q:q1')
    expect(entry.section!.origin).toBeUndefined()
    expect(entry.section!.body).not.toBe(generated.body)
    expect(entry.section!.previous?.body).toBe(generated.body)
    expect(entry.section!.alternate).toMatchObject({
      origin: 'imported',
      body: 'Imported working.',
    })
  })

  it('a forced full run and a section only imported both keep the import', async () => {
    await setup('calculus', ['Differentiate x^2.'])
    const { ai } = stubAI(model)
    await importSection('q:q1', 'Imported only.')
    let entry = await section('q:q1')
    expect(entry.generated).toBeUndefined()
    // Judged by the import alone: nothing to do.
    expect(entry.needsWork).toBe(false)
    await service(ai).generate(setId, { force: true })
    entry = await section('q:q1')
    expect(entry.section!.origin).toBeUndefined()
    expect(entry.section!.previous).toBeUndefined()
    expect(entry.section!.alternate).toMatchObject({ origin: 'imported', body: 'Imported only.' })
    await service(null).setSource(setId, 'q:q1', 'imported')
    expect((await section('q:q1')).section!.body).toBe('Imported only.')
  })

  it('an unfinished or failed generation waits behind the import shown', async () => {
    await setup('calculus', ['Differentiate x^2.'])
    await importSection('q:q1', 'Imported only.')
    const state = await service(null).state(setId)
    const failed: WalkthroughSection = {
      id: 'q:q1',
      kind: 'question',
      questionId: 'q1',
      title: '1',
      body: '',
      status: 'failed',
      error: 'timeout',
      inputHash: 'x',
      generatedAt: 1,
    }
    await new WalkthroughRepository(db).putSection(
      { id: walkthroughId(setId, state.language), projectId, setId, language: state.language },
      failed,
    )
    const entry = await section('q:q1')
    expect(entry.section!.body).toBe('Imported only.')
    expect(entry.generated?.status).toBe('failed')
    expect(entry.needsWork).toBe(true)
    expect(sectionSources(entry.section)).toEqual(['imported'])
  })
})
