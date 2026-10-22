import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DataManagementService } from '@/services/dataManagementService'
import { PracticeSetService } from '@/services/practiceSetService'
import {
  QuestionHabitsService,
  loadLinearStyleHints,
  loadProfessorHabits,
} from '@/services/questionHabitsService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { WalkthroughSection } from '@/entities/homework/walkthrough'
import {
  buildHabitsBlock,
  linearStyleHints,
  type QuestionHabitsProfile,
} from '@/entities/questionHabits/types'
import {
  labelUnits,
  mergeHabitsReply,
  planHabitSources,
  type HabitDocument,
} from '@/entities/questionHabits/update'
import {
  applyLinearHints,
  buildLinearSystem,
  eliminationFractions,
} from '@/entities/homework/practice/linearSystem'
import { createRng } from '@/entities/homework/practice/random'
import { matrixToLatex, parseMatrix, rref } from '@/infrastructure/math/rref'
import { prompts } from '@/infrastructure/ai/prompts'
import * as QuizV6 from '@/infrastructure/ai/prompts/quiz-generator/v6'
import * as QuizV7 from '@/infrastructure/ai/prompts/quiz-generator/v7'
import * as PracticeV1 from '@/infrastructure/ai/prompts/practice-generate/v1'
import * as OralV1 from '@/infrastructure/ai/prompts/oral-exam/v1'
import { professorStyleSection } from '@/infrastructure/ai/prompts/question-style/v1'
import type { AIService } from '@/services/aiService'

const HABITS = '- [structure] Three sub-parts (a)(b)(c) that build on each other'

