import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { parseRational, type Rational } from '@/infrastructure/math/rref'
import {
  allCorrect,
  applyOps,
  buildGuidedChains,
  chainFinished,
  checkCells,
  fillUnchanged,
  judgeOps,
  nextReferenceStep,
  parseTypedOps,
  type GuidedChain,
  type Matrix,
} from '@/entities/homework/guidedMatrix'
import {
  chainsKey,
  guidedHasWork,
  progressFor,
  summarizeProgress,
  type GuidedProgress,
} from '@/entities/homework/guided'
import { validateGuidedSteps, looseMathText } from '@/entities/homework/guidedSteps'
import { hasStudentWork } from '@/entities/homework/matching'
import { gradeBlank } from '@/services/guidedGrading'
import { GuidedStepsService } from '@/services/guidedStepsService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import {
  questionSectionId,
  walkthroughId,
  type WalkthroughSection,
} from '@/entities/homework/walkthrough'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { AIService } from '@/services/aiService'

const m = (rows: Array<Array<number | string>>): Matrix =>
  rows.map((row) => row.map((value) => parseRational(String(value)) as Rational))

const matrixLatex = (rows: Array<Array<number | string>>) =>
  `$$\\left[\\begin{array}{cc|c} ${rows.map((row) => row.join(' & ')).join(' \\\\ ')} \\end{array}\\right]$$`

/** Walkthrough route: scale R1 by 1/2, R2 → R2 − R1, R1 → R1 − 2R2. */
const BODY = [
  '### (a) 解方程组',
  '',
  '增广矩阵为',
  '',
  matrixLatex([
    [2, 4, 6],
    [1, 3, 5],
  ]),
  '',
  '先把第一行的主元化为 1，作 $R_1 \\to \\tfrac{1}{2}R_1$：',
  '',
  matrixLatex([
    [1, 2, 3],
    [1, 3, 5],
  ]),
  '',
  '作 $R_2 \\to R_2 - R_1$：',
  '',
  matrixLatex([
    [1, 2, 3],
    [0, 1, 2],
  ]),
  '',
  '作 $R_1 \\to R_1 - 2R_2$：',
  '',
  matrixLatex([
    [1, 0, -1],
    [0, 1, 2],
  ]),
].join('\n')

function chain(): GuidedChain {
  const chains = buildGuidedChains(BODY)
  expect(chains).toHaveLength(1)
  return chains[0]!
}

describe('typed row operations', () => {
  it.each([
    ['R2 -> R2 - 2R1', { kind: 'combine', target: 1 }],
    ['R_2→R_2-2R_1', { kind: 'combine', target: 1 }],
    ['R2 = R2 - 2R1', { kind: 'combine', target: 1 }],
    ['r2 - 2r1', { kind: 'combine', target: 1 }],
    ['R₂ → R₂ − 2R₁', { kind: 'combine', target: 1 }],
    ['R_2 \\to R_2 - 2R_1', { kind: 'combine', target: 1 }],
    ['R1 <-> R2', { kind: 'swap', a: 0, b: 1 }],
    ['R1 ↔ R2', { kind: 'swap', a: 0, b: 1 }],
    ['交换 R1 R2', { kind: 'swap', a: 0, b: 1 }],
    ['R1 与 R2 互换', { kind: 'swap', a: 0, b: 1 }],
  ])('reads %s', (typed, shape) => {
    const ops = parseTypedOps(typed)
    expect(ops).toHaveLength(1)
    expect(ops![0]).toMatchObject(shape)
  })

  it('reads scalings and several operations at once', () => {
    const start = m([
      [2, 4, 6],
      [1, 3, 5],
    ])
    for (const typed of [
      'R1 -> 1/2 R1',
      'R1 -> (1/2)R1',
      'R1/2',
      '\\frac{1}{2}R_1',
      'R1 -> 0.5R1',
    ]) {
      const applied = applyOps(start, parseTypedOps(typed)!)
      expect(
        applied?.matrix[0]!.map((v) => `${v.n}/${v.d}`),
        typed,
      ).toEqual(['1/1', '2/1', '3/1'])
    }
    const two = parseTypedOps('R2 -> R2 - R1, R3 -> R3 - 2R1')
    expect(two).toHaveLength(2)
    expect(parseTypedOps('add row one to row two')).toBeNull()
    expect(parseTypedOps('')).toBeNull()
  })
})

