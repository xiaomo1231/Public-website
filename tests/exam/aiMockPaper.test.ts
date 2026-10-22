import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { AIProviderError } from '@/infrastructure/ai/errors'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { HomeworkService } from '@/services/homeworkService'
import { MockExamService } from '@/services/mockExamService'
import { AiMockPaperService } from '@/services/aiMockPaperService'
import { StudyPlanService } from '@/services/studyPlanService'
import { QuestionHabitsService } from '@/services/questionHabitsService'
import { taskLink } from '@/widgets/studyPlan/taskLinks'
import {
  allocateTopics,
  defaultDifficulty,
  estimateMockPaper,
  mirrorStructure,
  resizeStructure,
  structureReport,
} from '@/entities/exam/mockPaper'
import { verifyMockQuestion } from '@/entities/exam/mockPaperVerify'
import { prompts } from '@/infrastructure/ai/prompts'
import { checkPracticeAnswer } from '@/entities/homework/practice/verify'
import { isAiMockSet, type HomeworkQuestion, type HomeworkSet } from '@/entities/homework/types'
import type { AIService } from '@/services/aiService'
import type { GenerationControl } from '@/shared/lib/generationControl'

const DAY = 86_400_000

const PAST = [
  'Which unit is the SI unit of force? (2 marks)\nA. joule\nB. newton\nC. watt\nD. pascal',
  'A car accelerates from rest with constant acceleration.\n\n(a) Calculate its speed after 4 s at 2 m/s^2. (3 marks)\n\n(b) Calculate the distance it travels. (4 marks)',
  'Explain why the kinetic energy of a ball thrown upward decreases. (5 marks)',
  'SECRET HELD OUT QUESTION: calculate the force on a 7 kg mass. (4 marks)',
]

type Kind = 'write' | 'review'
interface Call {
  kind: Kind
  system: string
  user: string
}

function mcReply(none = false) {
  return {
    stem: '',
    parts: [
      {
        prompt: 'Which quantity is measured in newtons?',
        marks: 2,
        answer: 'A',
        solution: 'Force is measured in newtons.',
        scheme: ['B2 correct option'],
        check: null,
      },
    ],
    options: none
      ? ['force', 'energy', 'power', 'None of the options are correct']
      : ['force', 'energy', 'power', 'pressure'],
    correct: 'A',
  }
}

const CALC_REPLY = {
  stem: 'A cyclist accelerates from rest at 3 m/s^2.',
  parts: [
    {
      label: 'a',
      prompt: 'Calculate the speed after 5 s.',
      marks: 3,
      answer: '15 m/s',
      solution: '$v = at$',
      scheme: ['M1 v = at', 'A1 substitution', 'A1 15 m/s'],
      check: { type: 'numeric', expression: '3*5', unit: 'm/s' },
    },
    {
      label: 'b',
      prompt: 'Calculate the distance travelled in that time.',
      marks: 4,
      answer: '37.5 m',
      solution: '$s = \\tfrac12 a t^2$',
      scheme: ['M1 s = at^2/2', 'M1 substitution', 'A2 37.5 m'],
      check: { type: 'numeric', expression: '0.5*3*25', unit: 'm' },
    },
  ],
  options: [],
  correct: '',
}

const EXPLAIN_REPLY = {
  stem: '',
  parts: [
    {
      prompt: 'Explain why a sledge sliding up a slope slows down.',
      marks: 5,
      answer: 'Gravity and friction act against its motion and do negative work.',
      solution: 'Energy is converted.',
      scheme: [
        'B1 gravity component',
        'B1 friction',
        'B1 negative work',
        'B1 KE falls',
        'B1 PE rises',
      ],
      check: null,
    },
  ],
  options: [],
  correct: '',
}

function defaultWrite(user: string, none = false): unknown {
  if (user.includes('SLOT: type multiple_choice')) return mcReply(none)
  if (user.includes('sub-parts: (a)')) return CALC_REPLY
  return EXPLAIN_REPLY
}

