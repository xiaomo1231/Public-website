import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { PracticeSetService } from '@/services/practiceSetService'
import { DataManagementService } from '@/services/dataManagementService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import {
  matrixToLatex,
  parseMatrix,
  rref,
  sameReducedMatrix,
  solutionKind,
  type SolutionKind,
} from '@/infrastructure/math/rref'
import {
  buildLinearSystem,
  eliminationFractions,
  freeCount,
} from '@/entities/homework/practice/linearSystem'
import { createRng } from '@/entities/homework/practice/random'
import { compactCount, summaryKnowledge } from '@/entities/homework/practice/plan'
import { checkPracticeAnswer } from '@/entities/homework/practice/verify'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { WalkthroughSection } from '@/entities/homework/walkthrough'
import type { GenerationControl } from '@/shared/lib/generationControl'

type Handler = (kind: 'generate' | 'review', user: string) => unknown

function stubAI(handler: Handler) {
  const calls: Array<{ kind: 'generate' | 'review'; user: string }> = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const system = messages[0]!.content
    const user = messages[1]!.content
    const kind = system.includes('You review NEW practice questions') ? 'review' : 'generate'
    calls.push({ kind, user })
    return { data: await handler(kind, user), raw: {} }
  })
  return {
    calls,
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

const reviewIds = (user: string): string[] =>
  [...user.matchAll(/\[(p\d+)\] mode/g)].map((match) => match[1]!)

const passAll = (user: string) => ({
  results: reviewIds(user).map((id) => ({ id, pass: true, reason: 'ok' })),
})

let db: AppDatabase
let projectId: string
let parentId: string
let documentId: string
let repo: HomeworkRepository

const SYSTEMS: Record<SolutionKind, string[][]> = {
  none: [
    ['1', '1', '2'],
    ['2', '2', '5'],
  ],
  unique: [
    ['1', '1', '3'],
    ['1', '-1', '1'],
  ],
  infinite: [
    ['1', '2', '1', '4'],
    ['2', '4', '3', '9'],
  ],
}

function check(label: string, kind: SolutionKind) {
  const reduced = rref(parseMatrix(SYSTEMS[kind])!)
  return {
    label,
    rrefMatches: true,
    kindMatches: true,
    computedKind: kind,
    computedRref: matrixToLatex(reduced),
  }
}

function question(partial: Partial<HomeworkQuestion>): HomeworkQuestion {
  return {
    id: crypto.randomUUID(),
    projectId,
    setId: parentId,
    documentId,
    documentName: 'hw.pdf',
    order: 0,
    prompt: 'Q',
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
    ...partial,
  }
}

const SUMMARY =
  '| 类型 | 题目 |\n|---|---|\n| 无解 | 1(a) |\n| 唯一解 | 1(b) |\n| 无穷多解与自由变量 | 1(c) |\n\n- 主元个数决定解的情况'

function section(partial: Partial<WalkthroughSection>): WalkthroughSection {
  return {
    id: 'x',
    kind: 'question',
    title: '',
    body: 'body',
    status: 'ready',
    inputHash: 'h',
    generatedAt: 1,
    ...partial,
  }
}

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  projectId = (
    await new ProjectService(db).create({ name: 'Linear algebra', subject: 'linear_algebra' })
  ).id
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId,
    type: 'text',
    materialType: 'homework',
    name: 'hw.pdf',
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  documentId = doc.id
  repo = new HomeworkRepository(db)
  parentId = crypto.randomUUID()
  const parent: HomeworkSet = {
    id: parentId,
    projectId,
    documentId,
    documentName: 'hw.pdf',
    title: 'HW1',
    status: 'ready',
    language: 'zh',
    questionCount: 2,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  }
  await repo.upsertSet(parent)
  await repo.upsertQuestion(
    question({
      id: 'q1',
      order: 0,
      number: '1',
      prompt:
        '求解下列增广矩阵对应的方程组：(a) [1 1 | 2; 2 2 | 5] (b) [1 1 | 3; 1 -1 | 1] (c) [1 2 1 | 4; 2 4 3 | 9]',
    }),
  )
  await repo.upsertQuestion(
    question({ id: 'q2', order: 1, number: '2', prompt: '证明：若 A 可逆，则 Ax = 0 只有零解。' }),
  )
  await db.homeworkWalkthroughs.put({
    id: `${parentId}:zh_terms`,
    projectId,
    setId: parentId,
    language: 'zh_terms',
    sections: [
      section({
        id: 'q:q1',
        questionId: 'q1',
        checks: [check('(a)', 'none'), check('(b)', 'unique'), check('(c)', 'infinite')],
      }),
      section({ id: 'q:q2', questionId: 'q2' }),
      section({ id: 'summary', kind: 'summary', body: SUMMARY }),
    ],
    createdAt: 1,
    updatedAt: 1,
  })
})