describe('guided chains from a walkthrough', () => {
  it('parses the operation + matrix steps and keeps their explanations', () => {
    const c = chain()
    expect(c.label).toBe('(a) 解方程组')
    expect(c.steps).toHaveLength(3)
    expect(c.steps[0]!.hint).toContain('主元化为 1')
    expect(c.final).toEqual(
      m([
        [1, 0, -1],
        [0, 1, 2],
      ]),
    )
  })

  it('accepts the walkthrough step, a valid alternative route, and rejects invalid operations', () => {
    const c = chain()
    const onRoute = judgeOps(c, c.start, 'R1 -> 1/2 R1')
    expect(onRoute).toMatchObject({ ok: true, position: 1 })

    // Eliminating before scaling is not what the walkthrough did, but valid progress.
    const own = judgeOps(c, c.start, 'R2 -> R2 - 1/2 R1')
    expect(own.ok).toBe(true)
    expect(own.ok && own.position).toBeNull()

    expect(judgeOps(c, c.start, 'R2 -> 2R1')).toMatchObject({ ok: false, reason: 'not-invertible' })
    expect(judgeOps(c, c.start, 'R2 -> 0R2')).toMatchObject({ ok: false, reason: 'not-invertible' })
    expect(judgeOps(c, c.start, 'R5 -> R5 - R1')).toMatchObject({
      ok: false,
      reason: 'out-of-range',
    })
    expect(judgeOps(c, c.start, 'R1 -> R1')).toMatchObject({ ok: false, reason: 'no-change' })
    expect(judgeOps(c, c.start, 'R1 -> R1 + R2')).toMatchObject({
      ok: false,
      reason: 'no-progress',
    })
    expect(judgeOps(c, c.start, 'R2 -> ??')).toMatchObject({ ok: false, reason: 'unreadable' })
  })

  it('an alternative route still finishes at the walkthrough RREF', () => {
    const c = chain()
    let current = c.start
    for (const typed of ['R2 -> R2 - 1/2 R1', 'R1 -> 1/2 R1', 'R1 -> R1 - 2R2']) {
      const verdict = judgeOps(c, current, typed)
      expect(verdict.ok, typed).toBe(true)
      if (verdict.ok) current = verdict.applied.matrix
    }
    expect(chainFinished(c, current)).toBe(true)
    // Off the route the reference is the next Gauss–Jordan operation.
    const off = applyOps(c.start, parseTypedOps('R2 -> R2 - 1/2 R1')!)!.matrix
    expect(nextReferenceStep(c, off)).toMatchObject({ fromWalkthrough: false })
    expect(nextReferenceStep(c, c.start)).toMatchObject({ fromWalkthrough: true })
  })
})

describe('cell checking', () => {
  const expected = m([
    [1, '-2/5', 3],
    [0, '1/3', 2],
  ])
  const provenance = applyOps(
    m([
      [1, 0, 3],
      [0, 1, 6],
    ]),
    parseTypedOps('R2 -> 1/3 R2')!,
  )!.provenance

  it('accepts fractions and decimals exactly, flags wrong cells with their arithmetic', () => {
    const checks = checkCells(
      expected,
      [
        ['1', '−0.4', '3'],
        ['0', '1/3', '2'],
      ],
      provenance,
    )
    expect(allCorrect(checks)).toBe(true)
    const exact = checkCells(
      expected,
      [
        ['1', '-2/5', '3'],
        ['0', '1/3', '2'],
      ],
      provenance,
    )
    expect(allCorrect(exact)).toBe(true)
    expect(checks[0]![1]!.status).toBe('correct')

    const wrong = checkCells(
      expected,
      [
        ['1', '-2/5', '3'],
        ['0', '0.333', '3'],
      ],
      provenance,
    )
    expect(wrong[1]![1]!.status).toBe('inexact')
    expect(wrong[1]![2]!.status).toBe('wrong')
    expect(wrong[1]![2]!.arithmetic?.latex).toContain('\\cdot')
    expect(wrong[1]![2]!.arithmetic?.latex).not.toContain(' = ')

    const odd = checkCells(
      expected,
      [
        ['', 'x', '3'],
        ['0', '1/3', '2'],
      ],
      provenance,
    )
    expect(odd[0]![0]!.status).toBe('empty')
    expect(odd[0]![1]!.status).toBe('unreadable')
  })

  it('fills only the rows the step leaves unchanged', () => {
    const filled = fillUnchanged(
      [
        ['', '', ''],
        ['', '7', ''],
      ],
      m([
        [1, '-2/5', 3],
        [0, 1, 6],
      ]),
      provenance,
    )
    expect(filled).toEqual([
      ['1', '-2/5', '3'],
      ['', '7', ''],
    ])
  })
})

