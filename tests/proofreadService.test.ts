import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import {
  HELD_OUT_SELF_TEST_TYPE,
  HomeworkProofreadService,
} from '@/services/homeworkProofreadService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { selectAnalysisDocuments } from '@/entities/courseContent/sourceHash'
import { loadQuizCandidates } from '@/services/sourceContext'
import { questionSectionHash } from '@/entities/homework/walkthrough'
import { answerCheckInputHash, currentAnswerCheck } from '@/entities/homework/answerCheck'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { DocumentChunk } from '@/entities/chunk/types'

interface Call {
  system: string
  user: string
}

function stubAI(handler: (call: Call) => unknown) {
  const calls: Call[] = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const call = { system: messages[0]!.content, user: messages[1]!.content }
    calls.push(call)
    return { data: await handler(call), raw: {} }
  })
  return {
    calls,
    ai: { streamJSON, chatJSON: streamJSON, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

const ORIGINAL = 'Question 1. Solve x – 3 = 4 and give a in m/s2.'
const CORRECTED = 'Question 1. Solve x - 3 = 4 and give a in m/s^2.'

let db: AppDatabase
let projectId: string
let documentId: string
let setId: string
let chunk: DocumentChunk
let repo: HomeworkRepository
let service: HomeworkProofreadService

async function addQuestion(partial: Partial<HomeworkQuestion>): Promise<HomeworkQuestion> {
  const question: HomeworkQuestion = {
    id: crypto.randomUUID(),
    projectId,
    setId,
    documentId,
    documentName: 'hw.txt',
    order: 0,
    number: '1',
    prompt: ORIGINAL,
    sourceRefs: [{ documentId, documentName: 'hw.txt', page: 1, chunkId: chunk.id }],
    hints: ['h1'],
    solution: 'x = 7',
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
  await repo.upsertQuestion(question)
  return question
}

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  projectId = (await new ProjectService(db).create({ name: 'Physics', subject: 'physics' })).id
  const documents = new DocumentRepository(db)
  const doc = await documents.create({
    projectId,
    type: 'text',
    materialType: 'homework',
    name: 'hw.txt',
    sizeBytes: 0,
  })
  await documents.update(doc.id, { status: 'ready' })
  documentId = doc.id
  ;[chunk] = await new ChunkRepository(db).addMany([
    {
      documentId,
      projectId,
      materialType: 'homework',
      pageNumber: 1,
      contentType: 'paragraph',
      text: ORIGINAL,
      sourceReference: 'hw.txt · Page 1',
      order: 0,
    },
  ])
  repo = new HomeworkRepository(db)
  setId = crypto.randomUUID()
  await repo.upsertSet({
    id: setId,
    projectId,
    documentId,
    documentName: 'hw.txt',
    title: 'HW 1',
    status: 'ready',
    language: 'en',
    questionCount: 1,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  })
  service = new HomeworkProofreadService({ db })
})

afterEach(() => db?.close())

describe('导入校对 — saving corrections', () => {
  it('records who / when / before / after and the kind of correction', async () => {
    const q = await addQuestion({})
    const saved = await service.saveQuestion(q.id, { prompt: CORRECTED })
    expect(saved.prompt).toBe(CORRECTED)
    expect(saved.edits).toHaveLength(1)
    expect(saved.edits![0]).toMatchObject({
      by: 'student',
      field: 'prompt',
      before: ORIGINAL,
      after: CORRECTED,
    })
    expect(saved.edits![0]!.kinds).toEqual(expect.arrayContaining(['minus_sign', 'exponent']))
    // Nothing changed: no new edit.
    expect((await service.saveQuestion(q.id, { prompt: CORRECTED })).edits).toHaveLength(1)
    await expect(service.saveQuestion(q.id, { prompt: '  ' })).rejects.toThrow()
  })

  it('downgrades a matched professor answer when the number no longer matches', async () => {
    const q = await addQuestion({ answerStatus: 'matched', answerText: 'x = 7', answerNumber: '1' })
    const same = await service.saveQuestion(q.id, { number: 'Problem 1' })
    expect(same.answerStatus).toBe('matched')
    const moved = await service.saveQuestion(q.id, { number: '2' })
    expect(moved.answerStatus).toBe('needs_review')
    expect(moved.answerLinkStale).toBe(true)
    expect((await service.reconfirmFor(setId)).get(q.id)).toContain('answer_link')
    const back = await service.reconfirmAnswerLink(q.id)
    expect(back.answerStatus).toBe('matched')
    expect(back.answerLinkStale).toBeUndefined()
    expect(back.answerNumber).toBe('2')
  })

  it('downgrades the link when the question text changes materially', async () => {
    const q = await addQuestion({ answerStatus: 'matched', answerText: 'x = 7', answerNumber: '1' })
    expect((await service.saveQuestion(q.id, { prompt: CORRECTED })).answerStatus).toBe('matched')
    const rewritten = await service.saveQuestion(q.id, {
      prompt: 'Question 1. A completely different exercise about momentum and collisions.',
    })
    expect(rewritten.answerStatus).toBe('needs_review')
  })

  it('keeps a corrected professor answer when the link is confirmed again', async () => {
    const q = await addQuestion({
      answerStatus: 'matched',
      answerText: 'x = –7',
      answerNumber: '1',
    })
    await service.saveQuestion(q.id, { answerText: 'x = -7' })
    await repo.setAnswerLinks(setId, [
      { questionId: q.id, answer: { answerText: 'x = –7', answerNumber: '1', answerChunkIds: [] } },
    ])
    expect((await repo.getQuestion(q.id))!.answerText).toBe('x = -7')
  })

  it('the corrected text is what prompts and grading use', async () => {
    const q = await addQuestion({ answerStatus: 'matched', answerText: '–7', answerNumber: '1' })
    const homework = new HomeworkService({ ai: null, db })
    // Before: the recognised source passage (with its dash) goes to prompts.
    expect(await homework.questionSourceText(q)).toContain('–')
    const hashBefore = questionSectionHash(q, 'en', 'v')
    const checkHash = answerCheckInputHash(q, '-7', 'zh')
    await service.saveQuestion(q.id, { prompt: CORRECTED, answerText: '-7' })
    const fixed = (await repo.getQuestion(q.id))!
    // After: only the corrected text, never the uncorrected passage.
    const source = await homework.questionSourceText(fixed)
    expect(source).toBe(CORRECTED)
    expect(source).not.toContain('–')
    // The walkthrough section and any stored check go stale.
    expect(questionSectionHash(fixed, 'en', 'v')).not.toBe(hashBefore)
    const stale = {
      ...fixed,
      answerCheck: { inputHash: checkHash, language: 'zh', promptVersion: 'v1' },
    }
    expect(currentAnswerCheck(stale as HomeworkQuestion, '-7', 'zh', 'v1')).toBeNull()
    // Grading compares with the corrected answer (local objective check).
    expect((await homework.gradeSample(fixed, '-7', 'zh')).verdict).toBe('correct')
    expect((await homework.gradeSample(fixed, '7', 'zh')).verdict).toBe('incorrect')
  })

  it('the walkthrough writer receives the corrected text; 独立解题 never sees the professor answer', async () => {
    const q = await addQuestion({
      answerStatus: 'matched',
      answerText: 'PROFESSOR-ANSWER x = 7',
      answerNumber: '1',
      answerBased: true,
      solution: 'From the professor: x = 7',
    })
    await service.saveQuestion(q.id, { prompt: CORRECTED })
    const fixed = (await repo.getQuestion(q.id))!
    const { ai, calls } = stubAI((call) =>
      call.system.includes('You compare a study app')
        ? {
            items: [{ label: 'whole', status: 'same', note: '' }],
            recommendation: 'keep',
            suggestion: '',
          }
        : { status: 'ready', conclusion: 'x = 7', body: 'Add 3.' },
    )
    const walkthroughs = new HomeworkWalkthroughService({
      ai,
      db,
      homework: new HomeworkService({ ai, db }),
    })
    const solved = await walkthroughs.evaluateQuestion(fixed, {
      align: false,
      label: '1',
      control: { signal: new AbortController().signal, shouldContinue: () => true },
    })
    expect(solved.report?.items[0]!.status).toBe('same')
    const writer = calls[0]!
    expect(writer.user).toContain('x - 3 = 4')
    expect(writer.user).not.toContain('–')
    expect(writer.user).not.toContain('PROFESSOR-ANSWER')
    expect(writer.user).not.toContain('From the professor')
    // The comparison does see it; nothing was saved to the walkthrough.
    expect(calls[1]!.user).toContain('PROFESSOR-ANSWER')
    expect(await db.homeworkWalkthroughs.count()).toBe(0)
    calls.length = 0
    await walkthroughs.evaluateQuestion(fixed, {
      align: true,
      label: '1',
      control: { signal: new AbortController().signal, shouldContinue: () => true },
    })
    expect(calls[0]!.user).toContain('PROFESSOR-ANSWER')
  })

  it('lists derived content made before the correction as 需重新确认', async () => {
    const q = await addQuestion({ contentAt: 5, reviewGuide: { createdAt: 5 } as never })
    expect((await service.reconfirmFor(setId)).get(q.id)).toEqual([])
    await service.saveQuestion(q.id, { prompt: CORRECTED })
    expect((await service.reconfirmFor(setId)).get(q.id)).toEqual(['hints', 'review'])
    // Regenerating the hints clears that item.
    await repo.applyGeneratedContent(q.id, ['new'], 'sol', 'v1')
    expect((await service.reconfirmFor(setId)).get(q.id)).toEqual(['review'])
  })

  it('marks 已核对 and loads risks for the proofreading view', async () => {
    const q = await addQuestion({})
    const state = await service.load(setId)
    const entry = state.entries.find((item) => item.question.id === q.id)!
    expect(entry.risks.map((risk) => risk.kind)).toEqual(
      expect.arrayContaining(['minus_sign', 'flattened_power']),
    )
    expect(entry.page).toBe(1)
    expect((await service.setVerified(q.id, true)).verifiedAt).toBeGreaterThan(0)
    expect((await service.setVerified(q.id, false)).verifiedAt).toBeUndefined()
  })
})

describe('留作检验 (independent) — excluded from AI context', () => {
  it('a held-out set marks its document and chunks; they leave analysis and quiz sources', async () => {
    const documents = await new DocumentRepository(db).listByProject(projectId)
    expect(selectAnalysisDocuments(documents).map((doc) => doc.id)).toContain(documentId)
    await service.setSetEvalRole(setId, 'independent')
    const after = await new DocumentRepository(db).listByProject(projectId)
    expect(after.find((doc) => doc.id === documentId)!.evalRole).toBe('independent')
    expect(selectAnalysisDocuments(after).map((doc) => doc.id)).not.toContain(documentId)
    const stored = await new ChunkRepository(db).listByDocument(documentId)
    expect(stored.every((item) => item.evalRole === 'independent')).toBe(true)
    const candidates = await loadQuizCandidates({
      documentIds: [documentId],
      chunks: new ChunkRepository(db),
    })
    expect(candidates).toEqual([])
    await service.setSetEvalRole(setId, undefined)
    expect(
      (await loadQuizCandidates({ documentIds: [documentId], chunks: new ChunkRepository(db) }))
        .length,
    ).toBe(1)
  })

  it('independent questions are left out of the walkthrough', async () => {
    const kept = await addQuestion({ prompt: 'Kept question.', order: 0 })
    const held = await addQuestion({ prompt: 'Held out question.', order: 1 })
    await service.setQuestionEvalRole(held.id, 'independent')
    const state = await new HomeworkWalkthroughService({ ai: null, db }).state(setId)
    expect(state.questions.map((question) => question.id)).toEqual([kept.id])
  })

  it('a self-test result is recorded to mastery tagged as held-out', async () => {
    const q = await addQuestion({ evalRole: 'independent' })
    await service.recordSelfTest(q.id, { answer: 'x = 7', verdict: 'correct', by: 'self' })
    expect((await repo.getQuestion(q.id))!.selfTest).toMatchObject({
      verdict: 'correct',
      by: 'self',
    })
    const rows = await db.knowledgeMastery.toArray()
    const row = rows.find((item) => item.projectId === projectId)!
    expect(row.knowledgePoint).toBe('HW 1')
    expect(JSON.stringify(row)).toContain(HELD_OUT_SELF_TEST_TYPE)
    // Never in the mistake book.
    expect(await db.mistakes.count()).toBe(0)
  })
})

describe('question metadata (local)', () => {
  it('matches knowledge points and exam topics without AI', async () => {
    const analyses = new CourseAnalysisRepository(db)
    await analyses.addTopics([
      {
        id: 't1',
        projectId,
        name: 'Linear motion',
        description: '',
        order: 0,
        sourceRefs: [],
        createdAt: 1,
      },
      {
        id: 't2',
        projectId,
        name: 'Thermodynamics',
        description: '',
        order: 1,
        sourceRefs: [],
        createdAt: 1,
      },
    ] as never)
    const doc = await new DocumentRepository(db).create({
      projectId,
      type: 'text',
      materialType: 'syllabus',
      name: 'syllabus.txt',
      sizeBytes: 0,
    })
    await new DocumentRepository(db).update(doc.id, {
      syllabus: {
        scopes: [
          {
            id: 's1',
            label: 'Final',
            kind: 'final',
            topics: [
              {
                id: 'e1',
                text: 'Kinematics in one dimension',
                order: 0,
                source: 'local',
                topicIds: ['t1'],
              },
            ],
          },
        ],
        extractedAt: 1,
        method: 'local',
      },
    })
    const q = await addQuestion({
      prompt: 'A car in linear motion accelerates. Find the motion time.',
    })
    expect(await service.refreshMeta(setId)).toBe(1)
    const meta = (await repo.getQuestion(q.id))!.meta!
    expect(meta.knowledgePoints).toEqual(['Linear motion'])
    expect(meta.examTopics.map((topic) => topic.text)).toEqual(['Kinematics in one dimension'])
    // Unchanged inputs: nothing rewritten.
    expect(await service.refreshMeta(setId)).toBe(0)
  })
})
