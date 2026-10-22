import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import * as V5 from '@/infrastructure/ai/prompts/homework-walkthrough/v5'
import * as V6 from '@/infrastructure/ai/prompts/homework-walkthrough/v6'
import * as Compare from '@/infrastructure/ai/prompts/walkthrough-compare/v1'
import { prompts } from '@/infrastructure/ai/prompts'
import {
  frameSectionHash,
  planWalkthrough,
  questionSectionHash,
  walkthroughId,
  type WalkthroughSection,
} from '@/entities/homework/walkthrough'
import {
  alignSuggestion,
  awaitsCompare,
  compareSectionHash,
  currentCompare,
  normalizeCompareLabel,
  professorAnswerHash,
  professorAnswerLabels,
  validateCompare,
  type ProfessorCompareReport,
} from '@/entities/homework/professorCompare'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'

// Modelled on Problem Set 4, 2: (a) is answered inside (b)'s solution, where the
// professor's own "(a)" / "(b)" name two ways, not the question's sub-parts.
const PROFESSOR_2 = [
  '(b) Solution: There are two ways to do this:',
  '(a) This is true because any vector (x,y,z,w) ∈ W satisfies x+y+z−w=0, y−z=0. The augmented matrix ⇒ RREF gives z=c3, w=c4, so any vector in W is of the form c3(−2,1,1,0)+c4(1,0,0,1).',
  '(b) We answer the question without using the fact that dim W = 2.',
  '(d) Solution: same as part (f).',
  '(l) Solution: {v1,v2,v4} is linearly dependent, so it is not a basis.',
].join('\n')
const QUESTION_2 =
  'Let W = {(x,y,z,w) : x+y+z-w=0, y-z=0}. (a) Show W is a subspace. (b) Find a basis. (c) Find dim W. (d) Extend it. (e) e (f) f (g) g (h) h (i) i (j) j (k) k (l) Show {v1,v2,v4} is not a basis.'

const question = (over: Partial<HomeworkQuestion> = {}): HomeworkQuestion =>
  ({
    id: 'q1',
    number: '1',
    prompt: 'Solve.',
    contentFingerprint: 'f',
    sourceRefs: [],
    ...over,
  }) as HomeworkQuestion

describe('homework-walkthrough/v6 prompts', () => {
  it('are byte-identical to v5 without alignProfessor', () => {
    for (const linearSystems of [true, false]) {
      expect(V6.buildQuestionSystemPrompt({ linearSystems, analysis: true, steps: true })).toBe(
        V5.buildQuestionSystemPrompt({ linearSystems, analysis: true, steps: true }),
      )
      expect(V6.buildPartSystemPrompt({ linearSystems, punctuation: true, steps: true })).toBe(
        V5.buildPartSystemPrompt({ linearSystems, punctuation: true, steps: true }),
      )
      expect(V6.buildVariantSystemPrompt({ linearSystems, level: 'detailed', part: true })).toBe(
        V5.buildVariantSystemPrompt({ linearSystems, level: 'detailed', part: true }),
      )
    }
    expect(prompts.homeworkWalkthrough.VERSION).toBe('v7')
    expect(prompts.homeworkWalkthrough.CACHE_VERSION).toBe('v1')
  })

  it('add the alignment rules (before the security footer) with alignProfessor', () => {
    const whole = V6.buildQuestionSystemPrompt({ linearSystems: true, alignProfessor: true })
    expect(whole).toContain('graded against it')
    expect(whole).toContain('补充（考试不要求）')
    expect(whole).toContain('map its content to the sub-parts by meaning')
    expect(whole).toContain('in the professor answer, in the body and in the conclusion')
    expect(whole.indexOf('graded against it')).toBeLessThan(whole.indexOf('Security rules'))
    const part = V6.buildPartSystemPrompt({ linearSystems: true, alignProfessor: true })
    expect(part).toContain('graded against it')
    expect(part).not.toContain('in the body and in the conclusion')
    expect(
      V6.buildVariantSystemPrompt({
        linearSystems: false,
        level: 'detailed',
        alignProfessor: true,
      }),
    ).toContain('graded against it')
  })
})

