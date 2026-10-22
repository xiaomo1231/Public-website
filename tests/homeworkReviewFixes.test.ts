import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import { HomeworkService } from '@/services/homeworkService'
import type { AIService } from '@/services/aiService'
import { gradeBlank, stepComplete } from '@/services/guidedGrading'
import { stepTextWithAnswers, stepTextWithGaps } from '@/entities/homework/guidedSteps'
import {
  applyOps,
  applyOpsOnRoute,
  parseTypedOps,
  type GuidedChain,
} from '@/entities/homework/guidedMatrix'
import { parseMatrix } from '@/infrastructure/math/rref'
import {
  mergeSectionWrite,
  planWalkthrough,
  questionSectionHash,
  frameSectionHash,
  type HomeworkWalkthrough,
  type WalkthroughSection,
} from '@/entities/homework/walkthrough'
import { verifyAiPart } from '@/entities/homework/practice/verify'
import type { HomeworkQuestion } from '@/entities/homework/types'

type StubHandler = (system: string, user: string) => unknown

function stubAI(handler: StubHandler): AIService {
  const respond = async (messages: Array<{ content: string }>) => ({
    data: await handler(messages[0]?.content ?? '', messages[1]?.content ?? ''),
    raw: {},
  })
  return {
    chatJSON: respond,
    streamJSON: respond,
    chat: async () => ({ content: 'hint' }),
  } as unknown as AIService
}

function questionsFromUser(user: string) {
  const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
  return {
    questions: ids.map((id, i) => ({
      number: String(i + 1),
      prompt: `Q ${id}.`,
      sourceChunkIds: [id],
    })),
  }
}

describe('guided blanks: unreadable student input', () => {
  it('is wrong, not a pass, when the reference can be read', () => {
    const number = gradeBlank({ id: '1', answer: '12', kind: 'number' }, 'abc')
    expect(number).toEqual({ verdict: 'wrong', reason: 'unreadable' })
    const expression = gradeBlank({ id: '1', answer: 'x^2/2', kind: 'expression' }, 'x^^2')
    expect(expression.verdict).toBe('wrong')
    expect(stepComplete([number])).toBe(false)
    const chem = gradeBlank({ id: '1', answer: '2H2 + O2 -> 2H2O', kind: 'chemistry' }, '???')
    expect(chem.verdict).toBe('wrong')
  })

  it('still grades readable answers', () => {
    expect(gradeBlank({ id: '1', answer: '12', kind: 'number' }, '12').verdict).toBe('correct')
    expect(gradeBlank({ id: '1', answer: 'x^2/2', kind: 'expression' }, 'x*x/2').verdict).toBe(
      'correct',
    )
  })
})

describe('guided blanks inside formulas', () => {
  const step = {
    text: "So $f'(x) = [[1]]$ and the area is [[2]].",
    explanation: '',
    blanks: [
      { id: '1', answer: '2x', kind: 'expression' as const },
      { id: '2', answer: '4', kind: 'number' as const },
    ],
  }
  it('uses LaTeX for a gap inside $…$ and Markdown outside', () => {
    const shown = stepTextWithGaps(step, (index, inMath) =>
      inMath ? `\\boxed{${index + 1}}` : `$\\boxed{${index + 1}}$`,
    )
    expect(shown).toBe("So $f'(x) = \\boxed{1}$ and the area is $\\boxed{2}$.")
    expect(stepTextWithAnswers(step)).toBe("So $f'(x) = {2x}$ and the area is **4**.")
  })
})

describe('guided matrix: operations meant one after another', () => {
  it('follows the walkthrough reading when the two readings differ', () => {
    const start = parseMatrix([
      [1, 1],
      [2, 3],
      [2, 2],
    ])!
    const ops = parseTypedOps('R2 -> R2 - 2R1, R3 -> R3 - R2')!
    const sequential = parseMatrix([
      [1, 1],
      [0, 1],
      [2, 1],
    ])!
    const chain: GuidedChain = {
      start,
      steps: [{ ops, mode: 'sequence', opLatex: '', result: sequential }],
      final: sequential,
    }
    expect(applyOps(start, ops)!.mode).toBe('together')
    const applied = applyOpsOnRoute(chain, start, ops)!
    expect(applied.mode).toBe('sequence')
    expect(applied.matrix.map((row) => row.map((v) => Number(v.n)))).toEqual([
      [1, 1],
      [0, 1],
      [2, 1],
    ])
  })
})