const reviewIds = (user: string) => [...user.matchAll(/\[(s\d+)\] type:/g)].map((m) => m[1]!)
const passAll = (user: string) => ({
  results: reviewIds(user).map((id) => ({ id, pass: true, reason: 'ok' })),
})

function stubAI(
  options: {
    write?: (user: string, n: number) => unknown
    review?: (user: string, n: number) => unknown
    concurrency?: number
  } = {},
) {
  const calls: Call[] = []
  let writes = 0
  let reviews = 0
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const system = messages[0]!.content
    const user = messages[1]!.content
    const kind: Kind = system.includes('You review the questions of an AI mock exam paper')
      ? 'review'
      : 'write'
    calls.push({ kind, system, user })
    const data =
      kind === 'write'
        ? await (options.write ?? ((u: string) => defaultWrite(u)))(user, ++writes)
        : await (options.review ?? passAll)(user, ++reviews)
    return { data, raw: {} }
  })
  return {
    calls,
    ai: {
      streamJSON,
      chatJSON: streamJSON,
      testConnection: async () => ({ ok: true, latencyMs: 1, model: 'stub' }),
      maxOutputTokens: 8192,
      concurrency: options.concurrency ?? 4,
    } as unknown as AIService,
  }
}

let db: AppDatabase
let projectId: string
let paperSetId: string
let documentId: string

async function seed(): Promise<void> {
  projectId = (await new ProjectService(db).create({ name: 'Physics 1', subject: 'physics' })).id
  await db.table('courseAnalyses').put({
    id: `a-${projectId}`,
    projectId,
    status: 'ready',
    documentIds: [],
    language: 'en',
  })
  await db.table('topics').bulkPut(
    [
      ['t-force', 'Force and units', 'SI unit of force, newton'],
      ['t-kin', 'Kinematics', 'speed, acceleration, distance of a car'],
      ['t-energy', 'Kinetic energy', 'kinetic energy of a ball'],
    ].map(([id, name, description], order) => ({
      id,
      projectId,
      name,
      description,
      order,
      sourceRefs: [],
    })),
  )
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId,
    type: 'text',
    materialType: 'past_exam',
    name: 'Final 2024.pdf',
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  documentId = doc.id
  await new ChunkRepository(db).addMany([
    {
      documentId,
      projectId,
      materialType: 'past_exam' as const,
      pageNumber: 1,
      contentType: 'paragraph' as const,
      text: 'Formula sheet\nv = u + at\ns = ut + at^2/2\nF = ma\nE = mv^2/2',
      sourceReference: 'Final 2024.pdf · Page 1',
      order: 0,
    },
  ])
  const now = Date.now()
  paperSetId = crypto.randomUUID()
  const set: HomeworkSet = {
    id: paperSetId,
    projectId,
    documentId,
    documentName: 'Final 2024.pdf',
    title: 'Final 2024',
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
      setId: paperSetId,
      documentId,
      documentName: 'Final 2024.pdf',
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
      ...(order === 3 ? { evalRole: 'independent' as const } : {}),
      createdAt: now,
      updatedAt: now,
    })),
  )
}

async function noneHabit(): Promise<void> {
  await new CourseContextRepository(db).updateQuestionHabits(projectId, () => ({
    items: [
      {
        id: 'h1',
        category: 'options',
        statement: 'The last option is always "None of the options are correct".',
        evidence: [{ documentId, quote: 'F. None of the options are correct' }],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    sources: [],
    updatedAt: 1,
  }))
}

async function generate(
  service: AiMockPaperService,
  config: Partial<Parameters<AiMockPaperService['plan']>[1]> = {},
  control?: GenerationControl,
): Promise<HomeworkSet> {
  const defaults = await service.defaults(projectId)
  const set = await service.plan(projectId, { ...defaults.config!, ...config })
  const result = await service.resume(set.id, control ? { control } : {})
  return result.set
}

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  await seed()
})

afterEach(() => {
  db.close()
})