describe('walkthrough-compare/v1', () => {
  it('wraps the professor answer and the walkthrough as untrusted content', () => {
    const user = Compare.buildUserPrompt({
      label: '2',
      question: QUESTION_2,
      parts: ['a', 'b'],
      professorAnswer: PROFESSOR_2,
      conclusion: 'W is a subspace',
      body: 'Work.',
      language: 'zh_terms',
    })
    expect(user).toContain('BEGIN CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION (UNTRUSTED')
    expect(user).toContain('BEGIN WALKTHROUGH SECTION TO COMPARE (UNTRUSTED')
    expect(Compare.buildSystemPrompt()).toContain('inside another sub-part’s solution')
    expect(Compare.buildSystemPrompt()).toContain('Security rules')
  })

  it('normalizes the reply: unknown statuses dropped, recommendation read', () => {
    const reply = Compare.normalizeCompare({
      items: [
        { label: '(a)', status: 'same', note: 'ok' },
        { label: '(b)', status: 'weird', note: 'x' },
        'junk',
      ],
      recommendation: 'keep',
      suggestion: '',
    })
    expect(reply?.items.map((item) => item.label)).toEqual(['(a)'])
    expect(reply?.recommendation).toBe('keep')
    expect(Compare.normalizeCompare({ nope: true })).toBeNull()
  })
})

describe('validateCompare', () => {
  const parts = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']

  it('keeps a sub-part answered inside another one, checking the quote against the whole answer', () => {
    const result = validateCompare(
      {
        items: [
          {
            label: '2(a)',
            status: 'method_differs',
            note: 'The professor shows (a) inside (b): W = span of two vectors from the RREF.',
            professorQuote: 'any vector in W is of the form c3(−2,1,1,0)+c4(1,0,0,1)',
          },
          {
            label: '(l)',
            status: 'missing_in_walkthrough',
            note: 'The walkthrough leaves (l) out.',
            professorQuote: 'this quote is not in the answer at all',
          },
          { label: '(z)', status: 'same', note: 'Not a sub-part.' },
          { label: 'nonsense label', status: 'same', note: '' },
          { label: 'a', status: 'same', note: 'Duplicate, ignored.' },
        ],
        recommendation: 'keep',
        suggestion: 'Follow the professor.',
      },
      { questionParts: parts, professorAnswer: PROFESSOR_2 },
    )!
    expect(result.items.map((item) => item.label)).toEqual(['a', 'l'])
    expect(result.items[0]!.professorQuote).toContain('c3(−2,1,1,0)')
    expect(result.items[1]!.professorQuote).toBeUndefined()
    expect(result.droppedLabels).toBe(2)
    expect(result.droppedQuotes).toBe(1)
    // Derived from the statuses, not the model's "keep".
    expect(result.recommendation).toBe('fix')
    expect(result.suggestion).toBe('Follow the professor.')
  })

  it('derives keep / align and cross-checks a differing result with the local RREF check', () => {
    const keep = validateCompare(
      {
        items: [
          { label: '(a)', status: 'same', note: '' },
          { label: '(b)', status: 'not_in_professor', note: '' },
        ],
        recommendation: 'fix',
        suggestion: 'x',
      },
      { questionParts: ['a', 'b'], professorAnswer: '(a) Solution: yes.' },
    )!
    expect(keep.recommendation).toBe('keep')
    expect(keep.suggestion).toBe('')
    const differs = validateCompare(
      { items: [{ label: '(a)', status: 'result_differs', note: '' }], suggestion: '' },
      {
        questionParts: ['a'],
        professorAnswer: '(a) x = 2',
        checks: [
          {
            label: '(a)',
            rrefMatches: true,
            kindMatches: true,
            computedKind: 'unique',
            computedRref: '',
          },
        ],
      },
    )!
    expect(differs.items[0]!.localCheck).toBe('verified')
    expect(
      validateCompare(
        { items: [{ label: '(q)', status: 'same', note: '' }], suggestion: '' },
        { questionParts: ['a'], professorAnswer: '(a) x' },
      ),
    ).toBeNull()
  })

  it('reads labels and professor sub-parts', () => {
    expect(normalizeCompareLabel('（b）')).toBe('b')
    expect(normalizeCompareLabel('')).toBe('')
    expect(normalizeCompareLabel('whatever text')).toBeNull()
    expect(professorAnswerLabels(PROFESSOR_2)).toEqual(['b', 'a', 'd', 'f', 'l'])
    expect(professorAnswerLabels('matrix (A) only')).toEqual([])
  })

  it('builds a bounded suggestion from the non-same items', () => {
    const text = alignSuggestion(
      {
        items: [
          { label: 'a', status: 'same', note: 'fine' },
          { label: 'c', status: 'method_differs', note: 'Use R1/2 first.' },
        ],
        suggestion: 'Drop the determinant check.',
      },
      'zh',
    )
    expect(text).toContain('(c) 方法与教授不同: Use R1/2 first.')
    expect(text).not.toContain('fine')
    expect(text).toContain('Drop the determinant check.')
    const long = alignSuggestion(
      {
        items: [{ label: 'a', status: 'result_differs', note: 'x'.repeat(2_000) }],
        suggestion: '',
      },
      'en',
    )
    expect(long.length).toBeLessThanOrEqual(1_000)
  })
})

