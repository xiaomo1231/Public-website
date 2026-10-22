import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import {
  detailedVariant,
  missingDetailed,
  sectionContent,
  sectionLevel,
} from '@/entities/homework/walkthrough'
import * as V3 from '@/infrastructure/ai/prompts/homework-walkthrough/v3'
import * as V4 from '@/infrastructure/ai/prompts/homework-walkthrough/v4'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'

interface Call {
  kind: 'frame' | 'question' | 'part' | 'variant'
  id: string
  system: string
  user: string
}

function classify(system: string, user: string): Call {
  if (system.includes('opening and the closing'))
    return { kind: 'frame', id: 'frame', system, user }
  const part = user.match(/question (\S+), sub-part \((\w)\)/)
  if (system.includes('at a different level of detail'))
    return {
      kind: 'variant',
      id: part ? `${part[1]}${part[2]}` : user.match(/question (\S+)\./)![1]!,
      system,
      user,
    }
  if (system.includes('ONE sub-part'))
    return { kind: 'part', id: `${part![1]}${part![2]}`, system, user }
  return { kind: 'question', id: user.match(/question (\S+)\./)![1]!, system, user }
}

type Handler = (call: Call) => unknown

function stubAI(handler: Handler) {
  const calls: Call[] = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const call = classify(messages[0]!.content, messages[1]!.content)
    calls.push(call)
    return { data: await handler(call), raw: {} }
  })
  return {
    calls,
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

let counter = 0
const model: Handler = (call) => {
  counter += 1
  if (call.kind === 'frame')
    return { status: 'ready', overview: 'Tools.', summary: 'Summary.', suggestions: [] }
  if (call.kind === 'part')
    return {
      status: 'ready',
      heading: `Part ${call.id}`,
      conclusion: `result ${call.id}`,
      body: `Work for ${call.id}.`,
    }
  if (call.kind === 'variant')
    return {
      status: 'ready',
      conclusion: `Done ${call.id}.`,
      body: `Detailed ${call.id} v${counter}.`,
    }
  return { status: 'ready', conclusion: `Done ${call.id}.`, body: `Worked ${call.id}.` }
}

let db: AppDatabase
let setId: string

async function setup(subject: 'calculus' | 'linear_algebra', prompts: string[]): Promise<void> {
  db = new AppDatabase()
  setDbForTesting(db)
  const projectId = (await new ProjectService(db).create({ name: 'Course', subject })).id
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
    const question: HomeworkQuestion = {
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
    await repo.upsertQuestion(question)
  }
}

const service = (ai: AIService | null) =>
  new HomeworkWalkthroughService({ ai, db, homework: new HomeworkService({ ai, db }) })

async function plan() {
  return (await service(null).state(setId)).plan
}
async function section(id: string) {
  return (await plan()).find((entry) => entry.id === id)!.section!
}

beforeEach(() => {
  counter = 0
})

afterEach(() => {
  db?.close()
})

describe('homework-walkthrough/v4 prompts', () => {
  it('are byte-identical to v3 without the new options; with steps they carry the step format', () => {
    for (const linearSystems of [true, false]) {
      expect(V4.buildQuestionSystemPrompt({ linearSystems, analysis: true })).toBe(
        V3.buildQuestionSystemPrompt({ linearSystems, analysis: true }),
      )
      expect(V4.buildPartSystemPrompt({ linearSystems, punctuation: true })).toBe(
        V3.buildPartSystemPrompt({ linearSystems, punctuation: true }),
      )
    }
    const steps = V4.buildQuestionSystemPrompt({ linearSystems: true, analysis: true, steps: true })
    expect(steps).toContain(V4.STEP_FORMAT_RULE)
    expect(steps).toContain(V4.EMPHASIS_RULE)
    expect(V4.CACHE_VERSION).toBe('v1')
  })
})

describe('普通版 / 详细版', () => {
  it('writes the detailed version from the standard one and keeps both', async () => {
    await setup('calculus', ['Differentiate x^2.', 'Differentiate x^3.'])
    const { ai, calls } = stubAI(model)
    await service(ai).generate(setId)
    const standard = await section('q:q1')
    expect(calls.find((call) => call.kind === 'question')!.system).toContain(V4.STEP_FORMAT_RULE)

    calls.length = 0
    expect(await service(ai).generateVariants(setId, { sectionIds: ['q:q1'] })).toEqual({
      generated: 1,
      failed: 0,
    })
    expect(calls.map((call) => [call.kind, call.id])).toEqual([['variant', '1']])
    // The model sees the existing (standard) version and is told to keep it consistent.
    expect(calls[0]!.user).toContain('EXISTING STANDARD VERSION')
    expect(calls[0]!.user).toContain(standard.body)
    expect(calls[0]!.system).toContain('DETAILED VERSION')

    const stored = await section('q:q1')
    expect(stored.body).toBe(standard.body)
    expect(stored.inputHash).toBe(standard.inputHash)
    expect(detailedVariant(stored)!.body).toBe('Detailed 1 v5.')
    expect(sectionContent(stored, 'standard')!.body).toBe(standard.body)
    expect(sectionContent(stored, 'detailed')!.body).toBe('Detailed 1 v5.')
    // Nothing is out of date after adding a version.
    expect((await plan()).every((entry) => !entry.needsWork)).toBe(true)
  })

  it('remembers the version shown per section and for all sections', async () => {
    await setup('calculus', ['Differentiate x^2.', 'Differentiate x^3.'])
    const { ai } = stubAI(model)
    await service(ai).generate(setId)
    await service(null).setLevel(setId, ['q:q2'], 'detailed')
    expect(sectionLevel(await section('q:q2'), 'standard')).toBe('detailed')
    expect(sectionLevel(await section('q:q1'), 'standard')).toBe('standard')
    // The opening never has levels.
    expect(sectionLevel(await section('overview'), 'detailed')).toBe('standard')
    await service(null).setLevel(setId, 'all', 'detailed')
    expect((await section('q:q1')).level).toBe('detailed')
    expect((await section('overview')).level).toBeUndefined()
    await service(null).setLevel(setId, 'all', 'standard')
    expect((await section('q:q2')).level).toBe('standard')
  })

  it('全部切到详细版 writes only the missing versions, pausable and resumable', async () => {
    await setup('calculus', ['Q one.', 'Q two.', 'Q three.', 'Q four.'])
    const { ai, calls } = stubAI(model)
    await service(ai).generate(setId)
    await service(ai).generateVariants(setId, { sectionIds: ['q:q2'] })
    const all = (await plan()).map((entry) => entry.section!)
    expect(missingDetailed(all).map((item) => item.id)).toEqual(['q:q1', 'q:q3', 'q:q4'])

    // Pause during the first request: the two in flight finish, nothing new starts.
    let run: GenerationRun = createGenerationRun()
    const pausing = stubAI((call) => {
      run.requestPause()
      return model(call)
    })
    const first = await service(pausing.ai).generateVariants(setId, { control: run })
    expect(first).toMatchObject({ paused: true, generated: 2, failed: 0 })
    expect(pausing.calls.map((call) => call.id)).toEqual(['1', '3'])

    // 继续 writes only the one left; q2 (already written) is never asked again.
    calls.length = 0
    run = createGenerationRun()
    expect(await service(ai).resume(setId, { control: run })).toEqual({ generated: 1, failed: 0 })
    expect(calls.map((call) => [call.kind, call.id])).toEqual([['variant', '4']])
    expect(missingDetailed((await plan()).map((entry) => entry.section!))).toEqual([])
  })

  it('checks the row reduction of the detailed version too', async () => {
    await setup('linear_algebra', ['Solve the system with an augmented matrix.'])
    const { ai } = stubAI((call) => {
      const base = model(call) as Record<string, unknown>
      if (call.kind !== 'variant' && call.kind !== 'question') return base
      return {
        ...base,
        linearSystems: [
          {
            label: '(a)',
            augmented: [
              [1, 1, 2],
              [1, -1, 0],
            ],
            // Correct for the standard version, wrong for the detailed one.
            rref:
              call.kind === 'question'
                ? [
                    [1, 0, 1],
                    [0, 1, 1],
                  ]
                : [
                    [1, 0, 2],
                    [0, 1, 1],
                  ],
            solution: 'unique',
          },
        ],
      }
    })
    await service(ai).generate(setId)
    await service(ai).generateVariants(setId)
    const stored = await section('q:q1')
    expect(stored.checks!.map((check) => check.rrefMatches)).toEqual([true])
    expect(detailedVariant(stored)!.checks!.map((check) => check.rrefMatches)).toEqual([false])
  })

  it('重新生成这一节 rewrites only the version shown; 恢复上一版 swaps it back', async () => {
    await setup('calculus', ['Differentiate x^2.'])
    const { ai, calls } = stubAI(model)
    await service(ai).generate(setId)
    await service(ai).generateVariants(setId)
    const before = await section('q:q1')
    const oldDetailed = detailedVariant(before)!

    calls.length = 0
    expect(
      await service(ai).regenerateSection(setId, 'q:q1', {
        level: 'detailed',
        suggestion: 'More fractions.',
      }),
    ).toEqual({ generated: 1, failed: 0 })
    expect(calls.map((call) => call.kind)).toEqual(['variant'])
    expect(calls[0]!.user).toContain('CURRENT DETAILED VERSION TO REWRITE')
    expect(calls[0]!.user).toContain(oldDetailed.body)
    expect(calls[0]!.user).toContain('More fractions.')
    const after = await section('q:q1')
    expect(after.body).toBe(before.body)
    expect(detailedVariant(after)!.body).not.toBe(oldDetailed.body)
    expect(after.previous).toMatchObject({ level: 'detailed', body: oldDetailed.body })

    await service(ai).restorePrevious(setId, 'q:q1')
    const restored = await section('q:q1')
    expect(detailedVariant(restored)!.body).toBe(oldDetailed.body)
    expect(restored.body).toBe(before.body)

    // The standard version rewritten on its own keeps the detailed one.
    calls.length = 0
    await service(ai).regenerateSection(setId, 'q:q1')
    expect(calls.map((call) => call.kind)).toEqual(['question'])
    expect(detailedVariant(await section('q:q1'))!.body).toBe(oldDetailed.body)
  })

  it('writes a split question one sub-part at a time at the detailed level', async () => {
    await setup('calculus', ['Answer each part. (a) Find x. (b) Find y. (c) Find z.'])
    const { ai, calls } = stubAI(model)
    await service(ai).generate(setId)
    expect((await section('q:q1')).parts).toHaveLength(3)
    calls.length = 0
    await service(ai).generateVariants(setId)
    expect(calls.map((call) => call.id)).toEqual(['1a', '1b', '1c'])
    expect(calls[1]!.user).toContain('Work for 1b.')
    const variant = detailedVariant(await section('q:q1'))!
    expect(variant.parts!.map((part) => part.label)).toEqual(['a', 'b', 'c'])
    expect(variant.parts![0]!.heading).toBe('Part 1a')
    expect(variant.body).toContain('### (b) Part 1b')
  })
})
