import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { MistakeRepository } from '@/entities/mistake/repository'
import { AnswerImageRepository } from '@/entities/homework/answerImageRepository'
import { AiMockPaperService } from '@/services/aiMockPaperService'
import { createEconMockFigureEngine, readMarketFigureSpec } from '@/services/econMockFigureEngine'
import { QuizService } from '@/services/quizService'
import { MistakeService } from '@/services/mistakeService'
import { MistakeFollowUpService } from '@/services/mistakeFollowUpService'
import { EconGraphImportService } from '@/services/econGraphImportService'
import { checkPracticeAnswer } from '@/entities/homework/practice/verify'
import {
  marketValue,
  solveQuestion,
  expectedAnswerCode,
  gradeMarketQuestion,
} from '@/entities/econ/graphQuestion'
import { readGraphReply, compareWithKey } from '@/entities/econ/graphRead'
import type { MarketSpec } from '@/entities/econ/market'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { AIService } from '@/services/aiService'
import type { QuizConfig } from '@/entities/quiz/types'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { setUILanguage } from '@/i18n'

const MC = (stem: string) => `${stem}\nA. rises\nB. falls\nC. unchanged\nD. ambiguous`
const PAST = [
  MC('Use the graph below to answer questions 1–3.\nWhat is the equilibrium price? (3 marks)'),
  MC('After the tax, what happens to the quantity sold? (3 marks)'),
  MC('Which area is the deadweight loss? (3 marks)'),
  MC('A price ceiling below equilibrium causes what? (3 marks)'),
  'Draw a supply-and-demand diagram for a rightward shift of supply and explain. (10 marks)',
]

let db: AppDatabase
let projectId: string
let pastSetId: string