describe('AI mock paper: planning (local)', () => {
  it('mirrors the past paper: count, marks per part, types, time; held-out questions left out', async () => {
    const service = new AiMockPaperService({ ai: null, db })
    const defaults = await service.defaults(projectId)
    const structure = defaults.structure!
    expect(structure.slots).toHaveLength(3)
    expect(structure.slots.map((slot) => slot.kind)).toEqual([
      'multiple_choice',
      'calculation',
      'explain',
    ])
    expect(structure.slots.map((slot) => slot.marks)).toEqual([2, 7, 5])
    expect(structure.slots[1]!.parts).toEqual([
      { label: 'a', marks: 3 },
      { label: 'b', marks: 4 },
    ])
    expect(structure.slots[0]!.optionCount).toBe(4)
    expect(structure.totalMarks).toBe(14)
    expect(structure.minutes).toBe(90)
    expect(structure.hasFormulaSheet).toBe(true)
    expect(defaults.config).toMatchObject({
      questionCount: 3,
      minutes: 90,
      templateSetId: paperSetId,
    })
    expect(defaults.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(['structure_from_paper', 'minutes_from_paper', 'formula_sheet']),
    )
    // A wholly held-out paper is never a template.
    await new HomeworkRepository(db).updateSet(paperSetId, { evalRole: 'independent' })
    expect((await service.defaults(projectId)).structure).toBeNull()
  })

  it('resizes keeping the type mix and scales the time', () => {
    const structure = mirrorStructure({
      setId: 's',
      title: 'P',
      minutes: 60,
      hasFormulaSheet: false,
      questions: PAST.slice(0, 3).map((prompt, i) => ({ id: `q${i}`, prompt })),
    })
    const more = resizeStructure(structure, 6)
    expect(more.slots.map((slot) => slot.kind)).toEqual([
      'multiple_choice',
      'calculation',
      'explain',
      'multiple_choice',
      'calculation',
      'explain',
    ])
    expect(more.slots.map((slot) => slot.label)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(more.minutes).toBe(120)
    expect(resizeStructure(structure, 1).slots).toHaveLength(1)
  })

  it('difficulty follows the plan and the last result shifts it', () => {
    const now = 100 * DAY
    const start = now - 10 * DAY
    expect(
      defaultDifficulty({ now, examAt: now + 50 * DAY, planStartedAt: start }).difficulty,
    ).toBe('foundation')
    expect(
      defaultDifficulty({ now, examAt: now + 10 * DAY, planStartedAt: start }).difficulty,
    ).toBe('medium')
    expect(defaultDifficulty({ now, examAt: now + 3 * DAY, planStartedAt: start })).toEqual({
      difficulty: 'exam',
      reasons: ['near_exam'],
    })
    expect(defaultDifficulty({ now }).difficulty).toBe('medium')
    // A strong last mock moves up a step (up to slightly above past papers)…
    const high = defaultDifficulty({
      now,
      examAt: now + 3 * DAY,
      planStartedAt: start,
      previous: [{ difficulty: 'exam', fraction: 0.9, at: now - DAY }],
    })
    expect(high).toEqual({ difficulty: 'above', reasons: ['near_exam', 'last_high'] })
    // …a weak one down a step.
    const low = defaultDifficulty({
      now,
      examAt: now + 10 * DAY,
      planStartedAt: start,
      previous: [{ difficulty: 'medium', fraction: 0.3, at: now - DAY }],
    })
    expect(low).toEqual({ difficulty: 'foundation', reasons: ['middle', 'last_low'] })
  })

  it('allocates topics by marks share and weakness; focus topics replace the scope', () => {
    const slots = [
      { id: 's1', marks: 10 },
      { id: 's2', marks: 5 },
      { id: 's3', marks: 5 },
    ]
    const topics = [
      { id: 'a', name: 'A', marksShare: 0.7, mastery: 0.9 },
      { id: 'b', name: 'B', marksShare: 0.3, mastery: 0.1 },
    ]
    const allocation = allocateTopics(slots, topics)
    expect(new Set([...allocation.values()].map((topic) => topic.id))).toEqual(new Set(['a', 'b']))
    const focused = allocateTopics(slots, topics, ['b'])
    expect([...focused.values()].every((topic) => topic.id === 'b')).toBe(true)
  })

  it('estimates requests and tokens before anything is sent', () => {
    const estimate = estimateMockPaper(10)
    expect(estimate.requests).toBe(12)
    expect(estimate.maxRequests).toBe(24)
    expect(estimate.inputTokens).toBeGreaterThan(0)
    expect(estimate.outputTokens).toBeGreaterThan(0)
  })

  it('keeps the professor’s "None of the options" last and grades the letter locally', () => {
    const slot = {
      id: 's1',
      index: 0,
      label: '1',
      kind: 'multiple_choice' as const,
      marks: 2,
      parts: [],
      optionCount: 4,
    }
    for (const seed of ['x', 'y', 'z', 'w']) {
      const raw = prompts.mockPaper.normalizeQuestion(mcReply(true))!
      const result = verifyMockQuestion(raw, slot, {
        language: 'en',
        seed,
        noneOption: 'None of the options are correct',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const lines = result.candidate.prompt.split('\n').filter((line) => /^[A-F]\. /.test(line))
      expect(lines.at(-1)).toBe('D. None of the options are correct')
      const grader = result.candidate.parts[0]!.grader
      expect(grader.kind).toBe('choice')
      if (grader.kind !== 'choice') continue
      const info = { parts: [{ answer: 'x', grader }] }
      expect(checkPracticeAnswer(info, grader.correct)?.verdict).toBe('correct')
      expect(checkPracticeAnswer(info, `(${grader.correct.toLowerCase()})`)?.verdict).toBe(
        'correct',
      )
    }
    // Without the none option the professor's convention fails the question.
    const missing = verifyMockQuestion(prompts.mockPaper.normalizeQuestion(mcReply(false))!, slot, {
      language: 'en',
      seed: 'x',
      noneOption: '',
    })
    expect(missing).toMatchObject({ ok: false, code: 'none_option' })
  })

  it('rejects a recomputed answer that disagrees, wrong sub-parts and wrong marks', () => {
    const slot = {
      id: 's2',
      index: 1,
      label: '2',
      kind: 'calculation' as const,
      marks: 7,
      parts: [
        { label: 'a', marks: 3 },
        { label: 'b', marks: 4 },
      ],
    }
    const ok = verifyMockQuestion(prompts.mockPaper.normalizeQuestion(CALC_REPLY)!, slot, {
      language: 'en',
      seed: 'x',
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.candidate.prompt).toContain('(a) Calculate the speed after 5 s. (3 marks)')
      expect(ok.candidate.scheme[0]).toBe('(a) M1 v = at')
    }
    const wrongAnswer = structuredClone(CALC_REPLY)
    wrongAnswer.parts[0]!.answer = '12 m/s'
    expect(
      verifyMockQuestion(prompts.mockPaper.normalizeQuestion(wrongAnswer)!, slot, {
        language: 'en',
        seed: 'x',
      }),
    ).toMatchObject({ ok: false, code: 'answer_check' })
    const wrongMarks = structuredClone(CALC_REPLY)
    wrongMarks.parts[1]!.marks = 2
    expect(
      verifyMockQuestion(prompts.mockPaper.normalizeQuestion(wrongMarks)!, slot, {
        language: 'en',
        seed: 'x',
      }),
    ).toMatchObject({ ok: false, code: 'marks' })
    const oneLabel = { ...CALC_REPLY, parts: [CALC_REPLY.parts[0]!] }
    expect(
      verifyMockQuestion(prompts.mockPaper.normalizeQuestion(oneLabel)!, slot, {
        language: 'en',
        seed: 'x',
      }),
    ).toMatchObject({ ok: false, code: 'structure' })
  })

  it('writes in the exam language (跟随考试语言) and English / Chinese otherwise', () => {
    const base = {
      difficulty: 'exam' as const,
      topic: { name: 'Kinematik' },
      slot: { type: 'calculation', parts: [] },
    }
    expect(prompts.mockPaper.buildUserPrompt({ ...base, language: 'exam:de' })).toContain('German')
    expect(prompts.mockPaper.buildUserPrompt({ ...base, language: 'en' })).toContain(
      'Write everything in English.',
    )
    expect(prompts.mockPaper.buildUserPrompt({ ...base, language: 'zh' })).toContain(
      'Simplified Chinese',
    )
  })
})

describe('AI mock paper: generation', () => {
  it('writes one request per question, reviews them, saves the paper as an exam set', async () => {
    await noneHabit()
    const { ai, calls } = stubAI({ write: (user) => defaultWrite(user, true) })
    const service = new AiMockPaperService({ ai, db })
    const set = await generate(service, { difficulty: 'above' })
    expect(set.status).toBe('ready')
    expect(isAiMockSet(set)).toBe(true)
    expect(set.documentId).toBe(documentId)
    const writes = calls.filter((call) => call.kind === 'write')
    expect(writes).toHaveLength(3)
    expect(calls.filter((call) => call.kind === 'review')).toHaveLength(1)
    // Professor conventions and difficulty reach the prompt.
    const mc = writes.find((call) => call.user.includes('SLOT: type multiple_choice'))!
    expect(mc.user).toContain('worded exactly "None of the options are correct"')
    expect(mc.user).toContain('DIFFICULTY: above')
    // Independent (held-out) questions never reach the AI.
    for (const call of calls) expect(call.user).not.toContain('SECRET HELD OUT')
    const questions = await new HomeworkRepository(db).listQuestions(set.id)
    expect(questions.map((question) => question.number)).toEqual(['1', '2', '3'])
    expect(questions[0]!.practice?.markingScheme).toEqual(['B2 correct option'])
    expect(questions.every((question) => question.practice?.difficulty === 'above')).toBe(true)
    // The AI mock paper is not a past paper: not in the habits, not a template.
    expect((await service.templates(projectId)).map((item) => item.setId)).toEqual([paperSetId])
    const habits = await new QuestionHabitsService({ ai: null, db }).collectDocuments(projectId)
    expect(habits.flatMap((doc) => doc.units.map((unit) => unit.text)).join(' ')).not.toContain(
      'cyclist',
    )
  })

  it('applies overrides: count, time and focus topics', async () => {
    const { ai, calls } = stubAI()
    const service = new AiMockPaperService({ ai, db })
    const set = await generate(service, {
      questionCount: 2,
      minutes: 45,
      focusTopicIds: ['t-energy'],
    })
    expect(set.exam?.durationMinutes).toBe(45)
    const info = set.exam!.aiMock!
    expect(info.slots).toHaveLength(2)
    expect(info.slots.every((slot) => slot.topicIds[0] === 't-energy')).toBe(true)
    expect(
      calls.filter((call) => call.kind === 'write').every((c) => c.user.includes('Kinetic energy')),
    ).toBe(true)
  })

  it('rewrites a failing question once with the reason, then drops it and reports the slot', async () => {
    const { ai, calls } = stubAI({
      write: (user) =>
        user.includes('sub-parts: none') && !user.includes('multiple_choice')
          ? { ...EXPLAIN_REPLY, parts: [{ ...EXPLAIN_REPLY.parts[0]!, scheme: [] }] }
          : defaultWrite(user),
      review: (user) => ({
        results: reviewIds(user).map((id) => ({
          id,
          pass: id !== 's1',
          reason: id === 's1' ? 'Two options are correct' : 'ok',
        })),
      }),
    })
    const service = new AiMockPaperService({ ai, db })
    const set = await generate(service)
    expect(set.status).toBe('ready')
    const info = set.exam!.aiMock!
    expect(info.slots.map((slot) => slot.status)).toEqual(['dropped', 'passed', 'dropped'])
    expect(info.slots[0]!.dropReason).toBe('Two options are correct')
    // The rewrite carries the reason.
    const rewrites = calls.filter((c) => c.kind === 'write' && c.user.includes('Rejected before'))
    expect(rewrites.some((c) => c.user.includes('Two options are correct'))).toBe(true)
    // s1 and s3 twice (each written at most twice), s2 once.
    expect(calls.filter((c) => c.kind === 'write')).toHaveLength(5)
    const report = structureReport(info)
    expect(report.missing.map((slot) => slot.label)).toEqual(['1', '3'])
    expect(report.marks).toEqual({ present: 7, planned: 14 })
    // The mock exam shows the paper with what it lacks.
    const homework = new HomeworkService({ db, ai: null })
    const state = await new MockExamService({ homework, db }).state(set.id)
    expect(state.questions).toHaveLength(1)
    expect(state.aiMock?.missing).toHaveLength(2)
  })

  it('a failed request marks only its question; retry writes it; account errors stop scheduling', async () => {
    let failCalc = true
    const { ai } = stubAI({
      write: (user) => {
        if (user.includes('sub-parts: (a)') && failCalc)
          throw new AIProviderError('bad json', 'INVALID_JSON')
        return defaultWrite(user)
      },
    })
    const service = new AiMockPaperService({ ai, db })
    const set = await generate(service)
    expect(set.status).toBe('paused')
    const info = set.exam!.aiMock!
    expect(info.slots.map((slot) => slot.status)).toEqual(['passed', 'failed', 'passed'])
    // Each reviewed question was saved at once.
    expect(await new HomeworkRepository(db).listQuestions(set.id)).toHaveLength(2)
    failCalc = false
    const retried = await service.retrySlot(set.id, 's2')
    expect(retried.set.status).toBe('ready')
    expect(retried.set.questionCount).toBe(3)

    // Quota: the run stops at once and says so.
    const quota = stubAI({
      concurrency: 1,
      write: () => {
        throw new AIProviderError('no credit', 'QUOTA_EXCEEDED', 429)
      },
    })
    const stopped = await generate(new AiMockPaperService({ ai: quota.ai, db }))
    expect(stopped.status).toBe('paused')
    expect(stopped.exam?.aiMock?.error).toBeTruthy()
    expect(quota.calls).toHaveLength(1)
  })

  it('pauses between questions, keeps saved ones after a reload, and continues', async () => {
    let reviews = 0
    const { ai } = stubAI({
      concurrency: 1,
      review: (user) => {
        reviews += 1
        return {
          results: reviewIds(user).map((id) => ({
            id,
            pass: reviews > 1 || id !== 's2',
            reason: 'unclear data',
          })),
        }
      },
    })
    const service = new AiMockPaperService({ ai, db })
    const control: GenerationControl = {
      signal: new AbortController().signal,
      shouldContinue: () => reviews < 1,
    }
    const paused = await generate(service, {}, control)
    expect(paused.status).toBe('paused')
    expect(paused.exam!.aiMock!.slots.map((slot) => slot.status)).toEqual([
      'passed',
      'pending',
      'passed',
    ])
    // A new service (a reload) continues from the stored state.
    const done = await new AiMockPaperService({ ai, db }).resume(paused.id)
    expect(done.set.status).toBe('ready')
    expect(done.set.questionCount).toBe(3)
  })

  it('preflight checks the analysis and the connection before any request', async () => {
    const failing = {
      ...stubAI().ai,
      testConnection: async () => ({ ok: false, latencyMs: 0, model: 'x', error: 'bad key' }),
    } as unknown as AIService
    await expect(new AiMockPaperService({ ai: failing, db }).preflight(projectId)).rejects.toThrow(
      /bad key/,
    )
    await expect(new AiMockPaperService({ ai: null, db }).preflight(projectId)).rejects.toThrow()
    await expect(
      new AiMockPaperService({ ai: stubAI().ai, db }).preflight(projectId),
    ).resolves.toBe(undefined)
  })
})

describe('AI mock paper: mock exam and study plan', () => {
  it('is taken in the existing mock exam: marks, formula sheet, 平台拟定 scheme, local grading', async () => {
    const { ai } = stubAI()
    const set = await generate(new AiMockPaperService({ ai, db }))
    const homework = new HomeworkService({ db, ai: null })
    const exam = new MockExamService({ homework, db })
    const state = await exam.state(set.id)
    expect(state.questions.map((view) => view.marks.total)).toEqual([2, 7, 5])
    expect(state.questions[1]!.marks.parts).toEqual([
      { label: 'a', marks: 3 },
      { label: 'b', marks: 4 },
    ])
    expect(state.questions.every((view) => view.schemeSource === 'platform')).toBe(true)
    expect(state.formulaSheet).not.toBeNull()
    expect(state.defaultMinutes).toBe(90)
    expect(state.missingReference).toBe(0)
    // Past-paper analysis ignores AI mock papers.
    expect((await exam.analysis(projectId)).questions).toBe(4)

    await exam.start(set.id, 90)
    const mc = state.questions[0]!.question
    const grader = mc.practice!.parts[0]!.grader
    const letter = grader.kind === 'choice' ? grader.correct : 'A'
    await exam.saveAnswer(set.id, mc.id, letter)
    await exam.saveAnswer(set.id, state.questions[1]!.question.id, '(a) 15 m/s\n(b) 30 m')
    await exam.submit(set.id)
    const attempt = await exam.check(set.id, 'en')
    expect(attempt.checkedAt).toBeDefined()
    expect(attempt.results!.map((r) => r.status)).toEqual(['checked', 'checked', 'unanswered'])
    expect(attempt.results![0]).toMatchObject({
      verdict: 'correct',
      method: 'local',
      estimatedMarks: 2,
    })
    expect(attempt.results![1]).toMatchObject({ verdict: 'partial', method: 'local' })
    // Mistake book and mastery, once each, as mock-exam answers.
    const mistakes = await db.table('mistakes').toArray()
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]!.origin).toBe('mock_exam')
  })

  it('replaces the plan placeholder with the paper; its result feeds the next default', async () => {
    const plan = new StudyPlanService({ db })
    const now = Date.now()
    const [exam] = await plan.addExams(
      [
        {
          projectId,
          name: 'Final',
          at: now + 12 * DAY,
          materials: { pastExamSetIds: [paperSetId] },
        },
      ],
      now,
    )
    await plan.replan(now)
    let tasks = (await db.table('studyTasks').toArray()).filter((task) => task.kind === 'ai_mock')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.refId).toBe(`ai-mock:${exam!.id}`)
    expect(taskLink(tasks[0]!)).toBe(
      `/projects/${projectId}/homework?aiMock=${encodeURIComponent(exam!.id)}`,
    )

    const { ai } = stubAI()
    const service = new AiMockPaperService({ ai, db })
    const defaults = await service.defaults(projectId, { examId: exam!.id })
    expect(defaults.config?.examId).toBe(exam!.id)
    const set = await service.plan(projectId, defaults.config!)
    await service.resume(set.id)
    await plan.replan(now + 60_000)
    tasks = (await db.table('studyTasks').toArray()).filter((task) => task.kind === 'ai_mock')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.refId).toBe(set.id)
    expect(taskLink(tasks[0]!)).toBe(`/projects/${projectId}/homework/${set.id}/exam`)

    // Taking it: the result reaches the plan (mock percent) and the next default.
    const homework = new HomeworkService({ db, ai: null })
    const examService = new MockExamService({ homework, db })
    await examService.start(set.id, 90)
    for (const view of (await examService.state(set.id)).questions) {
      const grader = view.question.practice!.parts[0]!.grader
      const answer =
        grader.kind === 'choice'
          ? grader.correct
          : view.marks.parts.length
            ? '(a) 15 m/s\n(b) 37.5 m'
            : ''
      if (answer) await examService.saveAnswer(set.id, view.question.id, answer)
    }
    await examService.submit(set.id)
    await examService.check(set.id, 'en')
    const contexts = await plan.contexts(now + 120_000)
    expect(contexts[0]!.mockPercent).toBe(67)
    expect(contexts[0]!.aiMock.done).toBe(true)
    await plan.replan(now + 120_000)
    expect(
      (await db.table('studyTasks').toArray()).filter(
        (task) => task.kind === 'ai_mock' && task.status === 'pending',
      ),
    ).toHaveLength(0)
    const next = await service.defaults(projectId, { examId: exam!.id })
    expect(next.previous[0]?.fraction).toBeCloseTo(2 / 3)
  })
})