describe('walkthrough sections', () => {
  const base = (over: Partial<WalkthroughSection>): WalkthroughSection => ({
    id: 'q:q1',
    kind: 'question',
    title: 'q',
    body: 'text',
    status: 'ready',
    inputHash: 'h',
    generatedAt: 1,
    ...over,
  })

  it('an import keeps an unfinished generated draft as the alternate', () => {
    const partial = base({
      status: 'partial',
      body: '',
      draft: {
        mode: 'generate',
        inputHash: 'h',
        labels: ['a', 'b'],
        parts: [],
        startedAt: 1,
      } as unknown as WalkthroughSection['draft'],
    })
    const imported = base({ origin: 'imported', body: 'imported text' })
    const merged = mergeSectionWrite(partial, imported)
    expect(merged.origin).toBe('imported')
    expect(merged.alternate?.draft).toBeDefined()
  })

  it('marks the opening / summary out of date when a question became ready after them', () => {
    const question = (id: string, order: number): HomeworkQuestion =>
      ({
        id,
        projectId: 'p',
        setId: 's',
        documentId: 'd',
        documentName: 'd',
        order,
        prompt: `Prompt ${id}`,
        sourceRefs: [],
        hints: [],
        generationStatus: 'ready',
        promptVersion: 'v',
        draftText: '',
        revealedHints: 0,
        solutionRevealed: false,
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }) as HomeworkQuestion
    const questions = [question('q1', 0), question('q2', 1)]
    const hashes = questions.map((q) => questionSectionHash(q, 'zh_terms', 'v1'))
    const frame = frameSectionHash(
      questions.map((q) => questionSectionHash(q, 'zh_terms', 'v1', { align: false })),
      'zh_terms',
      'v1',
    )
    const stored = (builtFrom?: string[]): HomeworkWalkthrough => ({
      id: 's:zh_terms',
      projectId: 'p',
      setId: 's',
      language: 'zh_terms',
      createdAt: 1,
      updatedAt: 1,
      sections: [
        base({
          id: 'overview',
          kind: 'overview',
          inputHash: frame,
          ...(builtFrom ? { builtFrom } : {}),
        }),
        base({ id: 'q:q1', inputHash: hashes[0]! }),
        base({ id: 'q:q2', inputHash: hashes[1]! }),
        base({ id: 'summary', kind: 'summary', inputHash: frame }),
      ],
    })
    const missing = planWalkthrough(questions, stored(['q:q1']), 'zh_terms', 'v1')
    expect(missing.find((e) => e.id === 'overview')).toMatchObject({
      needsWork: true,
      outdated: true,
    })
    // Older sections without the record are never judged by it.
    expect(missing.find((e) => e.id === 'summary')!.needsWork).toBe(false)
    const complete = planWalkthrough(questions, stored(['q:q1', 'q:q2']), 'zh_terms', 'v1')
    expect(complete.find((e) => e.id === 'overview')!.needsWork).toBe(false)
  })
})

describe('AI practice questions', () => {
  it('shows the system the answer was computed from when the prompt differs', () => {
    const result = verifyAiPart(
      {
        prompt: 'Solve x + 2y = 7, 3x + 4y = 9.',
        answer: '',
        solution: '',
        check: {
          type: 'linear_system',
          augmented: [
            [1, 2, 5],
            [3, 4, 6],
          ],
        },
      } as never,
      undefined,
      'en',
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.part.prompt).not.toContain('= 7')
  })

  it('reads the number of an answer written in words', () => {
    const result = verifyAiPart(
      {
        prompt: 'How fast?',
        answer: 'The speed is 5 m/s',
        solution: '',
        check: { type: 'numeric', expression: '10/2' },
      } as never,
      undefined,
      'en',
    )
    expect(result.ok).toBe(true)
  })
})