/** A model that writes the proof question (with no local check) and passes every review. */
const writer: Handler = (kind, user) => {
  if (kind === 'review') return passAll(user)
  const slots = [...user.matchAll(/SLOT (s\d+)/g)].map((match) => match[1]!)
  return {
    questions: slots.map((slot) => ({
      slot,
      stem: '',
      parts: [
        {
          prompt: '证明：若 B 可逆，则 Bx = 0 只有零解。',
          answer: '只有零解',
          solution: '两边左乘 B 的逆。',
          check: null,
        },
      ],
    })),
  }
}

describe('linear-system constructor', () => {
  const cases: Array<{ rows: number; vars: number; solution: SolutionKind; free: number }> = [
    { rows: 3, vars: 3, solution: 'unique', free: 0 },
    { rows: 4, vars: 3, solution: 'unique', free: 0 },
    { rows: 3, vars: 3, solution: 'none', free: 0 },
    { rows: 2, vars: 4, solution: 'none', free: 0 },
    { rows: 3, vars: 4, solution: 'infinite', free: 1 },
    { rows: 3, vars: 4, solution: 'infinite', free: 2 },
    { rows: 2, vars: 3, solution: 'infinite', free: 1 },
  ]
  it.each(cases)('builds $rows×$vars systems with $solution solutions', (spec) => {
    for (let seed = 0; seed < 25; seed += 1) {
      const built = buildLinearSystem(spec, createRng(`t${seed}`))
      expect(built).not.toBeNull()
      const { augmented, reduced } = built!
      expect(augmented).toHaveLength(spec.rows)
      expect(augmented[0]).toHaveLength(spec.vars + 1)
      // Exact reference: the stored RREF is the RREF of the matrix shown.
      expect(sameReducedMatrix(rref(augmented), reduced)).toBe(true)
      expect(solutionKind(reduced)).toBe(spec.solution)
      if (spec.solution === 'infinite') expect(freeCount(reduced)).toBe(spec.free)
      // Friendly: small integers, an easy elimination.
      for (const row of augmented) {
        for (const entry of row) expect(entry.d).toBe(1n)
        for (const entry of row.slice(0, -1))
          expect(Math.abs(Number(entry.n))).toBeLessThanOrEqual(9)
      }
      expect(eliminationFractions(augmented)).toBeLessThanOrEqual(2)
    }
  })
})

describe('local grading of practice answers', () => {
  const graded = (kind: SolutionKind) => {
    const augmented = SYSTEMS[kind]
    const reduced = rref(parseMatrix(augmented)!)
    return {
      parts: [
        {
          answer: '',
          grader: {
            kind: 'linear_system' as const,
            augmented,
            rref: reduced.map((row) => row.map((entry) => `${entry.n}/${entry.d}`)),
            solution: kind,
            free: kind === 'infinite' ? freeCount(reduced) : 0,
          },
        },
      ],
    }
  }
  it('grades no / unique / infinitely many solutions', () => {
    expect(checkPracticeAnswer(graded('none'), '无解')?.verdict).toBe('correct')
    expect(checkPracticeAnswer(graded('none'), 'x1 = 1, x2 = 1')?.verdict).toBe('incorrect')
    expect(checkPracticeAnswer(graded('unique'), 'x1 = 2, x2 = 1')?.verdict).toBe('correct')
    expect(checkPracticeAnswer(graded('unique'), 'x1 = 1, x2 = 2')?.verdict).toBe('incorrect')
    // x1 + 2x2 + x3 = 4, x3 = 1  →  x1 = 3 − 2t, x2 = t, x3 = 1
    expect(checkPracticeAnswer(graded('infinite'), 'x1 = 3 - 2t, x2 = t, x3 = 1')?.verdict).toBe(
      'correct',
    )
    expect(checkPracticeAnswer(graded('infinite'), 'x1 = 3 - t, x2 = t, x3 = 1')?.verdict).toBe(
      'incorrect',
    )
    // Not decidable here → the AI check handles it.
    expect(checkPracticeAnswer(graded('unique'), 'see my work')).toBeNull()
  })
})