function profileWith(partial: Partial<QuestionHabitsProfile> = {}): QuestionHabitsProfile {
  return {
    items: [
      {
        id: 'i1',
        category: 'structure',
        statement: 'Three sub-parts (a)(b)(c) that build on each other',
        evidence: [{ documentId: 'd1', quote: 'Solve the system' }],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    sources: [],
    updatedAt: 1,
    ...partial,
  }
}

describe('merging an AI reply into the profile', () => {
  const batch: HabitDocument[] = [
    {
      documentId: 'd1',
      documentName: 'hw1.pdf',
      kind: 'homework',
      hash: 'h1',
      units: [
        {
          documentId: 'd1',
          documentName: 'hw1.pdf',
          kind: 'homework',
          questionId: 'q1',
          setId: 's1',
          text: 'Solve the  system and, if a solution exists, write it down.',
        },
        {
          documentId: 'd1',
          documentName: 'hw1.pdf',
          kind: 'homework',
          questionId: 'q2',
          setId: 's1',
          text: 'Prove that A is invertible.',
        },
      ],
    },
  ]
  const units = labelUnits(batch)
  let n = 0
  const base = {
    units,
    batch,
    now: 5,
    newId: () => `new${++n}`,
    promptVersion: 'question-style/v1',
  }

  it('drops items whose quotes cannot be found in the questions sent', () => {
    const result = mergeHabitsReply({
      ...base,
      profile: { items: [], sources: [], updatedAt: 0 },
      shortIds: new Map(),
      reply: {
        items: [
          {
            id: null,
            category: 'answer_format',
            statement: 'Asks to write the solution down when one exists',
            // Different spacing / case still counts; the unit label is wrong.
            evidence: [{ unit: 'U2', quote: 'SOLVE THE SYSTEM and, if a solution exists' }],
          },
          {
            id: null,
            category: 'traps',
            statement: 'Invented habit',
            evidence: [{ unit: 'U1', quote: 'Find the determinant of B' }],
          },
          { id: null, category: 'wording', statement: 'No evidence at all', evidence: [] },
          {
            id: null,
            category: 'not-a-category',
            statement: 'Bad category',
            evidence: [{ unit: 'U2', quote: 'Prove that A is invertible' }],
          },
        ],
        remove: [],
      },
    })
    expect(result.added).toBe(1)
    expect(result.dropped).toBe(3)
    expect(result.profile.items).toHaveLength(1)
    expect(result.profile.items[0]!.evidence[0]).toMatchObject({
      documentId: 'd1',
      questionId: 'q1',
      setId: 's1',
      kind: 'homework',
    })
    expect(result.profile.sources).toEqual([
      { documentId: 'd1', kind: 'homework', hash: 'h1', analyzedAt: 5 },
    ])
  })

  it('never changes or removes the student’s items', () => {
    const profile = profileWith({
      items: [
        { ...profileWith().items[0]!, id: 'mine', userEdited: true },
        { ...profileWith().items[0]!, id: 'ai', statement: 'Old AI statement' },
      ],
    })
    const result = mergeHabitsReply({
      ...base,
      profile,
      shortIds: new Map([
        ['h1', 'mine'],
        ['h2', 'ai'],
      ]),
      reply: {
        items: [
          {
            id: 'h1',
            category: 'traps',
            statement: 'Rewritten',
            evidence: [{ unit: 'U1', quote: 'Solve the system' }],
          },
          {
            id: 'h2',
            category: 'structure',
            statement: 'Refined AI statement',
            evidence: [{ unit: 'U2', quote: 'Prove that A is invertible' }],
          },
        ],
        remove: ['h1'],
      },
    })
    const mine = result.profile.items.find((item) => item.id === 'mine')!
    expect(mine.statement).toBe('Three sub-parts (a)(b)(c) that build on each other')
    expect(mine.category).toBe('structure')
    const ai = result.profile.items.find((item) => item.id === 'ai')!
    expect(ai.statement).toBe('Refined AI statement')
    expect(ai.evidence.map((each) => each.quote)).toEqual([
      'Prove that A is invertible',
      'Solve the system',
    ])
  })

  it('plans only new / changed documents and reports removed ones', () => {
    const docs: HabitDocument[] = [
      { ...batch[0]!, hash: 'same' },
      { ...batch[0]!, documentId: 'd2', hash: 'new' },
    ]
    const plan = planHabitSources(
      profileWith({
        sources: [
          { documentId: 'd1', kind: 'homework', hash: 'same', analyzedAt: 1 },
          { documentId: 'gone', kind: 'homework', hash: 'x', analyzedAt: 1 },
        ],
      }),
      docs,
    )
    expect(plan.changed.map((doc) => doc.documentId)).toEqual(['d2'])
    expect(plan.removed).toEqual(['gone'])
  })
})

describe('the professor-style block in question prompts', () => {
  it('quiz-generator stays v6 word for word without it and adds it before the closing line', () => {
    const input = {
      topicName: 'Linear systems',
      topicDescription: 'Gaussian elimination',
      knowledgePoints: ['RREF'],
      plan: [{ type: 'numeric' as const, difficulty: 'intermediate' as const }],
      language: 'en' as const,
      sourceSnippets: ['[chunk:c1] text'],
    }
    const plain = QuizV7.buildUserPrompt(input)
    expect(plain).toBe(QuizV6.buildUserPrompt(input))
    expect(plain).not.toContain('PROFESSOR HABITS')
    const styled = QuizV7.buildUserPrompt({ ...input, professorHabits: HABITS })
    expect(styled).toBe(
      plain.replace(
        /\nRespond with the JSON object only\.$/,
        `\n${professorStyleSection(HABITS)}\nRespond with the JSON object only.`,
      ),
    )
  })

  it('practice-generate and oral-exam only add the block when given', () => {
    const practice = {
      language: 'zh' as const,
      keyPoints: '- 主元',
      slots: [{ id: 's1', mode: 'compact' as const, partLabels: [], knowledgePoints: ['主元'] }],
    }
    const plainPractice = PracticeV1.buildUserPrompt(practice)
    expect(plainPractice).not.toContain('PROFESSOR')
    expect(PracticeV1.buildUserPrompt({ ...practice, professorHabits: HABITS })).toBe(
      `${plainPractice}\n\n${professorStyleSection(HABITS)}`,
    )

    const oral = {
      topic: 'Shoulder joint',
      courseTopics: [],
      knowledgePoints: [],
      sourceSnippets: [],
      language: 'en' as const,
    }
    const plainOral = OralV1.buildUserPrompt(oral)
    expect(plainOral).not.toContain('PROFESSOR')
    expect(OralV1.buildUserPrompt({ ...oral, professorHabits: HABITS })).toBe(
      plainOral.replace(
        '\nRespond with the JSON object only.',
        `\n${professorStyleSection(HABITS)}\nRespond with the JSON object only.`,
      ),
    )
  })

  it('practice-generate v2 and oral-exam v2 put the block before the per-request content', () => {
    const practice = {
      language: 'zh' as const,
      keyPoints: '- 主元',
      slots: [{ id: 's1', mode: 'compact' as const, partLabels: [], knowledgePoints: ['主元'] }],
    }
    expect(prompts.practiceGenerate.VERSION).toBe('v3')
    expect(prompts.practiceGenerate.buildUserPrompt(practice)).toBe(
      PracticeV1.buildUserPrompt(practice),
    )
    const styled = prompts.practiceGenerate.buildUserPrompt({
      ...practice,
      professorHabits: HABITS,
    })
    expect(styled.indexOf('END KNOWLEDGE POINTS')).toBeLessThan(styled.indexOf('PROFESSOR HABITS'))
    expect(styled.indexOf('PROFESSOR HABITS')).toBeLessThan(styled.indexOf('SLOT s1'))
    expect(styled.length).toBe(
      PracticeV1.buildUserPrompt({ ...practice, professorHabits: HABITS }).length,
    )

    const oral = {
      topic: 'Shoulder joint',
      courseTopics: [],
      knowledgePoints: [],
      sourceSnippets: [],
      language: 'en' as const,
    }
    expect(prompts.oralExam.VERSION).toBe('v2')
    expect(prompts.oralExam.buildUserPrompt(oral)).toBe(OralV1.buildUserPrompt(oral))
    const oralStyled = prompts.oralExam.buildUserPrompt({ ...oral, professorHabits: HABITS })
    expect(oralStyled.startsWith(`Write the question`)).toBe(true)
    expect(oralStyled.indexOf('PROFESSOR HABITS')).toBeLessThan(oralStyled.indexOf('DRAWN TOPIC'))
    expect(oralStyled.endsWith('Respond with the JSON object only.')).toBe(true)
  })

  it('the block is empty when the profile is off or has no items', () => {
    expect(buildHabitsBlock(profileWith())).toContain('[structure] Three sub-parts')
    expect(buildHabitsBlock(profileWith({ enabled: false }))).toBeUndefined()
    expect(buildHabitsBlock(profileWith({ items: [] }))).toBeUndefined()
    expect(buildHabitsBlock(undefined)).toBeUndefined()
  })

  it('puts the best-evidenced items first and stays within the budget', () => {
    const many = profileWith({
      items: Array.from({ length: 30 }, (_, i) => ({
        id: `i${i}`,
        category: 'wording' as const,
        statement: `Habit number ${i} `.padEnd(150, 'x'),
        evidence: Array.from({ length: i % 4 }, () => ({ documentId: 'd', quote: 'q' })),
        createdAt: 1,
        updatedAt: 1,
      })),
    })
    const block = buildHabitsBlock(many)!
    expect(block.length).toBeLessThanOrEqual(1_800)
    expect(block.split('\n')[0]).toContain('Habit number 3 ')
  })
})

describe('linear-system hints', () => {
  it('reads sizes, integers and presentation from the items', () => {
    const hints = linearStyleHints(
      profileWith({
        items: [
          {
            ...profileWith().items[0]!,
            category: 'numbers',
            statement: 'Uses 3×4 augmented matrices with small integers only',
          },
        ],
      }),
    )
    expect(hints).toEqual({
      rows: { min: 3, max: 3 },
      vars: { min: 3, max: 3 },
      integerOnly: true,
      presentation: 'matrix',
    })
    expect(linearStyleHints(undefined)).toEqual({})
  })

  it('the constructor respects the size hint and the integer-only hint', () => {
    const spec = applyLinearHints(
      { rows: 3, vars: 3, solution: 'unique', free: 0 },
      { rows: { min: 4, max: 4 }, vars: { min: 4, max: 4 } },
    )
    expect(spec).toMatchObject({ rows: 4, vars: 4 })
    // No hints: unchanged.
    expect(applyLinearHints({ rows: 3, vars: 4, solution: 'infinite', free: 1 }, {})).toEqual({
      rows: 3,
      vars: 4,
      solution: 'infinite',
      free: 1,
    })
    for (let seed = 0; seed < 10; seed += 1) {
      const built = buildLinearSystem(spec, createRng(`hint:${seed}`), { maxFractions: 0 })!
      expect(built.augmented).toHaveLength(4)
      expect(built.augmented[0]).toHaveLength(5)
      expect(eliminationFractions(built.augmented)).toBe(0)
    }
  })
})

// --- Services ---------------------------------------------------------------------

let db: AppDatabase
let projectId: string
let documentId: string
let parentId: string
let repo: HomeworkRepository

function question(partial: Partial<HomeworkQuestion>): HomeworkQuestion {
  return {
    id: crypto.randomUUID(),
    projectId,
    setId: parentId,
    documentId,
    documentName: 'hw1.pdf',
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

async function addAssignment(
  name: string,
  prompts: string[],
): Promise<{ doc: string; set: string }> {
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId,
    type: 'text',
    materialType: 'homework',
    name,
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  const setId = crypto.randomUUID()
  const set: HomeworkSet = {
    id: setId,
    projectId,
    documentId: doc.id,
    documentName: name,
    title: name,
    status: 'ready',
    language: 'zh',
    questionCount: prompts.length,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  }
  await repo.upsertSet(set)
  for (const [index, prompt] of prompts.entries()) {
    await repo.upsertQuestion(
      question({
        id: `${setId}-q${index + 1}`,
        setId,
        documentId: doc.id,
        documentName: name,
        order: index,
        number: String(index + 1),
        prompt,
      }),
    )
  }
  return { doc: doc.id, set: setId }
}

function stubStyleAI(reply: (user: string) => unknown) {
  const calls: string[] = []
  const chatJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const user = messages[1]!.content
    calls.push(user)
    return { data: reply(user), raw: {} }
  })
  return {
    calls,
    ai: { chatJSON, streamJSON: chatJSON, maxOutputTokens: 4096 } as unknown as AIService,
  }
}

afterEach(() => {
  db.close()
})

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  projectId = (
    await new ProjectService(db).create({ name: 'Linear algebra', subject: 'linear_algebra' })
  ).id
  repo = new HomeworkRepository(db)
  const first = await addAssignment('hw1.pdf', [
    '求解下列增广矩阵对应的方程组，若有解，写出全部解：(a) [1 1 | 2; 2 2 | 5] (b) [1 1 | 3; 1 -1 | 1] (c) [1 2 1 | 4; 2 4 3 | 9]',
    '证明：若 A 可逆，则 Ax = 0 只有零解。',
  ])
  documentId = first.doc
  parentId = first.set
})