describe('stale comparisons', () => {
  const section: WalkthroughSection = {
    id: 'q:q1',
    kind: 'question',
    title: '1',
    conclusion: 'C',
    body: 'Body.',
    status: 'ready',
    inputHash: 'h',
    generatedAt: 1,
  }
  const report = (over: Partial<ProfessorCompareReport> = {}): ProfessorCompareReport => ({
    answerHash: professorAnswerHash('Prof.'),
    sectionHash: compareSectionHash(section),
    items: [{ label: '', status: 'same', note: '' }],
    recommendation: 'keep',
    suggestion: '',
    comparedAt: 1,
    ...over,
  })

  it('is current only while both the answer and the section text are unchanged', () => {
    const withReport = { ...section, professorCompare: report() }
    expect(currentCompare(withReport, 'Prof.')).toBeDefined()
    expect(currentCompare(withReport, 'Prof. (edited)')).toBeUndefined()
    expect(currentCompare({ ...withReport, body: 'Rewritten.' }, 'Prof.')).toBeUndefined()
    expect(awaitsCompare(withReport, 'Prof.')).toBe(false)
    expect(awaitsCompare(section, 'Prof.')).toBe(true)
    expect(awaitsCompare(section, undefined)).toBe(false)
    expect(
      awaitsCompare(
        { ...section, professorAligned: { answerHash: professorAnswerHash('Prof.') } },
        'Prof.',
      ),
    ).toBe(false)
  })
})

describe('section hashes and the alignment version', () => {
  it('leave questions without a professor answer (or with one left to the student) unchanged', () => {
    for (const q of [
      question(),
      question({ answerStatus: 'matched', answerText: 'This part is left to you.' }),
      question({ answerStatus: 'unmatched' as HomeworkQuestion['answerStatus'] }),
    ]) {
      expect(questionSectionHash(q, 'en', 'v')).toBe(
        questionSectionHash(q, 'en', 'v', { align: false }),
      )
    }
  })

  it('mark only questions with a professor answer, and keep the opening / summary hash', () => {
    const answered = question({ answerStatus: 'matched', answerText: 'x = 1' })
    expect(questionSectionHash(answered, 'en', 'v')).not.toBe(
      questionSectionHash(answered, 'en', 'v', { align: false }),
    )
    const plan = planWalkthrough([answered, question({ id: 'q2' })], undefined, 'en', 'v')
    const legacy = frameSectionHash(
      [
        questionSectionHash(answered, 'en', 'v', { align: false }),
        questionSectionHash(question({ id: 'q2' }), 'en', 'v'),
      ],
      'en',
      'v',
    )
    expect(plan.find((entry) => entry.id === 'overview')!.inputHash).toBe(legacy)
  })
})

// --- Service ------------------------------------------------------------------

interface Call {
  kind: 'compare' | 'question'
  system: string
  user: string
}