describe('building practice sets', () => {
  it('完整版 mirrors the assignment: same questions, sub-parts and solution types', async () => {
    const { ai, calls } = stubAI(writer)
    const service = new PracticeSetService({ ai, db })
    const result = await service.create(parentId, 'full')
    expect(result).toMatchObject({ paused: false, created: 2, dropped: 0 })
    // One request writes the AI question, one reviews every question (local ones too).
    expect(calls.map((call) => call.kind)).toEqual(['generate', 'review'])
    expect(reviewIds(calls[1]!.user)).toHaveLength(2)
    expect(calls[0]!.user).toContain('SLOT s2')
    expect(calls[0]!.user).not.toContain('SLOT s1')

    const questions = await repo.listQuestions(result.set.id)
    expect(questions).toHaveLength(2)
    const [first, second] = questions
    expect(first!.practice!.origin).toBe('local')
    expect(first!.practice!.parts.map((part) => part.label)).toEqual(['a', 'b', 'c'])
    expect(
      first!.practice!.parts.map((part) =>
        part.grader.kind === 'linear_system' ? part.grader.solution : null,
      ),
    ).toEqual(['none', 'unique', 'infinite'])
    // New numbers, answers computed locally from the matrix shown.
    for (const part of first!.practice!.parts) {
      if (part.grader.kind !== 'linear_system') throw new Error('expected a system')
      const reduced = rref(parseMatrix(part.grader.augmented)!)
      expect(sameReducedMatrix(reduced, parseMatrix(part.grader.rref)!)).toBe(true)
    }
    expect(second!.practice).toMatchObject({ origin: 'ai', sourceQuestionId: 'q2' })
    expect(second!.solution).toContain('只有零解')

    const set = await repo.getSet(result.set.id)
    expect(set).toMatchObject({
      kind: 'practice',
      parentSetId: parentId,
      status: 'ready',
      questionCount: 2,
    })
    expect(set!.practice!.draft).toBeUndefined()
  })

  it('精简版 asks one question per summary category plus an integrative one', async () => {
    expect(compactCount(summaryKnowledge(SUMMARY), 2)).toBe(4)
    const { ai, calls } = stubAI(writer)
    const result = await new PracticeSetService({ ai, db }).create(parentId, 'compact')
    expect(result.created).toBe(4)
    // All linear-system knowledge points: built locally, only reviewed by the AI.
    expect(calls.map((call) => call.kind)).toEqual(['review'])
    const questions = await repo.listQuestions(result.set.id)
    expect(questions.at(-1)!.practice!.parts).toHaveLength(3)
  })

  it('rebuilds / rewrites failed questions once, drops repeat failures, and never changes answers', async () => {
    let round = 0
    const { ai, calls } = stubAI((kind, user) => {
      if (kind === 'generate') return writer(kind, user)
      round += 1
      const ids = reviewIds(user)
      // Round 1: both fail. Round 2: the rebuilt local one passes, the rewrite fails.
      return {
        results: ids.map((id, index) => ({
          id,
          pass: round === 2 && index === 0,
          reason: 'too easy',
        })),
      }
    })
    const result = await new PracticeSetService({ ai, db }).create(parentId, 'full')
    expect(calls.map((call) => call.kind)).toEqual(['generate', 'review', 'generate', 'review'])
    expect(calls[2]!.user).toContain('Rejected before: too easy')
    expect(result).toMatchObject({ created: 1, dropped: 1 })
    const set = await repo.getSet(result.set.id)
    expect(set!.practice!.droppedReasons).toEqual([expect.stringContaining('too easy')])
    const [kept] = await repo.listQuestions(result.set.id)
    for (const part of kept!.practice!.parts) {
      if (part.grader.kind !== 'linear_system') throw new Error('expected a system')
      expect(
        sameReducedMatrix(
          rref(parseMatrix(part.grader.augmented)!),
          parseMatrix(part.grader.rref)!,
        ),
      ).toBe(true)
    }
  })

  it('drops an AI question whose answer fails the local check', async () => {
    const { ai } = stubAI((kind, user) => {
      if (kind === 'review') return passAll(user)
      return {
        questions: [
          {
            slot: 's2',
            stem: '',
            parts: [
              {
                prompt: '计算 2 + 2。',
                answer: '5',
                solution: '…',
                check: { type: 'numeric', expression: '2+2', unit: '' },
              },
            ],
          },
        ],
      }
    })
    const result = await new PracticeSetService({ ai, db }).create(parentId, 'full')
    expect(result).toMatchObject({ created: 1, dropped: 1 })
    const set = await repo.getSet(result.set.id)
    expect(set!.practice!.droppedReasons![0]).toContain('2')
  })

  it('pauses after the part in progress and continues with only what is left', async () => {
    const { ai, calls } = stubAI(writer)
    let allowed = true
    const control: GenerationControl = {
      signal: new AbortController().signal,
      shouldContinue: () => allowed,
    }
    const service = new PracticeSetService({ ai, db })
    const first = service.create(parentId, 'full', {
      control,
      onProgress: (progress) => {
        if (progress.stage === 'reviewing') allowed = false
      },
    })
    const paused = await first
    expect(paused.paused).toBe(true)
    expect(calls.map((call) => call.kind)).toEqual(['generate'])
    const stored = await repo.getSet(paused.set.id)
    expect(stored).toMatchObject({ status: 'paused' })
    expect(stored!.practice!.draft!.candidates).toHaveLength(2)

    const done = await service.resume(paused.set.id)
    expect(done).toMatchObject({ paused: false, created: 2 })
    // Only the review was left.
    expect(calls.map((call) => call.kind)).toEqual(['generate', 'review'])
  })

  it('is listed under its assignment, exported, deleted on its own or with the assignment', async () => {
    const { ai } = stubAI(writer)
    const service = new PracticeSetService({ ai, db })
    const { set } = await service.create(parentId, 'full')
    expect((await service.listPracticeSets(parentId)).map((item) => item.id)).toEqual([set.id])

    const { json } = await new DataManagementService(db).exportAll()
    const exported = JSON.stringify(json)
    expect(exported).toContain(set.id)
    expect(exported).toContain('"kind":"practice"')

    // The assignment's own set lookup ignores it; a re-read is refused.
    const homework = new HomeworkService({ ai: null, db })
    await homework.reconcileSets(projectId)
    expect(await repo.getSet(set.id)).toBeDefined()
    await expect(homework.retrySet(set.id)).rejects.toThrow()

    // Deleting the practice set leaves the assignment alone.
    const second = await service.create(parentId, 'compact')
    await service.deletePracticeSet(second.set.id, projectId)
    expect(await repo.getSet(second.set.id)).toBeUndefined()
    expect(await repo.listQuestions(second.set.id)).toEqual([])
    expect(await repo.getSet(parentId)).toBeDefined()

    // Deleting the assignment deletes its practice sets.
    await homework.deleteAssignment(parentId, projectId)
    expect(await repo.getSet(set.id)).toBeUndefined()
    expect(await repo.listQuestions(set.id)).toEqual([])
  })

  it('checks practice answers locally and records them in mastery and the mistake book', async () => {
    const { ai } = stubAI(writer)
    const { set } = await new PracticeSetService({ ai, db }).create(parentId, 'compact')
    const [first] = await repo.listQuestions(set.id)
    const homework = new HomeworkService({ ai: null, db })
    const check = await homework.checkAnswer(first!.id, '有唯一解 x1 = 999, x2 = 0, x3 = 0', 'zh')
    expect(check).toMatchObject({ method: 'local', verdict: 'incorrect' })
    expect(await db.mistakes.where('projectId').equals(projectId).count()).toBe(1)
    expect(await db.knowledgeMastery.where('projectId').equals(projectId).count()).toBe(1)
  })
})