describe('homework records', () => {
  let db: AppDatabase
  let homework: HomeworkRepository
  let projectId: string
  let documentId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    homework = new HomeworkRepository(db)
    projectId = (await new ProjectService(db).create({ name: 'Calc', subject: 'calculus' })).id
    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType: 'homework',
      name: 'HW.pdf',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    await new ChunkRepository(db).addMany([
      {
        documentId: doc.id,
        projectId,
        materialType: 'homework',
        pageNumber: 1,
        contentType: 'paragraph',
        text: 'Find the limit of x squared as x tends to three.',
        sourceReference: 'HW.pdf · Page 1',
        order: 0,
      },
    ])
    documentId = doc.id
  })

  const makeService = () =>
    new HomeworkService({
      db,
      ai: stubAI((system, user) =>
        system.includes('extract the individual questions')
          ? questionsFromUser(user)
          : { hints: ['fresh hint'], solution: 'fresh solution' },
      ),
    })

  it('a re-read also redoes help left pending by an interrupted run', async () => {
    const service = makeService()
    const set = await service.createFromDocument(documentId)
    const [question] = await homework.listQuestions(set.id)
    await homework.updateQuestion(question!.id, {
      generationStatus: 'pending',
      hints: [],
      solution: undefined,
    })
    await homework.updateSet(set.id, { status: 'paused', answerDocumentId: 'answers' })
    await service.retrySet(set.id)
    const after = await homework.getQuestion(question!.id)
    expect(after!.generationStatus).toBe('ready')
    expect(after!.solution).toBe('fresh solution')
    // A field set during the run (here: before it) is not reverted by the commit.
    expect((await homework.getSet(set.id))!.answerDocumentId).toBe('answers')
  })

  it('does not write help for a question text that changed meanwhile', async () => {
    const service = makeService()
    const set = await service.createFromDocument(documentId)
    const [question] = await homework.listQuestions(set.id)
    await homework.updateQuestion(question!.id, { answerBased: true, previousSolution: 'old' })
    expect(
      await homework.applyGeneratedContent(question!.id, ['h'], 's', 'v', 'another text'),
    ).toBeNull()
    const written = await homework.applyGeneratedContent(
      question!.id,
      ['h'],
      's',
      'v',
      question!.prompt,
    )
    expect(written!.answerBased).toBe(false)
    expect(written!.previousSolution).toBeUndefined()
  })

  it('removing a duplicate set also removes its walkthrough, and saved Q&A protects it', async () => {
    const service = makeService()
    const set = await service.createFromDocument(documentId)
    const now = Date.now()
    const duplicate = { ...set, id: crypto.randomUUID(), status: 'failed' as const, createdAt: 0 }
    await homework.upsertSet(duplicate)
    const walkthroughs = new WalkthroughRepository(db)
    await db.homeworkWalkthroughs.put({
      id: `${duplicate.id}:zh_terms`,
      projectId,
      setId: duplicate.id,
      language: 'zh_terms',
      sections: [],
      createdAt: now,
      updatedAt: now,
    })
    await homework.deleteSet(duplicate.id)
    expect(await db.homeworkWalkthroughs.get(`${duplicate.id}:zh_terms`)).toBeUndefined()

    // A duplicate with saved walkthrough Q&A is kept by the clean-up.
    const withNotes = { ...set, id: crypto.randomUUID(), status: 'failed' as const, createdAt: 0 }
    await homework.upsertSet(withNotes)
    await db.walkthroughNotes.put({
      id: crypto.randomUUID(),
      projectId,
      setId: withNotes.id,
      updatedAt: now,
    } as never)
    expect(await walkthroughs.countNotes(withNotes.id)).toBe(1)
    await service.reconcileSets(projectId)
    expect(await homework.getSet(withNotes.id)).toBeDefined()
  })
})