function stubAI(handler: (call: Call) => unknown) {
  const calls: Call[] = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const system = messages[0]!.content
    const call: Call = {
      kind: system.includes('You compare a study app') ? 'compare' : 'question',
      system,
      user: messages[1]!.content,
    }
    calls.push(call)
    return { data: await handler(call), raw: {} }
  })
  return {
    calls,
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

let db: AppDatabase
let setId: string

async function setup(): Promise<void> {
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
  const base = {
    projectId,
    setId,
    documentId: doc.id,
    documentName: 'hw.pdf',
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
  await repo.upsertQuestion({
    ...base,
    id: 'q1',
    order: 0,
    number: '2',
    prompt: 'Show W is a subspace. (a) Show it. (b) Find a basis.',
    answerStatus: 'matched',
    answerText: PROFESSOR_2,
  } as HomeworkQuestion)
  await repo.upsertQuestion({
    ...base,
    id: 'q2',
    order: 1,
    number: '3',
    prompt: 'A secret other question.',
  } as HomeworkQuestion)
}

const service = (ai: AIService | null) =>
  new HomeworkWalkthroughService({ ai, db, homework: new HomeworkService({ ai, db }) })

const writer = (call: Call) =>
  call.kind === 'compare'
    ? {
        items: [
          {
            label: '(a)',
            status: 'method_differs',
            note: 'Professor uses the RREF of the defining system.',
            professorQuote: 'any vector in W is of the form c3(−2,1,1,0)+c4(1,0,0,1)',
          },
          { label: '(b)', status: 'same', note: '' },
        ],
        recommendation: 'align',
        suggestion: 'Show (a) through the RREF of the defining system.',
      }
    : { status: 'ready', conclusion: 'W is a subspace.', body: `Work ${Math.random()}.` }

afterEach(() => {
  db?.close()
})

describe('HomeworkWalkthroughService with a professor answer', () => {
  it('writes with the alignment rules only for the question that has a professor answer', async () => {
    await setup()
    const { ai, calls } = stubAI(writer)
    await service(ai).generate(setId)
    const q1 = calls.find((call) => call.user.includes('question 2.'))!
    const q2 = calls.find((call) => call.user.includes('question 3.'))!
    expect(q1.system).toContain('graded against it')
    expect(q2.system).not.toContain('graded against it')
    const state = await service(null).state(setId)
    const s1 = state.plan.find((entry) => entry.id === 'q:q1')!.section!
    const s2 = state.plan.find((entry) => entry.id === 'q:q2')!.section!
    expect(s1.professorAligned?.answerHash).toBe(professorAnswerHash(PROFESSOR_2))
    expect(s2.professorAligned).toBeUndefined()
  })

  it('compares one section, sending only that question, and saves the checked report', async () => {
    await setup()
    const { ai, calls } = stubAI(writer)
    await service(ai).generate(setId)
    calls.length = 0
    const result = await service(ai).compareSection(setId, 'q:q1')
    expect(result.generated).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.kind).toBe('compare')
    expect(calls[0]!.user).not.toContain('A secret other question')
    const state = await service(null).state(setId)
    const section = state.plan.find((entry) => entry.id === 'q:q1')!.section!
    const report = currentCompare(section, PROFESSOR_2)!
    expect(report.recommendation).toBe('align')
    expect(report.items.map((item) => item.label)).toEqual(['a', 'b'])
    expect(report.items[0]!.professorQuote).toContain('c3(−2,1,1,0)')

    await service(null).dismissCompare(setId, 'q:q1')
    const after = (await service(null).state(setId)).plan.find((entry) => entry.id === 'q:q1')!
    expect(after.section!.professorCompare?.dismissed).toBe(true)
  })

  it('reports an unusable comparison without touching the section', async () => {
    await setup()
    const { ai } = stubAI((call) =>
      call.kind === 'compare'
        ? { items: [{ label: '(x)', status: 'same', note: '' }], suggestion: '' }
        : writer(call),
    )
    await service(ai).generate(setId)
    await expect(service(ai).compareSection(setId, 'q:q1')).rejects.toThrow(/sub-part labels/)
    const section = (await service(null).state(setId)).plan.find((e) => e.id === 'q:q1')!.section!
    expect(section.professorCompare).toBeUndefined()
  })

  it('compareAll takes only sections awaiting a comparison', async () => {
    await setup()
    const { ai, calls } = stubAI(writer)
    await service(ai).generate(setId)
    // Written under the alignment rules: nothing awaits a comparison yet.
    calls.length = 0
    expect((await service(ai).compareAll(setId)).generated).toBe(0)
    // An older section (written before the rules) does.
    const state = await service(null).state(setId)
    await new WalkthroughRepository(db).updateSection(
      walkthroughId(setId, state.language),
      'q:q1',
      (latest) => {
        const { professorAligned: _old, ...rest } = latest
        return rest
      },
    )
    expect((await service(ai).compareAll(setId)).generated).toBe(1)
    expect(calls.filter((call) => call.kind === 'compare')).toHaveLength(1)
  })

  it('按教授答案修改 rewrites with the suggestion, keeps the old version and drops the detailed one', async () => {
    await setup()
    const { ai, calls } = stubAI(writer)
    await service(ai).generate(setId)
    const state = await service(null).state(setId)
    const id = walkthroughId(setId, state.language)
    const before = state.plan.find((entry) => entry.id === 'q:q1')!.section!
    await new WalkthroughRepository(db).updateSection(id, 'q:q1', (latest) => ({
      ...latest,
      variants: {
        detailed: { body: 'Old detailed.', inputHash: latest.inputHash, generatedAt: 1 },
      },
    }))
    calls.length = 0
    await service(ai).regenerateSection(setId, 'q:q1', {
      suggestion: 'Show (a) through the RREF of the defining system.',
      align: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.system).toContain('graded against it')
    expect(calls[0]!.user).toContain('Show (a) through the RREF of the defining system.')
    const after = (await service(null).state(setId)).plan.find((e) => e.id === 'q:q1')!.section!
    expect(after.previous?.body).toBe(before.body)
    expect(after.variants).toBeUndefined()
    expect(after.professorAligned?.answerHash).toBe(professorAnswerHash(PROFESSOR_2))
  })
})
