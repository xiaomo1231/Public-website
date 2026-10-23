import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { AiMockPaperService } from '@/services/aiMockPaperService'
import { detectFigureGroups } from '@/entities/exam/figureGroups'
import {
  allocateTopics,
  mirrorStructure,
  resizeStructure,
  type MockFigureEngine,
} from '@/entities/exam/mockPaper'
import { professorConventions, type QuestionHabitsProfile } from '@/entities/questionHabits/types'
import * as MockV1 from '@/infrastructure/ai/prompts/mock-paper/v1'
import * as MockV2 from '@/infrastructure/ai/prompts/mock-paper/v2'
import { prompts } from '@/infrastructure/ai/prompts'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { AIService } from '@/services/aiService'

const MC = (stem: string) => `${stem}\nA. rises\nB. falls\nC. unchanged\nD. ambiguous`

const PAST = [
  MC('Use the graph below to answer questions 1–3.\nWhat is the equilibrium price? (3 marks)'),
  MC('After the tax, what happens to the quantity sold? (3 marks)'),
  MC('Which area is the deadweight loss? (3 marks)'),
  MC('A price ceiling below equilibrium causes what? (3 marks)'),
  'Draw a supply-and-demand diagram for a rightward shift of supply and explain. (10 marks)',
]

describe('detectFigureGroups', () => {
  const q = (label: string, prompt: string, multipleChoice = true) => ({
    label,
    prompt,
    multipleChoice,
  })

  it('groups the questions a lead-in names with a figure word', () => {
    const groups = detectFigureGroups([
      q('1', 'Use the graph below to answer questions 1-3. What is P*?'),
      q('2', 'What is Q*?'),
      q('3', 'What is consumer surplus?'),
      q('4', 'Define elasticity.'),
    ])
    expect(groups).toEqual([[0, 1, 2]])
    expect(
      detectFigureGroups([
        q('3', '根据下图回答第 3–4 题。均衡价格是多少？'),
        q('4', '均衡数量是多少？'),
      ]),
    ).toEqual([[0, 1]])
  })

  it('groups consecutive questions naming the same figure', () => {
    expect(
      detectFigureGroups([
        q('1', 'Refer to Figure 2. Which curve shifted?'),
        q('2', 'In Figure 2, what is the new price?'),
        q('3', 'In Figure 3, what is the tax revenue?'),
        q('4', 'What is a normal good?'),
      ]),
    ).toEqual([[0, 1]])
  })

  it('ignores ranges without a figure, single questions and "graph a firm faces"', () => {
    expect(
      detectFigureGroups([
        q('1', 'Questions 1-2 are about elasticity. Compute ε.'),
        q('2', 'Is demand elastic?'),
      ]),
    ).toEqual([])
    expect(detectFigureGroups([q('1', 'Refer to Figure 1. What is P*?')])).toEqual([])
    expect(
      detectFigureGroups([
        q('1', 'Draw the graph a firm faces.'),
        q('2', 'Explain the graph a monopolist faces.'),
      ]),
    ).toEqual([])
  })

  it('with the professor’s habit, groups consecutive multiple choice about "the graph"', () => {
    const questions = [
      q('1', 'In the graph, what is P*?'),
      q('2', 'In the graph, what is the DWL?'),
      q('3', 'Explain the graph.', false),
    ]
    expect(detectFigureGroups(questions)).toEqual([])
    expect(detectFigureGroups(questions, { loose: true })).toEqual([[0, 1]])
  })
})

describe('figure groups in the mock paper structure', () => {
  const structure = () =>
    mirrorStructure({
      setId: 'p',
      title: 'Midterm',
      hasFormulaSheet: false,
      questions: PAST.map((prompt, i) => ({ id: `q${i + 1}`, number: String(i + 1), prompt })),
    })

  it('marks the grouped slots', () => {
    const slots = structure().slots
    expect(slots.map((slot) => slot.figureGroup)).toEqual([
      { id: 'g1', position: 0, size: 3 },
      { id: 'g1', position: 1, size: 3 },
      { id: 'g1', position: 2, size: 3 },
      undefined,
      undefined,
    ])
  })

  it('keeps groups when the paper is repeated and drops lone members when shrunk', () => {
    const more = resizeStructure(structure(), 10).slots
    expect(more.filter((slot) => slot.figureGroup).map((slot) => slot.figureGroup!.id)).toEqual([
      'g1',
      'g1',
      'g1',
      'g2',
      'g2',
      'g2',
    ])
    // 5 → 3 picks questions 1, 2 and 4: the two picked members stay a group of two.
    const fewer = resizeStructure(structure(), 3).slots
    expect(fewer.map((slot) => slot.figureGroup)).toEqual([
      { id: 'g1', position: 0, size: 2 },
      { id: 'g1', position: 1, size: 2 },
      undefined,
    ])
    // 5 → 1 keeps one member alone: no group.
    expect(resizeStructure(structure(), 1).slots[0]!.figureGroup).toBeUndefined()
  })

  it('gives a group one topic', () => {
    const slots = structure().slots
    const topics = [
      { id: 'a', name: 'Supply and demand', mastery: 0.2 },
      { id: 'b', name: 'Elasticity', mastery: 0.2 },
      { id: 'c', name: 'Taxes', mastery: 0.2 },
    ]
    const allocation = allocateTopics(slots, topics)
    const grouped = slots.filter((slot) => slot.figureGroup).map((s) => allocation.get(s.id)!.id)
    expect(new Set(grouped).size).toBe(1)
    expect(allocation.size).toBe(slots.length)
  })
})