describe('QuestionHabitsService', () => {
  const firstReply = () => ({
    items: [
      {
        id: null,
        category: 'answer_format',
        statement: '有解时要求写出全部解',
        evidence: [{ unit: 'U1', quote: '若有解，写出全部解' }],
      },
      {
        id: null,
        category: 'traps',
        statement: 'Made up',
        evidence: [{ unit: 'U2', quote: 'this text is not in any question' }],
      },
    ],
    remove: [],
  })

  it('stores only items with verifiable evidence, then sends only new documents', async () => {
    const { ai, calls } = stubStyleAI(firstReply)
    const service = new QuestionHabitsService({ ai, db })
    const result = await service.analyze(projectId)
    expect(result).toMatchObject({ paused: false, total: 1, added: 1, dropped: 1 })
    const profile = await service.get(projectId)
    expect(profile!.items.map((item) => item.statement)).toEqual(['有解时要求写出全部解'])
    expect(profile!.items[0]!.evidence[0]).toMatchObject({ documentId, setId: parentId })

    // Nothing new: no request.
    expect((await service.analyze(projectId)).total).toBe(0)
    expect(calls).toHaveLength(1)

    // The student edits the item; a new assignment arrives.
    await service.updateItem(projectId, profile!.items[0]!.id, { statement: '我的版本' })
    await addAssignment('hw2.pdf', ['Compute the determinant of the 3×3 matrix B.'])
    expect((await service.status(projectId)).pending.map((doc) => doc.documentName)).toEqual([
      'hw2.pdf',
    ])
    const second = stubStyleAI((user) => ({
      items: [
        {
          id: 'h1',
          category: 'traps',
          statement: 'AI tries to rewrite the student item',
          evidence: [{ unit: 'U1', quote: 'Compute the determinant' }],
        },
        {
          id: null,
          category: 'numbers',
          statement: 'Uses 3×3 matrices',
          evidence: [{ unit: 'U1', quote: 'the 3×3 matrix B' }],
        },
      ],
      remove: user.includes('h1 [locked]') ? ['h1'] : [],
    }))
    const update = await new QuestionHabitsService({ ai: second.ai, db }).analyze(projectId)
    expect(update).toMatchObject({ total: 1, added: 1 })
    expect(second.calls).toHaveLength(1)
    expect(second.calls[0]).toContain('Compute the determinant')
    expect(second.calls[0]).not.toContain('证明：若 A 可逆')
    expect(second.calls[0]).toContain('h1 [locked]')
    const after = await service.get(projectId)
    expect(after!.items.map((item) => item.statement)).toEqual(['我的版本', 'Uses 3×3 matrices'])
    expect(after!.items[0]!.category).toBe('answer_format')
    expect(after!.sources).toHaveLength(2)
  })

  it('a stored profile survives writes of the derived course context', async () => {
    const service = new QuestionHabitsService({ db })
    await service.addItem(projectId, { category: 'wording', statement: 'Uses “Show that”' })
    const contexts = new CourseContextRepository(db)
    const stale = (await contexts.get(projectId))!
    const { questionHabits: _drop, ...withoutHabits } = stale
    void _drop
    await contexts.upsert({ ...withoutHabits, sourceHash: 'changed' })
    expect((await service.get(projectId))!.items).toHaveLength(1)
  })

  it('the 「模仿教授出题」 switch removes the block and the hints', async () => {
    const service = new QuestionHabitsService({ db })
    await service.addItem(projectId, {
      category: 'numbers',
      statement: 'Systems are 4×4, integers only',
    })
    expect(await loadProfessorHabits(projectId, db)).toContain('Systems are 4×4')
    expect(await loadLinearStyleHints(projectId, db)).toMatchObject({ integerOnly: true })
    await service.setEnabled(projectId, false)
    expect(await loadProfessorHabits(projectId, db)).toBeUndefined()
    expect(await loadLinearStyleHints(projectId, db)).toEqual({})
  })

  it('is exported, restored and deleted with the course', async () => {
    const service = new QuestionHabitsService({ db })
    await service.addItem(projectId, { category: 'traps', statement: 'Likes inconsistent systems' })
    const data = new DataManagementService(db)
    const file = await data.exportFile()
    await data.deleteProject(projectId)
    expect(await db.courseContexts.get(projectId)).toBeUndefined()
    await data.restoreFromFile(file)
    expect((await service.get(projectId))!.items.map((item) => item.statement)).toEqual([
      'Likes inconsistent systems',
    ])
  })
})

