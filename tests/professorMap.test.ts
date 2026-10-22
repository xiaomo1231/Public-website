import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkRepository } from '@/entities/homework/repository'
import {
  ProfessorAnswerMapService,
  resetProfessorMapFailures,
} from '@/services/professorAnswerMapService'
import {
  clipQuote,
  localProfessorMap,
  professorMapPromptEntries,
  professorMapView,
  quoteInAnswer,
  segmentProfessorAnswer,
  validateProfessorMap,
  withProfessorMapEdit,
  type PromptMapEntry,
} from '@/entities/homework/professorMap'
import { questionSectionHash, PROFESSOR_ALIGN_VERSION } from '@/entities/homework/walkthrough'
import { validateCompare } from '@/entities/homework/professorCompare'
import * as Q4 from '@/infrastructure/ai/prompts/homework-question/v4'
import * as Q5 from '@/infrastructure/ai/prompts/homework-question/v5'
import * as W8 from '@/infrastructure/ai/prompts/homework-walkthrough/v8'
import * as W9 from '@/infrastructure/ai/prompts/homework-walkthrough/v9'
import * as C1 from '@/infrastructure/ai/prompts/walkthrough-compare/v1'
import * as C2 from '@/infrastructure/ai/prompts/walkthrough-compare/v2'
import * as MapPrompt from '@/infrastructure/ai/prompts/professor-answer-map/v1'
import { prompts } from '@/infrastructure/ai/prompts'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'

// Synthetic, modelled on the layout of a real key: the question is restated,
// and the solution of (a) is written under the heading of (b).
const QUESTION = [
  'Let V be the set of all (p, q, r) in R^3 with p + q - r = 0.',
  '(a) Show that V is a subspace of R^3.',
  '(b) Show that {(1, 0, 1), (0, 1, 1)} is a basis of V.',
  '(c) Find the coordinates of (2, 3, 5) in that basis.',
].join('\n')
const ANSWER = [
  'Let V be the set of all (p, q, r) in R^3 with p + q - r = 0.',
  '(a) Show that V is a subspace of R^3.',
  '(b) Show that {(1, 0, 1), (0, 1, 1)} is a basis of V.',
  'Solution: The two vectors are independent since neither is a multiple of the other.',
  'There are two ways to see that they span V:',
  '(a) Solving r = p + q, every vector of V is p(1, 0, 1) + q(0, 1, 1), so V = span{(1, 0, 1), (0, 1, 1)} is a subspace.',
  '(b) Without the dimension: for (p, q, r) in V the system a(1, 0, 1) + b(0, 1, 1) = (p, q, r) has the solution a = p, b = q.',
  '(c) Find the coordinates of (2, 3, 5) in that basis.',
  'Solution: a = 2 and b = 3, since 2(1, 0, 1) + 3(0, 1, 1) = (2, 3, 5).',
].join('\n')

const REPLY = {
  subparts: [
    { label: 'a', coverage: 'direct', quotes: ['(a) Solving r = p + q, every vector of V is'] },
    {
      label: '(b)',
      coverage: 'direct',
      quotes: [
        'The two vectors are independent since neither is a multiple of the other.',
        '(b) Without the dimension … has the solution a = p, b = q.',
      ],
    },
    { label: 'c', coverage: 'direct', quotes: ['a = 2 and b = 3, since 2(1, 0, 1)'] },
  ],
}

function question(over: Partial<HomeworkQuestion> = {}): HomeworkQuestion {
  return {
    id: 'q1',
    projectId: 'p',
    setId: 's',
    documentId: 'd',
    documentName: 'hw.pdf',
    order: 0,
    number: '2',
    prompt: QUESTION,
    sourceRefs: [],
    hints: [],
    generationStatus: 'ready',
    promptVersion: 'v3',
    draftText: '',
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    answerStatus: 'matched',
    answerText: ANSWER,
    ...over,
  }
}

