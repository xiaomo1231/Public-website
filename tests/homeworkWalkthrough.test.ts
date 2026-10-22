import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import { WalkthroughNoteService, cardBack } from '@/services/walkthroughNoteService'
import { DataManagementService } from '@/services/dataManagementService'
import { DocumentService } from '@/services/documentService'
import { ReviewCardService } from '@/services/reviewCardService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import { prompts } from '@/infrastructure/ai/prompts'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'

const P1 =
  'Consider the system x1 + 2x2 + 3x3 + 4x4 = 10, 2x1 + 3x2 + 5x3 + 6x4 = 14, 3x1 + 4x2 + 6x3 + 8x4 = 18. Using the augmented matrix and RREF, solve it.'
const P2 = 'Solve the system with augmented matrix [0 1 | 2; 2 0 | 1].'

type Handler = (system: string, user: string) => unknown

function stubAI(handler: Handler) {
  const calls: Array<{ system: string; user: string }> = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const system = messages[0]!.content
    const user = messages[1]!.content
    calls.push({ system, user })
    return { data: await handler(system, user), raw: {} }
  })
  return {
    calls,
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

const isFrame = (system: string) => system.includes('opening and the closing')

/** A model that writes every section, with an arithmetic slip in question 2. */
const goodModel: Handler = (system, user) => {
  if (isFrame(system)) {
    return {
      status: 'ready',
      overview: '### Row operations\n1. Swap two rows.',
      summary: '| Result | Questions |\n|---|---|\n| unique | 2 |',
      suggestions: ['Redo 1: a free variable.'],
    }
  }
  if (user.includes('question 1.')) {
    return {
      status: 'ready',
      conclusion: 'Infinitely many solutions.',
      body: 'Start from $$\\left[\\begin{array}{cccc|c} 1&2&3&4&10 \\end{array}\\right]$$ and do $R_2 \\to R_2 - 2R_1$.',
      linearSystems: [
        {
          label: '1',
          augmented: [
            [1, 2, 3, 4, 10],
            [2, 3, 5, 6, 14],
            [3, 4, 6, 8, 18],
          ],
          rref: [
            [1, 0, 0, 0, -2],
            [0, 1, 0, 2, 6],
            [0, 0, 1, 0, 0],
          ],
          solution: 'infinite',
        },
      ],
    }
  }
  return {
    status: 'ready',
    conclusion: 'Unique solution.',
    body: 'Swap the rows.',
    linearSystems: [
      {
        label: '2',
        augmented: [
          [0, 1, 2],
          [2, 0, 1],
        ],
        rref: [
          [1, 0, '1/3'],
          [0, 1, 2],
        ],
        solution: 'unique',
      },
    ],
  }
}

let db: AppDatabase
let projectId: string
let setId: string
let documentId: string
let repo: HomeworkRepository

function question(partial: Partial<HomeworkQuestion>): HomeworkQuestion {
  return {
    id: crypto.randomUUID(),
    projectId,
    setId,
    documentId,
    documentName: 'hw3.pdf',
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
    name: 'hw3.pdf',
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  documentId = doc.id
  repo = new HomeworkRepository(db)
  setId = crypto.randomUUID()
  const set: HomeworkSet = {
    id: setId,
    projectId,
    documentId,
    documentName: 'hw3.pdf',
    title: 'HW3',
    status: 'ready',
    language: 'en',
    questionCount: 2,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  }
  await repo.upsertSet(set)
  await repo.upsertQuestion(question({ id: 'q1', order: 0, number: '1', prompt: P1 }))
  await repo.upsertQuestion(question({ id: 'q2', order: 1, number: '2', prompt: P2 }))
})

const service = (ai: AIService | null) =>
  new HomeworkWalkthroughService({ ai, db, homework: new HomeworkService({ ai, db }) })

describe('writing the walkthrough', () => {
  it('writes each question, then the opening and summary, and checks the row reduction', async () => {
    const { ai, calls } = stubAI(goodModel)
    const result = await service(ai).generate(setId)
    expect(result).toEqual({ generated: 4, failed: 0 })
    // One request per question, then one for the opening and one for the summary.
    expect(calls).toHaveLength(4)
    expect(isFrame(calls[2]!.system)).toBe(true)
    expect(calls[2]!.system).toContain('ONLY the opening')
    expect(calls[3]!.system).toContain('ONLY the closing summary')
    expect(calls[2]!.user).toContain('Infinitely many solutions.')
    // Default language: Chinese with English terms; linear-algebra rules included.
    expect(calls[0]!.user).toContain('主元（pivot）')
    expect(calls[0]!.system).toContain('"linearSystems"')

    const state = await service(null).state(setId)
    expect(state.plan.map((entry) => [entry.id, entry.section?.status, entry.needsWork])).toEqual([
      ['overview', 'ready', false],
      ['q:q1', 'ready', false],
      ['q:q2', 'ready', false],
      ['summary', 'ready', false],
    ])
    const q1 = state.plan[1]!.section!
    expect(q1).toMatchObject({ conclusion: 'Infinitely many solutions.', title: '1' })
    expect(q1.checks).toEqual([
      expect.objectContaining({ label: '1', rrefMatches: true, kindMatches: true }),
    ])
    // The slip in question 2 is caught locally.
    expect(state.plan[2]!.section!.checks).toEqual([
      expect.objectContaining({ label: '2', rrefMatches: false, computedKind: 'unique' }),
    ])
    expect(state.plan[3]!.section).toMatchObject({ suggestions: ['Redo 1: a free variable.'] })
  })

  it('does nothing when everything is current, and redoes only a changed question with the frame', async () => {
    const { ai, calls } = stubAI(goodModel)
    await service(ai).generate(setId)
    calls.length = 0
    expect(await service(ai).generate(setId)).toEqual({ generated: 0, failed: 0 })
    expect(calls).toHaveLength(0)

    await repo.updateQuestion('q2', { prompt: `${P2} Show every step.` })
    const state = await service(null).state(setId)
    expect(state.plan.filter((entry) => entry.outdated).map((entry) => entry.id)).toEqual([
      'overview',
      'q:q2',
      'summary',
    ])
    await service(ai).generate(setId)
    expect(
      calls.map((call) =>
        isFrame(call.system) ? 'frame' : call.user.includes('question 2.') ? 'q2' : 'q1',
      ),
    ).toEqual(['q2', 'frame', 'frame'])
  })

  it('keeps a finished section when rewriting it fails, and records sections the model cannot write', async () => {
    const first = stubAI(goodModel)
    await service(first.ai).generate(setId)
    await repo.updateQuestion('q1', { prompt: `${P1} Also verify.` })
    const { ai } = stubAI((system, user) => {
      if (isFrame(system)) return goodModel(system, user)
      throw new Error('provider exploded')
    })
    const result = await service(ai).generate(setId)
    expect(result.failed).toBe(1)
    const state = await service(null).state(setId)
    const q1 = state.plan.find((entry) => entry.id === 'q:q1')!
    expect(q1.section?.status).toBe('ready')
    expect(q1.outdated).toBe(true)

    const { ai: unsure } = stubAI((system, user) =>
      isFrame(system)
        ? goodModel(system, user)
        : { status: 'insufficient', reason: 'The matrix in question 1 is unreadable.' },
    )
    await service(unsure).generate(setId, { force: true })
    const after = await service(null).state(setId)
    expect(after.plan.find((entry) => entry.id === 'q:q1')!.section).toMatchObject({
      status: 'insufficient',
      error: 'The matrix in question 1 is unreadable.',
    })
  })

  it('uses the confirmed professor answer and never asks without an AI', async () => {
    await repo.updateQuestion('q1', {
      answerStatus: 'matched',
      answerText: 'x1 = -2, x2 = 6 - 2t, x3 = 0, x4 = t',
    })
    const { ai, calls } = stubAI(goodModel)
    await service(ai).generate(setId)
    expect(calls.find((call) => call.user.includes('question 1.'))!.user).toContain(
      'CONFIRMED PROFESSOR ANSWER',
    )
    await expect(service(null).generate(setId, { force: true })).rejects.toMatchObject({
      code: 'NO_PROVIDER',
    })
  })

  it('leaves out retired questions and treats "not enough information" as settled', async () => {
    await repo.updateQuestion('q2', { retired: true, retiredAt: 5 })
    const { ai, calls } = stubAI((system, user) =>
      isFrame(system)
        ? goodModel(system, user)
        : { status: 'insufficient', reason: 'The matrix is unreadable.' },
    )
    await service(ai).generate(setId)
    expect(calls.some((call) => call.user.includes('question 2.'))).toBe(false)
    const state = await service(null).state(setId)
    expect(state.plan.map((entry) => entry.id)).toEqual(['overview', 'q:q1', 'summary'])
    // Unchanged inputs: nothing to redo, no more requests.
    expect(state.plan.find((entry) => entry.id === 'q:q1')!.needsWork).toBe(false)
    calls.length = 0
    await service(ai).generate(setId)
    expect(calls).toHaveLength(0)
  })

  it('stops and writes nothing once the assignment is deleted mid-run', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { ai, calls } = stubAI(async (system, user) => {
      await gate
      return goodModel(system, user)
    })
    const run = service(ai).generate(setId)
    await new HomeworkService({ ai: null, db }).deleteAssignment(setId, projectId)
    release()
    await run
    expect(await db.homeworkWalkthroughs.count()).toBe(0)
    // The two questions already in flight finish; the frame is never asked for.
    expect(calls.some((call) => isFrame(call.system))).toBe(false)
  })

  it('shares one run between callers', async () => {
    const { ai, calls } = stubAI(goodModel)
    const svc = service(ai)
    const [a, b] = await Promise.all([svc.generate(setId), service(ai).generate(setId)])
    expect(a).toEqual(b)
    expect(calls).toHaveLength(4)
  })
})