describe('progress', () => {
  it('summarises steps, hints and viewed answers and counts as student work', () => {
    const c = chain()
    const progress: GuidedProgress = {
      ...progressFor(undefined, 'matrix', chainsKey([c]), 1),
      chains: [
        {
          records: [
            { op: 'R_1 \\to \\tfrac{1}{2}R_1', hintViewed: true },
            { op: 'R_2 \\to R_2 - R_1', answerViewed: true },
            { op: 'R_1 \\to R_1 - 2R_2' },
          ],
          done: true,
        },
      ],
    }
    expect(summarizeProgress(progress)).toEqual({
      stepsDone: 3,
      hintsViewed: 1,
      answersViewed: 1,
      complete: true,
    })
    expect(guidedHasWork(progress)).toBe(true)
    expect(hasStudentWork({ draftText: '', guidedProgress: progress })).toBe(true)
    expect(guidedHasWork(progressFor(undefined, 'matrix', 'k', 1))).toBe(false)
    // Progress made for other steps starts afresh.
    expect(progressFor(progress, 'matrix', 'other-key', 1).chains![0]!.records).toEqual([])
    expect(progressFor(progress, 'matrix', progress.key, 1)).toBe(progress)
  })
})

describe('blank steps (non-matrix subjects)', () => {
  const walkthrough =
    '由 $v = v_0 + at$ 得 $v = 9.8\\,\\mathrm{m/s^2} \\cdot 2\\,\\mathrm{s} = 19.6\\,\\mathrm{m/s}$。原函数为 $\\frac{x^{2}}{2} + C$。'

  it('drops blanks whose answer is not in the walkthrough and keeps the rest', () => {
    const { steps, droppedBlanks } = validateGuidedSteps(
      {
        steps: [
          {
            title: '速度',
            text: '末速度 $v =$ [[1]]，加速度 [[2]]',
            explanation: '匀加速运动。',
            blanks: [
              { id: '1', answer: '19.6 m/s', kind: 'quantity' },
              { id: '2', answer: '12 m/s^2', kind: 'quantity' },
            ],
          },
          {
            text: '原函数 [[1]]',
            explanation: '',
            blanks: [{ id: '1', answer: 'x^2/2', kind: 'chemistry' }],
          },
        ],
      },
      walkthrough,
      'physics',
    )
    expect(droppedBlanks).toBe(1)
    expect(steps[0]!.blanks.map((blank) => blank.id)).toEqual(['1'])
    expect(steps[0]!.text).toContain('…')
    expect(steps[0]!.text).not.toContain('[[2]]')
    // A kind physics does not grade falls back to an accepted-answers list.
    expect(steps[1]!.blanks[0]!.kind).toBe('text')
    expect(looseMathText('\\dfrac{1}{2}')).toBe(looseMathText('1/2'))
  })

  it('grades each blank kind with the matching local grader', () => {
    expect(gradeBlank({ id: '1', answer: 'x^2/2', kind: 'expression' }, '0.5*x^2').verdict).toBe(
      'correct',
    )
    expect(gradeBlank({ id: '1', answer: 'x^2/2', kind: 'expression' }, 'x^2').verdict).toBe(
      'wrong',
    )
    expect(
      gradeBlank({ id: '1', answer: '19.6 m/s', kind: 'quantity' }, '70.56 km/h').verdict,
    ).toBe('correct')
    expect(gradeBlank({ id: '1', answer: '19.6 m/s', kind: 'quantity' }, '19.6')).toEqual({
      verdict: 'wrong',
      reason: 'missing-unit',
    })
    expect(
      gradeBlank({ id: '1', answer: '2H2 + O2 -> 2H2O', kind: 'chemistry' }, '4H2 + 2O2 -> 4H2O')
        .verdict,
    ).toBe('correct')
    expect(
      gradeBlank({ id: '1', answer: '2H2 + O2 -> 2H2O', kind: 'chemistry' }, 'H2 + O2 -> H2O'),
    ).toMatchObject({ verdict: 'wrong', reason: 'unbalanced' })
    expect(gradeBlank({ id: '1', answer: '0.0455', kind: 'number' }, '0.0456').verdict).toBe(
      'correct',
    )
    expect(gradeBlank({ id: '1', answer: '0.0455', kind: 'number' }, '0.05').verdict).toBe('wrong')
    expect(
      gradeBlank(
        { id: '1', answer: '乙酰胆碱', kind: 'text', accepted: ['acetylcholine', 'ACh'] },
        'ACh',
      ).verdict,
    ).toBe('correct')
    expect(gradeBlank({ id: '1', answer: '[1, 2]', kind: 'exact' }, '[1, 2]  ').verdict).toBe(
      'correct',
    )
    expect(gradeBlank({ id: '1', answer: '[1, 2]', kind: 'exact' }, '[1,2]').verdict).toBe('wrong')
    expect(gradeBlank({ id: '1', answer: '3', kind: 'number' }, ' ').verdict).toBe('empty')
  })
})

// --- Service: steps from the stored walkthrough, cache, persistence ---------------

let db: AppDatabase
let projectId: string
const setId = 'set-1'