async function seedCourse(): Promise<void> {
  projectId = (await new ProjectService(db).create({ name: 'ECON 110', subject: 'economics' })).id
  await db.table('courseAnalyses').put({
    id: `a-${projectId}`,
    projectId,
    status: 'ready',
    documentIds: [],
    language: 'en',
  })
  await db.table('topics').bulkPut(
    [['t-tax', 'Taxes and deadweight loss']].map(([id, name], order) => ({
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
  pastSetId = crypto.randomUUID()
  const set: HomeworkSet = {
    id: pastSetId,
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
      setId: pastSetId,
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
}

beforeEach(async () => {
  setUILanguage('en')
  db = new AppDatabase()
  setDbForTesting(db)
  await seedCourse()
})

afterEach(() => {
  db.close()
})

// --- AI mock paper: shared local figures ----------------------------------------

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
const mcReply = {
  stem: '',
  parts: [
    {
      prompt: 'A binding price ceiling causes what?',
      marks: 3,
      answer: 'A',
      solution: 'A shortage.',
      scheme: ['B3 correct option'],
      check: null,
    },
  ],
  options: ['a shortage', 'a surplus', 'no change', 'higher prices'],
  correct: 'A',
}

function mockAI() {
  const writes: string[] = []
  const systems: string[] = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const system = messages[0]!.content
    const user = messages[1]!.content
    if (system.includes('You review the questions of an AI mock exam paper')) {
      const ids = [...user.matchAll(/\[(s\d+)\] type:/g)].map((m) => m[1]!)
      return { data: { results: ids.map((id) => ({ id, pass: true, reason: 'ok' })) }, raw: {} }
    }
    writes.push(user)
    systems.push(system)
    return { data: user.includes('multiple_choice') ? mcReply : drawReply, raw: {} }
  })
  return {
    writes,
    systems,
    ai: {
      streamJSON,
      chatJSON: streamJSON,
      testConnection: async () => ({ ok: true, latencyMs: 1, model: 'stub' }),
      maxOutputTokens: 8192,
      concurrency: 1,
    } as unknown as AIService,
  }
}

describe('economics AI mock paper: figure groups drawn by the market engine', () => {
  it('the group shares one local figure; its questions are written locally with engine answers', async () => {
    const { ai, writes, systems } = mockAI()
    const service = new AiMockPaperService({
      ai,
      db,
      figureEngine: createEconMockFigureEngine({ seed: 'test' }),
    })
    const defaults = await service.defaults(projectId)
    const set = await service.plan(projectId, defaults.config!)
    const figure = readMarketFigureSpec(set.exam!.aiMock!.figures?.g1)
    expect(figure).not.toBeNull()
    expect(Object.keys(figure!.questions).sort()).toEqual(['s1', 's2', 's3'])
    const result = await service.resume(set.id)
    expect(result.paused).toBe(false)
    // Only the two questions outside the group were asked of the AI.
    expect(writes).toHaveLength(2)
    expect(writes.some((user) => user.includes('SHARED FIGURE'))).toBe(false)
    // Economics: the market check is described to the writer.
    expect(systems.every((system) => system.includes('{"type":"market"'))).toBe(true)

    const questions = (await new HomeworkRepository(db).listQuestions(set.id)).sort(
      (a, b) => a.order - b.order,
    )
    const grouped = questions.filter((item) => item.marketFigure)
    expect(grouped).toHaveLength(3)
    expect(new Set(grouped.map((item) => item.marketFigure!.groupId))).toEqual(new Set(['g1']))
    const saved = (await new HomeworkRepository(db).getSet(set.id))!
    const solution = solveQuestion({ figure: grouped[0]!.marketFigure!.figure })!
    for (const question of grouped) {
      const part = question.practice!.parts[0]!
      expect(part.grader.kind).toBe('choice')
      if (part.grader.kind !== 'choice') continue
      // The right option is the engine's value for that target.
      const letter = part.grader.correct
      expect(checkPracticeAnswer(question.practice!, letter)!.verdict).toBe('correct')
      const wrong = letter === 'A' ? 'B' : 'A'
      expect(checkPracticeAnswer(question.practice!, wrong)!.verdict).toBe('incorrect')
      // The option marked right (after the paper's own shuffle) is the one
      // the engine computed for this slot.
      const optionText = question.prompt
        .split('\n')
        .find((line) => line.startsWith(`${letter}. `))!
        .slice(3)
      const raw = figure!.questions[slotOf(saved, question.id)]!
      expect(optionText).toBe(raw.options['ABCDEF'.indexOf(raw.correct)])
    }
    expect(solution.original.q.value).toBeGreaterThan(0)
  })

  it('other subjects: the engine draws nothing', async () => {
    const engine = createEconMockFigureEngine()
    expect(
      await engine({
        groupId: 'g1',
        topic: { id: 't', name: 'Taxes' },
        slots: [{ id: 's1', label: '1', kind: 'multiple_choice', parts: [] }],
        language: 'en',
        subject: 'physics',
      }),
    ).toBeNull()
  })
})

function slotOf(set: HomeworkSet, questionId: string): string {
  return set.exam?.aiMock?.slots.find((slot) => slot.questionId === questionId)?.id ?? ''
}

// --- Quiz: local graph questions --------------------------------------------------

async function seedTopic(): Promise<string> {
  const analyses = new CourseAnalysisRepository(db)
  const doc = await new DocumentRepository(db).create({
    projectId,
    type: 'pdf',
    name: 'notes.pdf',
    sizeBytes: 1,
  })
  await analyses.reseedProject(
    projectId,
    {
      topics: [{ name: 'Taxes and deadweight loss', description: 'Tax incidence', sourceRefs: [] }],
      concepts: [],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map([['Taxes and deadweight loss', 't-taxes']]),
      documentIds: [doc.id],
    },
    'en',
  )
  return (await analyses.listTopics(projectId))[0]!.id
}

describe('quiz: graph questions built locally', () => {
  it('a tax topic gets engine-built graph questions without any AI request', async () => {
    const topicId = await seedTopic()
    const chatJSON = vi.fn(async () => ({ data: { questions: [] } }))
    const ai = { chatJSON, maxOutputTokens: 4096 } as unknown as AIService
    const mistakes = new MistakeService(db)
    const service = new QuizService({ ai, db, mistakes })
    const config = {
      mode: 'topic',
      topicId,
      count: 3,
      difficulty: 'basic',
      types: ['shift_id', 'area_read', 'draw_diagram'],
    } as QuizConfig
    const quiz = await service.generateQuiz(projectId, config)
    expect(chatJSON).not.toHaveBeenCalled()
    const questions = await service.getQuestions(quiz.id)
    expect(questions.map((item) => item.type)).toEqual(['shift_id', 'area_read', 'draw_diagram'])
    for (const question of questions) {
      expect(question.market).toBeDefined()
      expect(question.market!.figure.spec.scenario.kind).toBe('tax')
    }
    // A wrong reading of the value: graded, recorded as a mistake with its dimension.
    await service.startQuiz(quiz.id)
    const area = questions[1]!
    const solution = solveQuestion(area.market!)!
    const right = marketValue(solution, area.market!.target!)!
    const outcome = await service.submitAnswer(quiz.id, area.id, String(right.value * 2 + 1))
    expect(outcome.evaluation.isCorrect).toBe(false)
    const recorded = await new MistakeRepository(db).findByQuestion(projectId, area.id)
    expect(recorded?.errorDimension).toBe('value')
    // The drawing: the engine's expected drawing is right item by item.
    const draw = questions[2]!
    const graded = await service.submitAnswer(quiz.id, draw.id, expectedAnswerCode(draw.market!)!)
    expect(graded.evaluation).toMatchObject({ isCorrect: true, method: 'market' })
    expect(graded.evaluation.score).toEqual({
      earned: draw.market!.draw!.items.length,
      total: draw.market!.draw!.items.length,
    })
  })

  it('an AI-written graph question with a wrong number is corrected; one that does not solve is dropped', () => {
    const service = new QuizService({ ai: {} as AIService, db })
    const market: MarketSpec = {
      demand: { form: 'price', intercept: 100, slope: -2 },
      supply: { form: 'price', intercept: 20, slope: 2 },
      scenario: { kind: 'tax', amount: 8, on: 'sellers' },
    }
    const valid = service.validateGenerated(
      {
        questions: [
          {
            prompt:
              'Demand: P = 100 − 2Q; supply: P = 20 + 2Q. A tax of $8 on sellers. What is the DWL?',
            type: 'area_read',
            correctAnswer: '16',
            solution: 'wrong working',
            knowledgePoint: 'Taxes',
            difficulty: 'basic',
            hints: [],
            market,
            target: 'dwl',
          },
          {
            prompt: 'Which curve shifts?',
            type: 'shift_id',
            correctAnswer: 'demand',
            solution: '',
            knowledgePoint: 'x',
            difficulty: 'basic',
            hints: [],
            market: { ...market, demand: { form: 'price', intercept: 10, slope: 3 } },
          },
        ],
      },
      2,
    )
    expect(valid).toHaveLength(1)
    expect(valid[0]!.correctAnswer).toBe('$8')
    expect(valid[0]!.solution).not.toContain('wrong working')
    expect(valid[0]!.market?.target).toBe('dwl')
  })
})

// --- 错题跟进: a local variant of a graph question --------------------------------

describe('mistake follow-up: graph variants are built locally', () => {
  it('a new market with the same structure, graded by the engine (no AI)', async () => {
    const topicId = await seedTopic()
    const service = new QuizService({
      ai: { chatJSON: vi.fn(), maxOutputTokens: 4096 } as unknown as AIService,
      db,
      mistakes: new MistakeService(db),
    })
    const quiz = await service.generateQuiz(projectId, {
      mode: 'topic',
      topicId,
      count: 1,
      difficulty: 'basic',
      types: ['area_read'],
    } as QuizConfig)
    const [question] = await service.getQuestions(quiz.id)
    await service.startQuiz(quiz.id)
    await service.submitAnswer(quiz.id, question!.id, '999999')
    const mistake = (await new MistakeRepository(db).findByQuestion(projectId, question!.id))!
    const followUp = new MistakeFollowUpService({ ai: null, db })
    const variant = await followUp.createVariant(mistake.id, 'variant')
    expect(variant.origin).toBe('local')
    const grader = variant.parts[0]!.grader
    expect(grader.kind).toBe('market')
    if (grader.kind !== 'market') return
    expect(grader.question.target).toBe(question!.market!.target)
    expect(grader.question.figure.spec).not.toEqual(question!.market!.figure.spec)
    const check = await followUp.checkVariant(mistake.id, expectedAnswerCode(grader.question)!)
    expect(check.verdict).toBe('correct')
  })
})

// --- From a course graph (photo) ----------------------------------------------------

const READING = {
  readable: true,
  axes: { priceUnit: '$', quantityScale: 'units' },
  demand: {
    points: [
      [0, 100],
      [50, 0],
    ],
  },
  supply: {
    points: [
      [0, 20],
      [40, 100],
    ],
  },
  scenario: { kind: 'tax', amount: 8, on: 'sellers' },
  asks: [
    { label: 'a', kind: 'area_read', target: 'dwl' },
    { label: 'b', kind: 'draw_diagram', region: 'dwl' },
  ],
  notes: '',
}

async function graphQuestion(answerText?: string): Promise<HomeworkQuestion> {
  const repo = new HomeworkRepository(db)
  const question = (await repo.getQuestion('q3'))!
  const updated: HomeworkQuestion = {
    ...question,
    prompt: 'Refer to the graph. (a) What is the deadweight loss of the tax? (b) Shade it.',
    ...(answerText ? { answerText, answerStatus: 'matched' as const } : {}),
  }
  await db.homeworkQuestions.put(updated)
  return updated
}

function visionAI(reply: unknown) {
  const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
    expect(messages[1]!.images).toHaveLength(1)
    return { data: reply, raw: {} }
  })
  return { chatJSON, ai: { chatJSON, maxOutputTokens: 8192 } as unknown as AIService }
}

describe('rebuilding a course graph from a photo', () => {
  it('reads, solves and rebuilds the graph; the answer key agrees; variants are created', async () => {
    const question = await graphQuestion(
      '(a) DWL = ½ × 8 × 2 = $8 (2 marks)\n(b) Triangle between the curves (1 mark)',
    )
    await new AnswerImageRepository(db).add({
      id: 'img1',
      projectId,
      setId: pastSetId,
      questionId: question.id,
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]).buffer,
      source: 'upload',
      createdAt: 1,
    })
    const { ai, chatJSON } = visionAI(READING)
    const service = new EconGraphImportService({ ai, db })
    expect(await service.available(projectId)).toBe(true)
    const images = await service.candidates(question)
    expect(images[0]!.source).toMatchObject({ kind: 'answer', index: 1 })
    const reading = await service.read(question, images[0]!, { language: 'en' })
    expect(chatJSON).toHaveBeenCalledTimes(1)
    expect((chatJSON.mock.calls[0]![0] as ChatMessage[])[1]!.content).toContain('UNTRUSTED CONTENT')
    expect(reading.asks.map((ask) => ask.question.kind)).toEqual(['area_read', 'draw_diagram'])
    // Two points per line: P = 100 − 2Q, P = 20 + 2Q; the tax solves to DWL 8.
    const value = marketValue(solveQuestion(reading.asks[0]!.question)!, 'dwl')!
    expect(value.value).toBe(8)

    const comparison = service.compare(question, reading)!
    expect(comparison.status).toBe('agree')

    const set = await service.createVariants(question, reading, { count: 3, seed: 'v', comparison })
    expect(set).toMatchObject({ kind: 'practice', parentSetId: pastSetId, questionCount: 3 })
    const created = await new HomeworkRepository(db).listQuestions(set.id)
    expect(created).toHaveLength(3)
    for (const item of created) {
      expect(item.practice?.sourceQuestionId).toBe(question.id)
      expect(item.practice?.parts.map((part) => part.grader.kind)).toEqual(['market', 'market'])
      // The drawing part keeps the professor's marking lines as its rubric.
      const draw = item.practice!.parts[1]!.grader
      if (draw.kind === 'market') expect(draw.question.rubric?.source).toBe('professor')
      const parts = item.practice!.parts.map((part) =>
        part.grader.kind === 'market' ? expectedAnswerCode(part.grader.question)! : '',
      )
      const draft = `(a) ${parts[0]}\n(b) ${parts[1]}`
      expect(checkPracticeAnswer(item.practice!, draft)!.verdict).toBe('correct')
    }
  })

  it('a key that disagrees flags the graph and blocks variants', async () => {
    const question = await graphQuestion('(a) DWL = $12\n(b) shaded')
    const service = new EconGraphImportService({ ai: visionAI(READING).ai, db })
    const reading = await service.read(question, {
      bytes: new ArrayBuffer(4),
      mimeType: 'image/png',
    })
    const comparison = service.compare(question, reading)!
    expect(comparison.status).toBe('disagree')
    expect(comparison.details[0]).toContain('≠')
    await expect(service.createVariants(question, reading, { comparison })).rejects.toThrow()
  })

  it('no professor answer: nothing to compare; an unreadable reply is an error', async () => {
    const question = await graphQuestion()
    const service = new EconGraphImportService({
      ai: visionAI({ readable: false, reason: 'blurry' }).ai,
      db,
    })
    await expect(
      service.read(question, { bytes: new ArrayBuffer(4), mimeType: 'image/png' }),
    ).rejects.toThrow(/blurry/)
    const reading = readGraphReply(READING)
    if (!reading.ok) throw new Error(reading.reason)
    expect(service.compare(question, reading.reading)).toBeNull()
  })

  it('a reading whose curves do not meet is rejected; shifted curves become a shift', () => {
    expect(
      readGraphReply({
        ...READING,
        demand: {
          points: [
            [0, 10],
            [50, 0],
          ],
        },
        supply: {
          points: [
            [0, 20],
            [40, 100],
          ],
        },
      }),
    ).toMatchObject({ ok: false })
    const shifted = readGraphReply({
      ...READING,
      scenario: null,
      newSupply: {
        points: [
          [0, 40],
          [40, 120],
        ],
      },
      asks: [{ label: '', kind: 'shift_id' }],
    })
    if (!shifted.ok) throw new Error(shifted.reason)
    expect(shifted.reading.figure.spec.scenario.kind).toBe('shift')
    const answer = gradeMarketQuestion(
      shifted.reading.asks[0]!.question,
      'shift: demand=none; supply=decrease; price=increase; quantity=decrease',
    )!
    expect(answer.earned).toBe(4)
    expect(
      compareWithKey(shifted.reading, 'Supply shifts left, so price rises and quantity falls.')
        .status,
    ).toBe('agree')
    expect(compareWithKey(shifted.reading, 'Supply shifts right.').status).toBe('disagree')
  })
})