describe('local segmentation keeps the professor’s labels', () => {
  it('reads a nested (a) under the heading of (b) as the misplaced solution of (a)', () => {
    const segments = segmentProfessorAnswer(ANSWER, QUESTION)
    const nestedA = segments.find((segment) => segment.text.startsWith('(a) Solving'))!
    expect(nestedA.labels).toEqual(['a'])
    expect(nestedA.nestedUnder).toBe('b')
    const nestedB = segments.find((segment) => segment.text.startsWith('(b) Without'))!
    expect(nestedB.labels).toEqual(['b'])
    expect(nestedB.nestedUnder).toBeUndefined()
    expect(nestedA.method).toBeUndefined()
    const local = localProfessorMap(ANSWER, QUESTION)
    expect(local.map((entry) => [entry.label, entry.coverage])).toEqual([
      ['a', 'direct'],
      ['b', 'direct'],
      ['c', 'direct'],
    ])
    expect(local[0]!.flags).toContain('misplaced')
  })

  it('maps two explicit methods of one sub-part to that sub-part', () => {
    const answer = [
      '(a) Method 1: V is the kernel of [1 1 -1], so it is a subspace.',
      'Method 2: 0 is in V, and sums and multiples of solutions are solutions.',
      '(b) Both vectors satisfy the equation and are independent.',
      '(c) a = 2, b = 3.',
    ].join('\n')
    const segments = segmentProfessorAnswer(answer, QUESTION)
    expect(segments.filter((segment) => segment.labels.includes('a')).map((s) => s.method)).toEqual(
      [1, 2],
    )
    const a = localProfessorMap(answer, QUESTION)[0]!
    expect(a.coverage).toBe('direct')
    expect(a.quotes).toHaveLength(2)
    expect(a.flags).toContain('several-ways')
  })
})

describe('quotes', () => {
  it('are checked verbatim after normalisation, with " … " joining pieces in order', () => {
    expect(quoteInAnswer('every   vector of V is', ANSWER)).toBe(true)
    expect(quoteInAnswer('(b) Without the dimension … a = p, b = q.', ANSWER)).toBe(true)
    expect(quoteInAnswer('a = p, b = q … (b) Without the dimension', ANSWER)).toBe(false)
    expect(quoteInAnswer('V is obviously a subspace', ANSWER)).toBe(false)
    expect(clipQuote('x'.repeat(10) + ' ' + 'y'.repeat(900), 100)).toContain(' … ')
  })

  it('validation drops invented quotes and unknown labels, and keeps the local entry then', () => {
    const result = validateProfessorMap(
      [
        { label: 'a', coverage: 'direct', quotes: ['V is obviously a subspace'] },
        { label: 'z', coverage: 'direct', quotes: ['every vector of V is'] },
        { label: 'c', coverage: 'direct', quotes: ['a = 2 and b = 3'] },
      ],
      { question: QUESTION, answer: ANSWER },
    )!
    expect(result.droppedQuotes).toBe(1)
    expect(result.droppedLabels).toBe(1)
    expect(result.unverified).toBe(1)
    expect(result.entries.find((entry) => entry.label === 'a')!.coverage).toBe('direct')
  })

  it('an indirect claim whose excerpt is in the sub-part’s own segment becomes direct, to confirm', () => {
    const result = validateProfessorMap(
      [
        {
          label: 'a',
          coverage: 'indirect',
          quotes: ['(a) Solving r = p + q, every vector of V is'],
        },
      ],
      { question: QUESTION, answer: ANSWER },
    )!
    const a = result.entries.find((entry) => entry.label === 'a')!
    expect(a.coverage).toBe('direct')
    expect(a.from).toEqual({ labels: ['a'], nestedUnder: 'b' })
    expect(a.confidence).toBe('low')
  })
})