describe('the figure-group habit', () => {
  const profile = (
    statement: string,
    quote = 'Questions 3–5 refer to the graph',
  ): QuestionHabitsProfile => ({
    items: [
      {
        id: 'h1',
        category: 'structure',
        statement,
        evidence: [{ documentId: 'd', quote }],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    sources: [],
    updatedAt: 1,
  })

  it('is read from the profile, apart from the prompt conventions', () => {
    const read = professorConventions(
      profile('Multiple-choice questions come in groups of three that share one graph.'),
    )
    expect(read).toEqual({ conventions: [], figureGroups: true })
    expect(
      professorConventions(profile('Questions have three parts.', 'Answer all parts')),
    ).toEqual({
      conventions: [],
    })
    expect(professorConventions(profile('同一张图出三道选择题。', '根据下图回答第3-5题'))).toEqual({
      conventions: [],
      figureGroups: true,
    })
  })
})

describe('mock-paper v2', () => {
  const input: MockV1.MockPaperInput = {
    language: 'en',
    difficulty: 'exam',
    topic: { name: 'Taxes' },
    slot: { type: 'multiple_choice', parts: [], marks: 3, options: 4 },
  }

  it('is registered and byte-identical to v1 without a drawn figure', () => {
    expect(prompts.mockPaper.VERSION).toBe('v3')
    expect(MockV2.buildSystemPrompt()).toBe(MockV1.buildSystemPrompt())
    expect(MockV2.buildUserPrompt(input)).toBe(MockV1.buildUserPrompt(input))
    expect(
      MockV2.buildUserPrompt({
        ...input,
        figureGroup: { position: 0, size: 3, labels: ['1', '2', '3'] },
      }),
    ).toBe(MockV1.buildUserPrompt(input))
  })

  it('writes the question about the shared figure when one was drawn', () => {
    const user = MockV2.buildUserPrompt({
      ...input,
      figureGroup: {
        position: 1,
        size: 3,
        labels: ['1', '2', '3'],
        figure: 'Demand P = 100 − Q, supply P = 20 + Q; equilibrium (40, 60).',
        siblings: ['What is the equilibrium price?'],
      },
    })
    expect(user.startsWith(MockV1.buildUserPrompt(input))).toBe(true)
    expect(user).toContain('SHARED FIGURE')
    expect(user).toContain('question 2 of 3 (questions 1, 2, 3)')
    expect(user).toContain('equilibrium (40, 60)')
    expect(user).toContain('OTHER QUESTIONS OF THE GROUP')
  })
})

// --- Service: optional figure engine ------------------------------------------------

let db: AppDatabase
let projectId: string

const mcReply = {
  stem: '',
  parts: [
    {
      prompt: 'What happens to the price?',
      marks: 3,
      answer: 'A',
      solution: 'Supply falls.',
      scheme: ['B3 correct option'],
      check: null,
    },
  ],
  options: ['rises', 'falls', 'unchanged', 'cannot tell'],
  correct: 'A',
}
const drawReply = {
  stem: '',
  parts: [
    {
      prompt: 'Draw and explain a rightward shift of supply.',
      marks: 10,
      answer: 'P falls, Q rises.',
      solution: 'S1 → S2.',
      scheme: ['B4 shift', 'B4 new equilibrium', 'B2 explanation'],
      check: null,
    },
  ],
  options: [],
  correct: '',
}

function stubAI() {
  const users: string[] = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const system = messages[0]!.content
    const user = messages[1]!.content
    if (system.includes('You review the questions of an AI mock exam paper')) {
      const ids = [...user.matchAll(/\[(s\d+)\] type:/g)].map((m) => m[1]!)
      return { data: { results: ids.map((id) => ({ id, pass: true, reason: 'ok' })) }, raw: {} }
    }
    users.push(user)
    return { data: user.includes('multiple_choice') ? mcReply : drawReply, raw: {} }
  })
  return {
    users,
    ai: {
      streamJSON,
      chatJSON: streamJSON,
      testConnection: async () => ({ ok: true, latencyMs: 1, model: 'stub' }),
      maxOutputTokens: 8192,
      concurrency: 1,
    } as unknown as AIService,
  }
}