describe('saved questions', () => {
  const anchor = { text: 'R_2 \\to R_2 - 2R_1', prefix: 'and do ', suffix: '.' }
  const input = () => ({
    setId,
    sectionId: 'q:q1',
    sectionTitle: 'Question 1',
    quote: 'R2 → R2 − 2R1',
    anchor,
    surrounding: 'Start from the matrix and do R2 → R2 − 2R1.',
    turns: [
      { question: 'Why subtract twice row 1?', answer: 'To clear the 2 below the pivot.', at: 10 },
    ],
  })

  it('saves, continues, renames and deletes a note', async () => {
    const notes = new WalkthroughNoteService(db)
    const note = await notes.create(input(), 100)
    expect(note).toMatchObject({
      projectId,
      title: 'Why subtract twice row 1?',
      turns: [expect.anything()],
    })
    await notes.appendTurn(note.id, {
      question: 'And row 3?',
      answer: 'Subtract three times row 1.',
      at: 200,
    })
    await notes.rename(note.id, '  Clearing column 1  ')
    await notes.saveRect(note.id, { x: 10, y: 20, width: 400, height: 300 })
    const [stored] = await notes.list(setId)
    expect(stored).toMatchObject({
      title: 'Clearing column 1',
      updatedAt: expect.any(Number),
      rect: { x: 10 },
    })
    expect(stored!.turns.map((turn) => turn.question)).toEqual([
      'Why subtract twice row 1?',
      'And row 3?',
    ])
    await expect(notes.rename(note.id, '   ')).rejects.toThrow()
    await expect(notes.create({ ...input(), turns: [] })).rejects.toThrow()
    await notes.delete(note.id)
    expect(await notes.list(setId)).toEqual([])
  })

  it('turns a note into review cards without duplicates', async () => {
    const notes = new WalkthroughNoteService(db)
    const note = await notes.create(input())
    expect(await notes.addToReviewCards(note.id)).toBe(1)
    expect(await notes.addToReviewCards(note.id)).toBe(0)
    const [card] = await new ReviewCardService(db).list(projectId)
    expect(card).toMatchObject({
      front: 'Why subtract twice row 1?',
      back: 'To clear the 2 below the pivot.',
      source: 'note',
    })
    const long = `${'a'.repeat(900)}\n\n${'b'.repeat(900)}`
    expect(cardBack(long)).toBe(`${'a'.repeat(900)}\n\n…`)
  })

  it('protects a homework file that has saved questions, and goes with its assignment and course', async () => {
    const { ai } = stubAI(goodModel)
    await service(ai).generate(setId)
    const docs = new DocumentService({
      documents: new DocumentRepository(db),
      projects: new ProjectService(db),
      db,
    })
    // The generated walkthrough alone is not student work; a saved question is.
    expect((await docs.getDeleteImpact(documentId)).blocked).toBe(false)
    await new WalkthroughNoteService(db).create(input())
    expect((await docs.getDeleteImpact(documentId)).blocked).toBe(true)
    await expect(docs.delete(documentId)).rejects.toMatchObject({ code: 'FILE_IN_USE' })

    await new HomeworkService({ ai: null, db }).deleteAssignment(setId, projectId)
    const walkthroughs = new WalkthroughRepository(db)
    expect(await walkthroughs.listNotes(setId)).toEqual([])
    expect(await db.homeworkWalkthroughs.count()).toBe(0)
  })

  it('is removed with the project and included in the export', async () => {
    const { ai } = stubAI(goodModel)
    await service(ai).generate(setId)
    await new WalkthroughNoteService(db).create(input())
    const exported = await new DataManagementService(db).exportAll()
    expect((exported.json.homeworkWalkthroughs as unknown[]).length).toBe(1)
    expect((exported.json.walkthroughNotes as unknown[]).length).toBe(1)
    await new DataManagementService(db).deleteProject(projectId)
    expect(await db.homeworkWalkthroughs.count()).toBe(0)
    expect(await db.walkthroughNotes.count()).toBe(0)
  })
})

describe('contextual tutor prompt v3', () => {
  it('asks the same as before outside a walkthrough, and adds the walkthrough rule and history', () => {
    expect(prompts.contextualTutor.buildSystemPrompt('homework')).toContain(
      'do not reveal the final answer',
    )
    const walkthrough = prompts.contextualTutor.buildSystemPrompt('walkthrough')
    expect(walkthrough).toContain('solution is already in front of them')
    expect(walkthrough).not.toContain('do not reveal')
    const base = {
      selectedText: 'R2 → R2 − 2R1',
      surroundingContext: '',
      question: 'Why?',
      language: 'en',
    }
    expect(prompts.contextualTutor.buildUserPrompt(base)).not.toContain(
      'EARLIER IN THIS CONVERSATION',
    )
    const withHistory = prompts.contextualTutor.buildUserPrompt({
      ...base,
      history: [{ question: 'What is a pivot?', answer: 'The leading 1.' }],
    })
    expect(withHistory).toContain('EARLIER IN THIS CONVERSATION')
    expect(withHistory).toContain('Q1: What is a pivot?')
  })
})