describe('the map in effect', () => {
  const mapped = (over: Partial<HomeworkQuestion> = {}) => {
    const base = question(over)
    const checked = validateProfessorMap(REPLY.subparts, { question: QUESTION, answer: ANSWER })!
    return {
      ...base,
      professorMap: {
        answerHash: '',
        questionHash: '',
        promptVersion: 'professor-answer-map/v1',
        entries: checked.entries,
        createdAt: 1,
      },
    }
  }

  it('is not sent from the local pass alone', () => {
    expect(professorMapView(question())!.origin).toBe('local')
    expect(professorMapPromptEntries(question())).toBeUndefined()
  })

  it('applies only to the answer and question it was made for', async () => {
    const { mapAnswerHash, mapQuestionHash } = await import('@/entities/homework/professorMap')
    const q = mapped()
    q.professorMap.answerHash = mapAnswerHash(ANSWER)
    q.professorMap.questionHash = mapQuestionHash(QUESTION)
    const entries = professorMapPromptEntries(q)!
    expect(entries.map((entry) => [entry.label, entry.coverage])).toEqual([
      ['a', 'direct'],
      ['b', 'direct'],
      ['c', 'direct'],
    ])
    expect(entries[0]!.from).toContain('written under the heading of (b)')
    expect(professorMapPromptEntries({ ...q, answerText: `${ANSWER}\nmore` })).toBeUndefined()
  })

  it('the student’s edit wins and is part of the walkthrough hash (only with an answer)', () => {
    const q = question()
    const before = questionSectionHash(q, 'en', 'v')
    const edits = withProfessorMapEdit(q, 'a', { coverage: 'none', quotes: [] })!
    const edited = { ...q, professorMapEdits: edits }
    const view = professorMapView(edited)!
    expect(view.entries[0]).toMatchObject({ label: 'a', coverage: 'none', source: 'edit' })
    expect(professorMapPromptEntries(edited)!.find((entry) => entry.label === 'a')!.coverage).toBe(
      'none',
    )
    expect(questionSectionHash(edited, 'en', 'v')).not.toBe(before)
    // Without a professor answer the edits do not count.
    const noAnswer = question({ answerStatus: undefined, answerText: undefined })
    expect(questionSectionHash({ ...noAnswer, professorMapEdits: edits }, 'en', 'v')).toBe(
      questionSectionHash(noAnswer, 'en', 'v'),
    )
    expect(PROFESSOR_ALIGN_VERSION).toBe('align-v2')
  })
})

const MAP: PromptMapEntry[] = [
  {
    label: 'a',
    coverage: 'direct',
    quotes: ['(a) Solving r = p + q, every vector of V is'],
    from: "the professor's (a), written under the heading of (b)",
  },
  { label: 'b', coverage: 'indirect', quotes: ['The two vectors are independent'] },
  { label: 'c', coverage: 'none', quotes: [] },
]

describe('homework-question/v5', () => {
  const input = { question: QUESTION, sourceText: 'src', language: 'zh' as const }

  it('is byte-identical to v4 without a professor answer', () => {
    for (const mode of ['combined', 'hints', 'solution'] as const) {
      expect(Q5.buildSystemPrompt(mode, false, false)).toBe(
        Q4.buildSystemPrompt(mode, false, false),
      )
      expect(Q5.buildSystemPrompt(mode, true, false, true)).toBe(
        Q4.buildSystemPrompt(mode, true, false),
      )
    }
    expect(Q5.buildUserPrompt(input)).toBe(Q4.buildUserPrompt(input))
    expect(Q5.buildUserPrompt({ ...input, professorMap: MAP })).toBe(Q4.buildUserPrompt(input))
  })

  it('with a professor answer reads nested labels as misplaced solutions; the user prompt is v4’s', () => {
    const v5 = Q5.buildSystemPrompt('combined', false, true)
    expect(v5).toContain('is usually that sub-part’s own solution, misplaced')
    expect(v5).not.toContain('"two ways"')
    const withAnswer = { ...input, professorAnswer: ANSWER }
    expect(Q5.buildUserPrompt(withAnswer)).toBe(Q4.buildUserPrompt(withAnswer))
  })

  it('with a map: the block follows the professor answer and only "none" opens with the notice', () => {
    const system = Q5.buildSystemPrompt('combined', false, true, true)
    expect(system).toContain('"indirect": build this sub-part on that excerpt')
    expect(system).toContain('"none" ONLY')
    expect(system).not.toContain('For a sub-part the professor left to the student')
    const user = Q5.buildUserPrompt({ ...input, professorAnswer: ANSWER, professorMap: MAP })
    const answerEnd = user.indexOf('=== END PROFESSOR ANSWER FOR THIS QUESTION')
    const mapStart = user.indexOf(`=== BEGIN ${MapPrompt.MAP_BLOCK_LABEL}`)
    expect(answerEnd).toBeGreaterThan(0)
    expect(mapStart).toBeGreaterThan(answerEnd)
    expect(user).toContain(
      "(a) direct — from the professor's (a), written under the heading of (b)",
    )
    expect(user).toContain('(c) none')
    expect(user.endsWith('Return JSON only.')).toBe(true)
  })
})