async function seed(): Promise<string> {
  projectId = (await new ProjectService(db).create({ name: 'ECON 110', subject: 'economics' })).id
  await db.table('courseAnalyses').put({
    id: `a-${projectId}`,
    projectId,
    status: 'ready',
    documentIds: [],
    language: 'en',
  })
  await db.table('topics').bulkPut(
    [
      ['t-sd', 'Supply and demand'],
      ['t-tax', 'Taxes and deadweight loss'],
    ].map(([id, name], order) => ({
      id,
      projectId,
      name,
      description: name,
      order,
      sourceRefs: [],
    })),
  )
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId,
    type: 'text',
    materialType: 'past_exam',
    name: 'Midterm.pdf',
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  const now = Date.now()
  const setId = crypto.randomUUID()
  const set: HomeworkSet = {
    id: setId,
    projectId,
    documentId: doc.id,
    documentName: 'Midterm.pdf',
    title: 'Midterm',
    status: 'ready',
    language: 'en',
    questionCount: PAST.length,
    promptVersion: 'v2',
    kind: 'exam',
    exam: { detectedMinutes: 90 },
    createdAt: now,
    updatedAt: now,
  }
  const repo = new HomeworkRepository(db)
  await repo.upsertSet(set)
  await repo.addQuestions(
    PAST.map((prompt, order): HomeworkQuestion => ({
      id: `q${order + 1}`,
      projectId,
      setId,
      documentId: doc.id,
      documentName: 'Midterm.pdf',
      order,
      number: String(order + 1),
      prompt,
      sourceRefs: [],
      hints: [],
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: now,
      updatedAt: now,
    })),
  )
  return setId
}

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  await seed()
})

afterEach(() => {
  db.close()
})

describe('AI mock paper with figure groups', () => {
  it('without a figure engine writes the grouped questions normally', async () => {
    const { ai, users } = stubAI()
    const service = new AiMockPaperService({ ai, db })
    const defaults = await service.defaults(projectId)
    const set = await service.plan(projectId, defaults.config!)
    const info = set.exam!.aiMock!
    expect(info.figures).toBeUndefined()
    expect(info.slots.filter((slot) => slot.figureGroup)).toHaveLength(3)
    const result = await service.resume(set.id)
    expect(result.paused).toBe(false)
    expect(users.some((user) => user.includes('SHARED FIGURE'))).toBe(false)
  })

  it('with a figure engine writes each grouped question about the shared figure', async () => {
    const { ai, users } = stubAI()
    const engine: MockFigureEngine = vi.fn(async (request) => ({
      kind: 'market_2d',
      spec: { group: request.groupId },
      description: `Market for ${request.topic.name}: D P = 100 − Q, S P = 20 + Q.`,
    }))
    const service = new AiMockPaperService({ ai, db, figureEngine: engine })
    const defaults = await service.defaults(projectId)
    const set = await service.plan(projectId, defaults.config!)
    expect(engine).toHaveBeenCalledTimes(1)
    expect(Object.keys(set.exam!.aiMock!.figures ?? {})).toEqual(['g1'])
    await service.resume(set.id)
    expect(users.filter((user) => user.includes('SHARED FIGURE'))).toHaveLength(3)
    expect(users.filter((user) => !user.includes('SHARED FIGURE'))).toHaveLength(2)
  })

  it('a figure engine that fails leaves the group to be written normally', async () => {
    const { ai, users } = stubAI()
    const service = new AiMockPaperService({
      ai,
      db,
      figureEngine: async () => {
        throw new Error('cannot draw')
      },
    })
    const defaults = await service.defaults(projectId)
    const set = await service.plan(projectId, defaults.config!)
    expect(set.exam!.aiMock!.figures).toBeUndefined()
    await service.resume(set.id)
    expect(users.some((user) => user.includes('SHARED FIGURE'))).toBe(false)
  })

  it('uses the professor’s habit to group questions that only say "the graph"', async () => {
    const questions = [
      MC('In the graph, what is the equilibrium price?'),
      MC('In the graph, what is the deadweight loss?'),
    ]
    const plain = mirrorStructure({
      setId: 's',
      title: 't',
      hasFormulaSheet: false,
      questions: questions.map((prompt, i) => ({ id: `x${i}`, prompt })),
    })
    expect(plain.slots.some((slot) => slot.figureGroup)).toBe(false)
    await new CourseContextRepository(db).updateQuestionHabits(projectId, () => ({
      items: [
        {
          id: 'h1',
          category: 'structure',
          statement: 'Multiple-choice questions come in sets of three questions on one graph.',
          evidence: [{ documentId: 'd', quote: 'Use the graph to answer questions 3-5' }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      sources: [],
      updatedAt: 1,
    }))
    const loose = mirrorStructure({
      setId: 's',
      title: 't',
      hasFormulaSheet: false,
      figureGroups: true,
      questions: questions.map((prompt, i) => ({ id: `x${i}`, prompt })),
    })
    expect(loose.slots.every((slot) => slot.figureGroup?.id === 'g1')).toBe(true)
  })
})
