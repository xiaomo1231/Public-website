import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { OutputTruncatedError } from '@/infrastructure/ai/errors'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import {
  mergeOverviews,
  mergeSummaries,
  renderOverview,
  renderSummary,
} from '@/entities/homework/walkthroughFrame'
import { prompts } from '@/infrastructure/ai/prompts'
import { t } from '@/i18n'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'

interface Call {
  kind: 'overview' | 'summary' | 'question'
  labels: string[]
  maxTokens: number
  user: string
}

function classify(system: string, user: string, maxTokens: number): Call {
  const labels = [...user.matchAll(/^Question (\S+)$/gm)].map((match) => match[1]!)
  if (system.includes('ONLY the opening')) return { kind: 'overview', labels, maxTokens, user }
  if (system.includes('ONLY the closing summary'))
    return { kind: 'summary', labels, maxTokens, user }
  return { kind: 'question', labels: [user.match(/question (\S+)\./)![1]!], maxTokens, user }
}

/**
 * A model whose opening / summary replies fit only `fits` questions at once:
 * a larger group is cut off at any budget. Question sections always fit.
 */
function stubAI(
  fits: number,
  options: { onCall?: (call: Call) => void; cap?: number; truncateBelow?: number } = {},
) {
  const calls: Call[] = []
  const streamJSON = vi.fn(
    async (messages: Array<{ content: string }>, _delta: unknown, opts: { maxTokens: number }) => {
      const call = classify(messages[0]!.content, messages[1]!.content, opts.maxTokens)
      calls.push(call)
      options.onCall?.(call)
      if (call.kind === 'question')
        return {
          data: { status: 'ready', conclusion: `Done ${call.labels[0]}.`, body: 'Work.' },
          raw: {},
        }
      if (call.labels.length > fits || opts.maxTokens < (options.truncateBelow ?? 0))
        throw new OutputTruncatedError(opts.maxTokens)
      if (call.kind === 'overview')
        return {
          data: {
            status: 'ready',
            intro: 'Derivatives.',
            tools: [
              { name: 'Power rule', body: `Used in ${call.labels.join(', ')}.` },
              { name: `Tool ${call.labels[0]}`, body: 'Only here.' },
            ],
          },
          raw: {},
        }
      return {
        data: {
          status: 'ready',
          kinds: [{ name: 'Polynomial', questions: call.labels, note: 'x to a power' }],
          ideas: ['Bring the power down.'],
          suggestions: [`Redo ${call.labels[0]}.`],
        },
        raw: {},
      }
    },
  )
  return {
    calls,
    ai: {
      streamJSON,
      chatJSON: streamJSON,
      maxOutputTokens: options.cap ?? 8192,
      modelMaxOutputTokens: options.cap ?? 8192,
    } as unknown as AIService,
  }
}

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
  await documents.update(doc.id, { status: 'ready' })
  const repo = new HomeworkRepository(db)
  setId = crypto.randomUUID()
  const set: HomeworkSet = {
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
  }
  await repo.upsertSet(set)
  for (let i = 1; i <= 4; i++) {
    const question: HomeworkQuestion = {
      id: `q${i}`,
      projectId,
      setId,
      documentId: doc.id,
      documentName: 'hw.pdf',
      order: i - 1,
      number: String(i),
      prompt: `Differentiate x^${i + 1}.`,
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
})

const service = (ai: AIService | null) =>
  new HomeworkWalkthroughService({ ai, db, homework: new HomeworkService({ ai, db }) })

const section = async (id: string) =>
  (await service(null).state(setId)).plan.find((entry) => entry.id === id)!.section

describe('opening and summary as separate requests', () => {
  it('asks for the opening and the summary separately when both fit', async () => {
    const { ai, calls } = stubAI(4)
    expect(await service(ai).generate(setId)).toEqual({ generated: 6, failed: 0 })
    const frame = calls.filter((call) => call.kind !== 'question')
    expect(frame.map((call) => [call.kind, call.labels])).toEqual([
      ['overview', ['1', '2', '3', '4']],
      ['summary', ['1', '2', '3', '4']],
    ])
    // A single group carries no "group i of n" note.
    expect(frame[0]!.user).not.toContain('group 1 of')
    const overview = (await section('overview'))!
    expect(overview.status).toBe('ready')
    expect(overview.body).toContain('### Power rule')
    expect(overview.frameDraft).toBeUndefined()
    const summary = (await section('summary'))!
    expect(summary.body).toContain('| Polynomial | 1, 2, 3, 4 | x to a power |')
    expect(summary.suggestions).toEqual(['Redo 1.'])
  })
})