describe('homework-walkthrough/v9', () => {
  const user = {
    label: '2',
    question: QUESTION,
    sourceText: 'src',
    language: 'zh_terms' as const,
    professorAnswer: ANSWER,
  }

  it('is byte-identical to v8 without alignProfessor, and v9 is registered', () => {
    expect(W9.buildQuestionSystemPrompt({ linearSystems: true, analysis: true, steps: true })).toBe(
      W8.buildQuestionSystemPrompt({ linearSystems: true, analysis: true, steps: true }),
    )
    expect(W9.buildPartSystemPrompt({ linearSystems: false, professorMap: true })).toBe(
      W8.buildPartSystemPrompt({ linearSystems: false }),
    )
    const plain = { ...user, professorAnswer: undefined }
    expect(W9.buildQuestionUserPrompt(plain)).toBe(W8.buildQuestionUserPrompt(plain))
    expect(W9.buildQuestionUserPrompt(user)).toBe(W8.buildQuestionUserPrompt(user))
    expect(prompts.homeworkWalkthrough.VERSION).toBe('v9')
    expect(prompts.homeworkWalkthrough.CACHE_VERSION).toBe('v1')
  })

  it('replaces the "two ways" reading, and with a map the "not covered" rule', () => {
    const aligned = W9.buildQuestionSystemPrompt({ linearSystems: true, alignProfessor: true })
    expect(aligned).toContain('misplaced, and is followed as that sub-part’s solution')
    expect(aligned).not.toContain('may name alternative methods rather than')
    expect(aligned).toContain('For a sub-part no part of the professor answer covers')
    const withMap = W9.buildQuestionSystemPrompt({
      linearSystems: true,
      alignProfessor: true,
      professorMap: true,
    })
    expect(withMap).not.toContain('For a sub-part no part of the professor answer covers')
    expect(withMap).toContain('"none" ONLY')
  })

  it('puts the map right after the professor answer, before the sub-part line', () => {
    const part = W9.buildPartUserPrompt({
      ...user,
      part: 'b',
      parts: ['a', 'b', 'c'],
      earlier: [],
      professorMap: MAP,
    })
    const answerEnd = part.indexOf('=== END CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION ===')
    const mapStart = part.indexOf(`=== BEGIN ${MapPrompt.MAP_BLOCK_LABEL}`)
    const partLine = part.indexOf('sub-part (b) only')
    expect(answerEnd).toBeGreaterThan(0)
    expect(mapStart).toBe(
      answerEnd + '=== END CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION ==='.length + 1,
    )
    expect(partLine).toBeGreaterThan(mapStart)
    // Sibling sub-part requests share everything up to the sub-part line.
    const other = W9.buildPartUserPrompt({
      ...user,
      part: 'c',
      parts: ['a', 'b', 'c'],
      earlier: [],
      professorMap: MAP,
    })
    expect(other.slice(0, partLine)).toBe(part.slice(0, partLine))
    const variant = W9.buildVariantUserPrompt({
      ...user,
      level: 'detailed',
      existing: { body: 'B' },
      professorMap: MAP,
    })
    expect(variant).toContain(`=== BEGIN ${MapPrompt.MAP_BLOCK_LABEL}`)
  })
})