// --- Practice sets follow the profile -----------------------------------------------

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

function check(label: string, rows: string[][], kind: 'none' | 'unique' | 'infinite') {
  return {
    label,
    rrefMatches: true,
    kindMatches: true,
    computedKind: kind,
    computedRref: matrixToLatex(rref(parseMatrix(rows)!)),
  }
}

describe('practice sets with the profile', () => {
  beforeEach(async () => {
    await db.homeworkWalkthroughs.put({
      id: `${parentId}:zh_terms`,
      projectId,
      setId: parentId,
      language: 'zh_terms',
      sections: [
        section({
          id: `q:${parentId}-q1`,
          questionId: `${parentId}-q1`,
          checks: [
            check(
              '(a)',
              [
                ['1', '1', '2'],
                ['2', '2', '5'],
              ],
              'none',
            ),
            check(
              '(b)',
              [
                ['1', '1', '3'],
                ['1', '-1', '1'],
              ],
              'unique',
            ),
            check(
              '(c)',
              [
                ['1', '2', '1', '4'],
                ['2', '4', '3', '9'],
              ],
              'infinite',
            ),
          ],
        }),
        section({ id: `q:${parentId}-q2`, questionId: `${parentId}-q2` }),
        section({ id: 'summary', kind: 'summary', body: SUMMARY }),
      ],
      createdAt: 1,
      updatedAt: 1,
    })
  })

  function practiceAI() {
    const users: string[] = []
    const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
      const system = messages[0]!.content
      const user = messages[1]!.content
      users.push(user)
      if (system.includes('You review NEW practice questions')) {
        const ids = [...user.matchAll(/\[(p\d+)\] mode/g)].map((match) => match[1]!)
        return { data: { results: ids.map((id) => ({ id, pass: true, reason: 'ok' })) }, raw: {} }
      }
      const slots = [...user.matchAll(/SLOT (s\d+)/g)].map((match) => match[1]!)
      return {
        data: {
          questions: slots.map((slot) => ({
            slot,
            stem: '',
            parts: [
              {
                prompt: '证明：若 B 可逆，则 Bx = 0 只有零解。',
                answer: '只有零解',
                solution: '左乘逆。',
                check: null,
              },
            ],
          })),
        },
        raw: {},
      }
    })
    return {
      users,
      ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
    }
  }

  it('sends the block to the AI and sizes local systems by the hint; off restores the default', async () => {
    const habits = new QuestionHabitsService({ db })
    await habits.addItem(projectId, {
      category: 'numbers',
      statement: 'Linear systems are 4×4 (four equations, four unknowns)',
    })
    const on = practiceAI()
    const full = await new PracticeSetService({ ai: on.ai, db }).create(parentId, 'full')
    expect(full.created).toBeGreaterThan(0)
    expect(on.users[0]).toContain('PROFESSOR HABITS')
    expect(on.users[0]).toContain('Linear systems are 4×4')

    const compact = await new PracticeSetService({ ai: on.ai, db }).create(parentId, 'compact')
    const local = (await repo.listQuestions(compact.set.id)).filter(
      (q) => q.practice?.origin === 'local',
    )
    expect(local.length).toBeGreaterThan(0)
    for (const q of local)
      for (const part of q.practice!.parts) {
        if (part.grader.kind !== 'linear_system') continue
        expect(part.grader.augmented).toHaveLength(4)
        expect(part.grader.augmented[0]).toHaveLength(5)
      }

    await habits.setEnabled(projectId, false)
    const off = practiceAI()
    await new PracticeSetService({ ai: off.ai, db }).create(parentId, 'full')
    expect(off.users[0]).not.toContain('PROFESSOR HABITS')
  })
})