describe('a part too long for one reply', () => {
  it('doubles the budget up to the resolved cap, past the old 16k ceiling', async () => {
    const { ai, calls } = stubAI(4, { cap: 64_000, truncateBelow: 40_000 })
    expect(await service(ai).generate(setId)).toEqual({ generated: 6, failed: 0 })
    const budgets = calls.filter((call) => call.kind === 'overview').map((call) => call.maxTokens)
    expect(budgets.at(-1)).toBeGreaterThanOrEqual(40_000)
    expect(Math.max(...budgets)).toBeLessThanOrEqual(64_000)
  })

  it('is split into halves recursively and merged locally', async () => {
    const { ai, calls } = stubAI(1)
    expect(await service(ai).generate(setId)).toEqual({ generated: 6, failed: 0 })
    const overviewCalls = calls.filter((call) => call.kind === 'overview')
    // The whole assignment, then halves, then single questions (the budget grew
    // to the cap before each split).
    expect(overviewCalls.map((call) => call.labels.join(''))).toEqual([
      ...Array(2).fill('1234'),
      ...Array(2).fill('12'),
      '1',
      '2',
      ...Array(2).fill('34'),
      '3',
      '4',
    ])
    expect(Math.max(...overviewCalls.map((call) => call.maxTokens))).toBe(8192)
    expect(overviewCalls.find((call) => call.labels.join('') === '3')!.user).toContain(
      'group 3 of 4',
    )
    const overview = (await section('overview'))!
    // The shared tool once, each group's own tool kept.
    expect(overview.body.match(/### Power rule/g)).toHaveLength(1)
    for (const label of ['1', '2', '3', '4']) expect(overview.body).toContain(`### Tool ${label}`)
    const summary = (await section('summary'))!
    expect(summary.body).toContain('| Polynomial | 1, 2, 3, 4 | x to a power |')
    expect(summary.body.match(/Bring the power down/g)).toHaveLength(1)
    expect(summary.suggestions).toEqual(['Redo 1.', 'Redo 2.', 'Redo 3.', 'Redo 4.'])
  })

  it('a pause between groups keeps the finished ones; continuing asks only for the rest', async () => {
    let run: GenerationRun = createGenerationRun()
    let overviewPieces = 0
    const first = stubAI(2, {
      onCall: (call) => {
        if (call.kind === 'overview' && call.labels.length <= 2 && ++overviewPieces === 1)
          run.requestPause()
      },
    })
    const paused = await service(first.ai).generate(setId, { control: run })
    expect(paused).toMatchObject({ paused: true })
    const draft = (await section('overview'))!
    expect(draft.status).toBe('partial')
    expect(draft.frameDraft!.groups).toEqual([
      ['q:q1', 'q:q2'],
      ['q:q3', 'q:q4'],
    ])
    expect(Object.keys(draft.frameDraft!.pieces)).toEqual(['q:q1,q:q2'])

    run = createGenerationRun()
    const second = stubAI(2)
    await service(second.ai).resume(setId, { control: run })
    // No whole-assignment request again: only the missing group, then the summary.
    expect(
      second.calls.filter((call) => call.kind === 'overview').map((call) => call.labels),
    ).toEqual([['3', '4']])
    const overview = (await section('overview'))!
    expect(overview.status).toBe('ready')
    expect(overview.frameDraft).toBeUndefined()
    expect(overview.body).toContain('### Tool 1')
    expect(overview.body).toContain('### Tool 3')
  })

  it('says how large the model limit is when even one question does not fit', async () => {
    const { ai } = stubAI(0)
    const result = await service(ai).generate(setId)
    expect(result.failed).toBe(2)
    const overview = (await section('overview'))!
    expect(overview.status).toBe('failed')
    expect(overview.error).toBe(t('friendlyError.outputTruncatedModelMax', { limit: 8192 }))
    // The finished groups are kept for the next run.
    expect(overview.frameDraft!.groups.length).toBeGreaterThan(1)
  })
})

describe('merging pieces', () => {
  it('dedupes tools by name and unites kinds', () => {
    const overview = mergeOverviews([
      { intro: 'A', tools: [{ name: 'Chain rule', body: 'short' }] },
      {
        intro: 'A',
        tools: [
          { name: 'chain  rule', body: 'a longer body' },
          { name: 'Product rule', body: 'x' },
        ],
      },
    ])
    expect(overview.tools).toEqual([
      { name: 'Chain rule', body: 'a longer body' },
      { name: 'Product rule', body: 'x' },
    ])
    expect(renderOverview(overview)).toBe(
      'A\n\n### Chain rule\n\na longer body\n\n### Product rule\n\nx',
    )
    const summary = mergeSummaries([
      {
        text: '',
        kinds: [{ name: 'Unique', questions: ['1'], note: '' }],
        ideas: [],
        suggestions: [],
      },
      {
        text: '',
        kinds: [{ name: 'unique', questions: ['3'], note: '' }],
        ideas: [],
        suggestions: [],
      },
    ])
    expect(summary.kinds).toEqual([{ name: 'Unique', questions: ['1', '3'], note: '' }])
    expect(renderSummary(summary, 'zh_terms').body).toBe(
      '| 类型 | 题目 |\n|---|---|\n| Unique | 1, 3 |',
    )
  })

  it('accepts a reply written as one text', () => {
    expect(
      prompts.homeworkWalkthrough.normalizeOverviewPart({
        status: 'ready',
        overview: 'Intro.\n### Row operations\n1. Swap.',
      }),
    ).toEqual({ intro: 'Intro.', tools: [{ name: 'Row operations', body: '1. Swap.' }] })
    expect(
      prompts.homeworkWalkthrough.normalizeSummaryPart({ status: 'ready', summary: 'Text.' }),
    ).toEqual({ text: 'Text.', kinds: [], ideas: [], suggestions: [] })
  })
})