describe('walkthrough-compare/v2 and the map', () => {
  it('without a map only the mapping rule differs from v1; with one the user prompt carries it', () => {
    const v1 = C1.buildSystemPrompt().split('\n')
    const v2 = C2.buildSystemPrompt().split('\n')
    expect(v2).toHaveLength(v1.length)
    expect(v2.filter((line, index) => line !== v1[index])).toHaveLength(1)
    expect(C2.buildSystemPrompt({ professorMap: true })).toContain(
      'Use "not_in_professor" ONLY for a sub-part the map marks "none"',
    )
    const input = {
      label: '2',
      question: QUESTION,
      parts: ['a', 'b', 'c'],
      professorAnswer: ANSWER,
      body: 'Body',
      language: 'zh' as const,
    }
    expect(C2.buildUserPrompt(input)).toBe(C1.buildUserPrompt(input))
    const withMap = C2.buildUserPrompt({ ...input, professorMap: MAP })
    expect(withMap.indexOf(MapPrompt.MAP_BLOCK_LABEL)).toBeGreaterThan(
      withMap.indexOf('=== END CONFIRMED PROFESSOR ANSWER'),
    )
    expect(withMap.indexOf(MapPrompt.MAP_BLOCK_LABEL)).toBeLessThan(
      withMap.indexOf('WALKTHROUGH SECTION TO COMPARE'),
    )
  })

  it('validateCompare keeps "not_in_professor" only where the map says "none"', () => {
    const result = validateCompare(
      {
        items: [
          { label: '(a)', status: 'not_in_professor', note: 'no (a) solution' },
          { label: '(b)', status: 'same', note: '' },
          { label: '(c)', status: 'missing_in_walkthrough', note: '' },
        ],
        suggestion: '',
      },
      {
        questionParts: ['a', 'b', 'c'],
        professorAnswer: ANSWER,
        professorMap: MAP,
      },
    )!
    expect(result.droppedByMap).toBe(1)
    expect(result.items.map((item) => [item.label, item.status])).toEqual([
      ['b', 'same'],
      ['c', 'not_in_professor'],
    ])
  })
})

describe('ProfessorAnswerMapService and answer-based generation', () => {
  let db: AppDatabase
  beforeEach(() => resetProfessorMapFailures())
  afterEach(() => db?.close())

  async function setup(): Promise<HomeworkRepository> {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'LA', subject: 'linear_algebra' })
    const repo = new HomeworkRepository(db)
    await repo.upsertSet({
      id: 's',
      projectId: project.id,
      documentId: 'd',
      documentName: 'hw.pdf',
      title: 'HW',
      status: 'ready',
      language: 'en',
      questionCount: 1,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    })
    await repo.upsertQuestion(question({ projectId: project.id, generationStatus: 'pending' }))
    return repo
  }

  it('maps once (cached), and the hints request carries the checked map', async () => {
    const repo = await setup()
    const chatJSON = vi.fn(async () => ({ data: REPLY, raw: {} }))
    const sent: Array<{ system: string; user: string }> = []
    const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
      sent.push({ system: messages[0]!.content, user: messages[1]!.content })
      return { data: { hints: ['h1', 'h2'], solution: 'S' }, raw: {} }
    })
    const ai = { chatJSON, streamJSON, maxOutputTokens: 8192 } as unknown as AIService
    const service = new HomeworkService({ ai, db })
    await service.generateAnswerContent('s', ['q1'])
    expect(chatJSON).toHaveBeenCalledTimes(1)
    const mapRequest = (chatJSON.mock.calls[0] as unknown as [Array<{ content: string }>])[0]
    expect(mapRequest[0]!.content).toContain('You map a professor')
    expect(mapRequest[1]!.content).toContain('written under the heading of (b)')
    expect(sent[0]!.user).toContain(MapPrompt.MAP_BLOCK_LABEL)
    expect(sent[0]!.system).toContain('"none" ONLY')
    const stored = (await repo.getQuestion('q1'))!
    expect(stored.professorMap?.entries.map((entry) => entry.coverage)).toEqual([
      'direct',
      'direct',
      'direct',
    ])
    await service.generateAnswerContent('s', ['q1'])
    expect(chatJSON).toHaveBeenCalledTimes(1)
  })

  it('writes without a map when the reply is unusable, and does not ask again this session', async () => {
    const repo = await setup()
    const chatJSON = vi.fn(async () => ({ data: { subparts: [{ label: 'x' }] }, raw: {} }))
    const ai = { chatJSON, maxOutputTokens: 8192 } as unknown as AIService
    const maps = new ProfessorAnswerMapService({ ai, db })
    const first = await maps.ensure((await repo.getQuestion('q1'))!)
    expect(first.professorMap).toBeUndefined()
    await maps.ensure((await repo.getQuestion('q1'))!)
    expect(chatJSON).toHaveBeenCalledTimes(1)
    await expect(maps.remap('q1')).rejects.toThrow()
    expect(chatJSON).toHaveBeenCalledTimes(2)
  })

  it('stores the student’s edit, which needs an excerpt unless it is "none"', async () => {
    const repo = await setup()
    const maps = new ProfessorAnswerMapService({ ai: null, db })
    await expect(maps.setEdit('q1', 'a', { coverage: 'direct', quotes: [] })).rejects.toThrow()
    const updated = await maps.setEdit('q1', 'c', { coverage: 'none', quotes: [] })
    expect(updated.professorMapEdits?.entries).toHaveLength(1)
    expect(professorMapView((await repo.getQuestion('q1'))!)!.entries[2]).toMatchObject({
      coverage: 'none',
      source: 'edit',
    })
    const reset = await maps.setEdit('q1', 'c', null)
    expect(reset.professorMapEdits).toBeUndefined()
  })
})