async function seed(subject: 'linear_algebra' | 'physics', section: Partial<WalkthroughSection>) {
  projectId = (await new ProjectService(db).create({ name: 'Course', subject })).id
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId,
    type: 'text',
    materialType: 'homework',
    name: 'hw.txt',
    sizeBytes: 0,
  })
  const repo = new HomeworkRepository(db)
  const set: HomeworkSet = {
    id: setId,
    projectId,
    documentId: doc.id,
    documentName: 'hw.txt',
    title: 'HW',
    status: 'ready',
    language: 'zh',
    questionCount: 1,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  }
  await repo.upsertSet(set)
  const question: HomeworkQuestion = {
    id: 'q1',
    projectId,
    setId,
    documentId: doc.id,
    documentName: 'hw.txt',
    order: 0,
    number: '1',
    prompt: 'Solve.',
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
  await new WalkthroughRepository(db).putSection(
    { id: walkthroughId(setId, 'zh_terms'), projectId, setId, language: 'zh_terms' },
    {
      id: questionSectionId('q1'),
      kind: 'question',
      questionId: 'q1',
      title: '1',
      body: '',
      status: 'ready',
      inputHash: 'h',
      generatedAt: 1,
      ...section,
    },
  )
}

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

describe('GuidedStepsService', () => {
  it('builds matrix steps locally (no AI) and restores saved progress', async () => {
    await seed('linear_algebra', { body: BODY })
    const service = new GuidedStepsService({ ai: null, db })
    const state = await service.load(setId, 'q1')
    expect(state.source.kind).toBe('matrix')
    expect(state.progress?.chains).toHaveLength(1)

    const progress: GuidedProgress = {
      ...state.progress!,
      chains: [{ records: [{ op: 'R_1 \\to \\tfrac{1}{2}R_1' }], pending: { typedOp: 'R2 -' } }],
    }
    await service.saveProgress('q1', progress)
    const again = await service.load(setId, 'q1')
    expect(again.progress?.chains?.[0]?.records).toHaveLength(1)
    expect(again.progress?.chains?.[0]?.pending?.typedOp).toBe('R2 -')
    const stored = await new HomeworkRepository(db).getQuestion('q1')
    expect(hasStudentWork(stored!)).toBe(true)

    await service.resetProgress('q1')
    expect((await service.load(setId, 'q1')).progress?.chains?.[0]?.records).toEqual([])
  })

  it('prefers the detailed walkthrough', async () => {
    await seed('linear_algebra', {
      body: 'No matrices here.',
      variants: { detailed: { body: BODY, inputHash: 'h', generatedAt: 2 } },
    })
    const state = await new GuidedStepsService({ ai: null, db }).load(setId, 'q1')
    expect(state.level).toBe('detailed')
    expect(state.source.kind).toBe('matrix')
  })

  it('converts other questions with one request, validates and caches the steps', async () => {
    const body = '由 $v = at$ 得 $v = 19.6\\,\\mathrm{m/s}$。'
    await seed('physics', { body })
    const chatJSON = vi.fn(async () => ({
      data: {
        steps: [
          {
            text: '$v =$ [[1]]',
            explanation: '匀加速',
            blanks: [
              { id: '1', answer: '19.6 m/s', kind: 'quantity' },
              { id: '2', answer: '7 m', kind: 'quantity' },
            ],
          },
        ],
      },
      raw: {},
    }))
    const ai = { chatJSON, maxOutputTokens: 4096 } as unknown as AIService
    const service = new GuidedStepsService({ ai, db })
    expect((await service.load(setId, 'q1')).source.kind).toBe('needs-steps')
    const prepared = await service.prepareSteps(setId, 'q1')
    expect(prepared.source.kind).toBe('blanks')
    expect(chatJSON).toHaveBeenCalledTimes(1)
    const [messages] = chatJSON.mock.calls[0] as unknown as [Array<{ content: string }>]
    expect(messages[0]!.content).toContain('blanks')
    // Cached on the section: loading again needs no request.
    const again = await new GuidedStepsService({ ai: null, db }).load(setId, 'q1')
    expect(again.source.kind).toBe('blanks')
    expect(again.source.kind === 'blanks' && again.source.steps[0]!.blanks).toHaveLength(1)
  })

  it('a stopped request leaves nothing saved', async () => {
    await seed('physics', { body: 'v = 19.6 m/s' })
    const controller = new AbortController()
    const chatJSON = vi.fn(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    const service = new GuidedStepsService({
      ai: { chatJSON, maxOutputTokens: 4096 } as unknown as AIService,
      db,
    })
    await expect(service.prepareSteps(setId, 'q1', { signal: controller.signal })).rejects.toThrow()
    expect((await service.load(setId, 'q1')).source.kind).toBe('needs-steps')
  })
})