describe('the walkthrough uses the same map', () => {
  let db: AppDatabase
  beforeEach(() => resetProfessorMapFailures())
  afterEach(() => db?.close())

  it('sends the checked map with the aligned question prompt, and to the comparison', async () => {
    const { HomeworkWalkthroughService } = await import('@/services/homeworkWalkthroughService')
    const { DocumentRepository } = await import('@/entities/document/repository')
    db = new AppDatabase()
    setDbForTesting(db)
    const projectId = (await new ProjectService(db).create({ name: 'LA', subject: 'calculus' })).id
    const doc = await new DocumentRepository(db).create({
      projectId,
      type: 'text',
      materialType: 'homework',
      name: 'hw.pdf',
      sizeBytes: 0,
    })
    const repo = new HomeworkRepository(db)
    await repo.upsertSet({
      id: 's',
      projectId,
      documentId: doc.id,
      documentName: 'hw.pdf',
      title: 'HW',
      status: 'ready',
      language: 'en',
      questionCount: 1,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    })
    // A short question (written in one request).
    await repo.upsertQuestion(question({ projectId, documentId: doc.id }))
    const calls: Array<{ system: string; user: string }> = []
    const chatJSON = vi.fn(async (messages: Array<{ content: string }>) => {
      if (messages[0]!.content.includes('You map a professor')) return { data: REPLY, raw: {} }
      return streamJSON(messages)
    })
    const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
      const system = messages[0]!.content
      calls.push({ system, user: messages[1]!.content })
      if (system.includes('You compare a study app'))
        return {
          data: {
            items: [
              { label: '(a)', status: 'not_in_professor', note: '' },
              { label: '(b)', status: 'same', note: '' },
              { label: '(c)', status: 'same', note: '' },
            ],
            suggestion: '',
          },
          raw: {},
        }
      if (system.includes('ONLY the') || system.includes('opening'))
        return { data: { tools: [], kinds: [], ideas: [], suggestions: [] }, raw: {} }
      return {
        data: { status: 'ready', conclusion: 'Done.', body: '### (a)\nA\n### (b)\nB\n### (c)\nC' },
        raw: {},
      }
    })
    const ai = { chatJSON, streamJSON, maxOutputTokens: 8192 } as unknown as AIService
    const service = new HomeworkWalkthroughService({
      ai,
      db,
      homework: new HomeworkService({ ai, db }),
    })
    await service.generate('s')
    const written = calls.filter((call) => call.user.includes('HOMEWORK QUESTION'))
    expect(written.some((item) => item.system.includes('graded against it'))).toBe(true)
    for (const call of written.filter((item) => item.system.includes('graded against it'))) {
      expect(call.user).toContain(MapPrompt.MAP_BLOCK_LABEL)
      expect(call.system).toContain('"none" ONLY')
    }
    calls.length = 0
    await service.compareSection('s', 'q:q1')
    const compare = calls.find((call) => call.system.includes('You compare a study app'))!
    expect(compare.system).toContain('Use "not_in_professor" ONLY')
    expect(compare.user).toContain(MapPrompt.MAP_BLOCK_LABEL)
    // (a) is covered (misplaced under (b)), so "not_in_professor" is not kept.
    const state = await service.state('s')
    const report = state.plan.find((entry) => entry.id === 'q:q1')!.section!.professorCompare!
    expect(report.items.map((item) => item.label)).toEqual(['b', 'c'])
    expect(
      chatJSON.mock.calls.filter((args) =>
        (args[0] as Array<{ content: string }>)[0]!.content.includes('You map'),
      ),
    ).toHaveLength(1)
  })
})
