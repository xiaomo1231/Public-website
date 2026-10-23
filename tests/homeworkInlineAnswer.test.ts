import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import {
  HomeworkService,
  RECOGNITION_STALE_MS,
  normalizeQuestions,
} from '@/services/homeworkService'
import { MockExamService } from '@/services/mockExamService'
import { answerReference } from '@/entities/homework/answerCheck'
import {
  answerFoundIn,
  attachMarkedAnswers,
  inlineAnswerFields,
  markedAnswerLines,
  type InlineAnswer,
  validateInlineAnswer,
} from '@/entities/homework/inlineAnswer'
import { MARKED_ANSWERS_SECTION } from '@/infrastructure/files/chunking'
import * as v1 from '@/infrastructure/ai/prompts/homework-analyzer/v1'
import * as v3 from '@/infrastructure/ai/prompts/homework-analyzer/v3'
import { prompts } from '@/infrastructure/ai/prompts'
import { securityFooter } from '@/infrastructure/ai/prompts/security'
import type { AIService } from '@/services/aiService'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { Document } from '@/entities/document/types'

function chunk(id: string, text: string, extra: Partial<DocumentChunk> = {}): DocumentChunk {
  return {
    id,
    documentId: 'doc',
    projectId: 'p',
    materialType: 'past_exam',
    pageNumber: 1,
    contentType: 'paragraph',
    text,
    sourceReference: 'paper.pdf',
    order: 0,
    createdAt: 0,
    ...extra,
  } as DocumentChunk
}

describe('inline answers — local checks', () => {
  it('accepts an answer found verbatim (whitespace, case, NFKC and … pieces aside)', () => {
    const source = 'Q1. Find x.\nSolution:  x = 2\nso the answer is ２.\n2 pts: x = 2'
    expect(answerFoundIn('Solution: x = 2', source)).toBe(true)
    expect(answerFoundIn('solution: X = 2 … 2 pts: x = 2', source)).toBe(true)
    expect(answerFoundIn('2 pts: x = 2 … Solution: x = 2', source)).toBe(false)
    expect(answerFoundIn('x = 3', source)).toBe(false)
  })

  it('short answers must stand on their own', () => {
    expect(answerFoundIn('c', 'Answer 7: (c) 1.25')).toBe(true)
    expect(answerFoundIn('c', 'The price elasticity')).toBe(false)
    expect(answerFoundIn('12', 'p. 123')).toBe(false)
  })

  it('drops an invented answer, and the question text handed back as its answer', () => {
    const passage = chunk('c1', 'Question 1. Explain the law of demand in full detail please.')
    const context = { prompt: 'Explain the law of demand.', cited: [passage], questionChunks: [] }
    expect(validateInlineAnswer('Demand falls when price rises.', context)).toBeUndefined()
    expect(
      validateInlineAnswer('Explain the law of demand.', {
        ...context,
        cited: [chunk('c1', 'Explain the law of demand.')],
      }),
    ).toBeUndefined()
    expect(validateInlineAnswer(null, context)).toBeUndefined()
  })

  it('searches the question’s own chunks when the answer cites none, and keeps the chunks used', () => {
    const a = chunk('a', 'Q1. Find x if x + 1 = 3.', { order: 0 })
    const b = chunk('b', 'Answer: x = 2', { order: 1 })
    expect(
      validateInlineAnswer('Answer: x = 2', {
        prompt: 'Find x',
        cited: [],
        questionChunks: [a, b],
      }),
    ).toEqual({ text: 'Answer: x = 2', chunkIds: ['b'] })
  })

  it('pairs marked-option lines by printed number, never an ambiguous one', () => {
    const marks = chunk('m', 'Answer 3: (b) down\nAnswer 4: (a) up\nAnswer 4: (c) flat', {
      section: MARKED_ANSWERS_SECTION,
    })
    const plain = chunk('x', 'Answer 5: (d) not a marked line')
    const lines = markedAnswerLines([marks, plain])
    expect([...lines.keys()]).toEqual(['3'])
    const out = attachMarkedAnswers<{
      number: string
      prompt: string
      inlineAnswer?: InlineAnswer
    }>(
      [
        { number: '3', prompt: 'Q3' },
        { number: '4', prompt: 'Q4' },
        { number: '5', prompt: 'Q5' },
      ],
      [marks, plain],
    )
    expect(out[0]!.inlineAnswer).toEqual({ text: 'Answer 3: (b) down', chunkIds: ['m'] })
    expect(out[1]!.inlineAnswer).toBeUndefined()
    expect(out[2]!.inlineAnswer).toBeUndefined()
  })

  it('inline fields clear when there is none', () => {
    expect(inlineAnswerFields({ number: '1' }).answerStatus).toBeUndefined()
    expect(
      inlineAnswerFields({ number: '1', inlineAnswer: { text: 'x', chunkIds: ['c'] } }),
    ).toMatchObject({ answerStatus: 'matched', answerSource: 'inline', answerText: 'x' })
  })
})

describe('homework-analyzer/v3', () => {
  it('is registered, asks for verbatim answers and keeps the security footer', () => {
    expect(prompts.homeworkAnalyzer.VERSION).toBe('v3')
    const system = v3.buildSystemPrompt()
    expect(system).toContain('"answer": "string | null"')
    expect(system).toContain('answerSourceChunkIds')
    expect(system).toContain('Never write an answer yourself')
    expect(system.trimEnd().endsWith(securityFooter().trimEnd())).toBe(true)
  })

  it('the user prompt is unchanged', () => {
    const input = { documentName: 'hw.pdf', documentText: '[c:1]\nQ1', language: 'zh' as const }
    expect(v3.buildUserPrompt(input)).toBe(v1.buildUserPrompt({ ...input, language: 'mixed' }))
  })

  it('reads replies without answers exactly as before (backward compatible)', () => {
    const chunks = [chunk('c1', 'Question 1. Find x if x + 1 = 3.')]
    const doc = { id: 'doc', name: 'paper.pdf' } as Document
    const out = normalizeQuestions(
      { questions: [{ number: '1', prompt: 'Find x if x + 1 = 3.', sourceChunkIds: ['c:c1'] }] },
      chunks,
      doc,
    )
    expect(out).toHaveLength(1)
    expect('inlineAnswer' in out[0]!).toBe(false)
  })
})

// ---------------------------------------------------------------------------

type StubMessage = { role: string; content: string }

function stubAI(reply: (system: string, user: string) => unknown): AIService {
  const respond = async (messages: StubMessage[]) => ({
    data: await reply(messages[0]?.content ?? '', messages[messages.length - 1]?.content ?? ''),
    raw: {},
  })
  return {
    chatJSON: respond,
    streamJSON: respond,
    maxOutputTokens: 4_096,
    chat: async () => ({ content: 'ok' }),
  } as unknown as AIService
}

describe('HomeworkService — answers printed in the paper', () => {
  let db: AppDatabase
  let projectId: string
  let documentId: string
  let ids: string[]
  let withAnswers: boolean

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    withAnswers = true
    const project = await new ProjectService(db).create({ name: 'Econ', subject: 'economics' })
    projectId = project.id
    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType: 'past_exam',
      name: 'midterm.pdf',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    documentId = doc.id
    const texts: Array<[string, string?]> = [
      ['Question 1. Find x if x + 1 = 3. (2 marks)\nAnswer: x = 2'],
      [
        'Question 2. State the law of demand. (4 marks)\n2 pts: quantity demanded falls as price rises\n2 pts: other things equal',
      ],
      ['Question 3. Which way does demand slope? (a) up (b) down'],
      ['Question 4. Define elasticity in one sentence.'],
      ['Answer 3: (b) down', MARKED_ANSWERS_SECTION],
    ]
    const rows = await new ChunkRepository(db).addMany(
      texts.map(([text, section], i) => ({
        documentId,
        projectId,
        materialType: 'past_exam' as const,
        pageNumber: 1,
        contentType: 'paragraph' as const,
        text: text.padEnd(80, ' '),
        sourceReference: 'midterm.pdf · Page 1',
        order: i,
        ...(section ? { section } : {}),
      })),
    )
    ids = rows.map((row) => row.id)
  })

  function service(): HomeworkService {
    return new HomeworkService({
      db,
      ai: stubAI((system) => {
        if (system.includes('extract the individual questions')) {
          const answer = (text: string, chunkIndex: number) =>
            withAnswers ? { answer: text, answerSourceChunkIds: [`c:${ids[chunkIndex]}`] } : {}
          return {
            questions: [
              {
                number: '1',
                prompt: 'Find x if x + 1 = 3. (2 marks)',
                sourceChunkIds: [`c:${ids[0]}`],
                ...answer('Answer: x = 2', 0),
              },
              {
                number: '2',
                prompt: 'State the law of demand. (4 marks)',
                sourceChunkIds: [`c:${ids[1]}`],
                ...answer(
                  '2 pts: quantity demanded falls as price rises\n2 pts: other things equal',
                  1,
                ),
              },
              {
                number: '3',
                prompt: 'Which way does demand slope? (a) up (b) down',
                sourceChunkIds: [`c:${ids[2]}`],
              },
              {
                number: '4',
                prompt: 'Define elasticity in one sentence.',
                sourceChunkIds: [`c:${ids[3]}`],
                // Invented: not in the material.
                ...answer('Elasticity is the responsiveness of quantity to price.', 3),
              },
            ],
          }
        }
        return { hints: ['Start from the definition.'], solution: 'Worked solution.' }
      }),
    })
  }

  async function questions(setId: string) {
    const rows = await new HomeworkRepository(db).listQuestions(setId)
    return Object.fromEntries(rows.map((row) => [row.number!, row]))
  }

  it('stores verbatim answers as 教授答案（卷内附带）, drops invented ones, pairs marked options', async () => {
    const set = await service().createFromDocument(documentId)
    expect(set.status).toBe('ready')
    const q = await questions(set.id)
    expect(q['1']).toMatchObject({
      answerSource: 'inline',
      answerStatus: 'matched',
      answerText: 'Answer: x = 2',
      answerChunkIds: [ids[0]],
      prompt: 'Find x if x + 1 = 3. (2 marks)',
    })
    expect(q['1']!.inlineAnswer?.text).toBe('Answer: x = 2')
    expect(q['3']).toMatchObject({ answerSource: 'inline', answerText: 'Answer 3: (b) down' })
    expect(q['4']!.answerStatus).toBeUndefined()
    expect(q['4']!.inlineAnswer).toBeUndefined()
    // Help is written from the professor answer, like a linked key.
    expect(q['1']!.answerBased).toBe(true)

    // Used by 检查答案 (local, against the professor answer) …
    expect(answerReference(q['1']!)).toEqual({ kind: 'professor', text: 'Answer: x = 2' })
    const check = await service().checkAnswer(q['1']!.id, 'x = 2', 'en')
    expect(check).toMatchObject({ method: 'local', verdict: 'correct' })
    // … and by the mock exam's 教授评分标准 (marks stay in the stem).
    const state = await new MockExamService({ homework: service(), db }).state(set.id)
    const q2 = state.questions.find((view) => view.question.number === '2')!
    expect(q2.marks?.total).toBe(4)
    expect(q2.scheme).toHaveLength(2)
    expect(q2.schemeSource).toBe('professor')
  })

  it('a linked answer file takes precedence, and the inline answer comes back when it goes', async () => {
    const svc = service()
    const set = await svc.createFromDocument(documentId)
    const documents = new DocumentRepository(db)
    const key = await documents.create({
      projectId,
      type: 'text',
      materialType: 'homework_answer',
      name: 'key.pdf',
      sizeBytes: 0,
    })
    await documents.update(key.id, { status: 'ready' })
    await new ChunkRepository(db).addMany([
      {
        documentId: key.id,
        projectId,
        materialType: 'homework_answer' as const,
        pageNumber: 1,
        contentType: 'paragraph' as const,
        text: '1. x = 2 because 2 + 1 = 3',
        sourceReference: 'key.pdf',
        order: 0,
      },
    ])
    await svc.attachAnswerDocument(set.id, key.id)
    const before = await questions(set.id)
    const { entries } = await svc.buildAnswerMapping(set.id)
    expect(entries).toHaveLength(1)
    await svc.confirmAnswerMapping(
      set.id,
      Object.values(before).map((question) =>
        question.number === '1'
          ? { questionId: question.id, answerIndex: 0 }
          : { questionId: question.id },
      ),
    )
    let q = await questions(set.id)
    expect(q['1']!.answerSource).toBeUndefined()
    expect(q['1']!.answerText).toContain('because 2 + 1 = 3')
    // Not chosen from the file: the paper's own answer stays.
    expect(q['3']).toMatchObject({ answerSource: 'inline', answerText: 'Answer 3: (b) down' })

    // A re-read keeps the file's answer.
    await svc.retrySet(set.id)
    q = await questions(set.id)
    expect(q['1']!.answerSource).toBeUndefined()
    expect(q['1']!.inlineAnswer?.text).toBe('Answer: x = 2')

    await svc.detachAnswerDocument(set.id, projectId)
    q = await questions(set.id)
    expect(q['1']).toMatchObject({ answerSource: 'inline', answerText: 'Answer: x = 2' })
  })

  it('a re-read keeps a 校对 correction of the same printed answer, and clears one no longer printed', async () => {
    const svc = service()
    const set = await svc.createFromDocument(documentId)
    const repo = new HomeworkRepository(db)
    const q1 = (await questions(set.id))['1']!
    await repo.updateQuestion(q1.id, {
      answerText: 'Answer: x = 2 (corrected)',
      edits: [
        {
          at: 1,
          by: 'student',
          field: 'answerText',
          before: 'Answer: x = 2',
          after: 'Answer: x = 2 (corrected)',
          kinds: ['other'],
        },
      ],
    })
    await svc.retrySet(set.id)
    expect((await questions(set.id))['1']!.answerText).toBe('Answer: x = 2 (corrected)')

    withAnswers = false
    await svc.retrySet(set.id)
    const q = await questions(set.id)
    expect(q['1']!.answerSource).toBeUndefined()
    expect(q['1']!.answerStatus).toBeUndefined()
    // The marked-option line is read locally, with or without the model.
    expect(q['3']!.answerText).toBe('Answer 3: (b) down')
  })
})

describe('HomeworkService — interrupted recognition', () => {
  it('turns a stale `analyzing` set with no run into `paused`, never a fresh one', async () => {
    const db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Econ', subject: 'economics' })
    const now = Date.now()
    const base = {
      projectId: project.id,
      documentName: 'p.pdf',
      title: 'p',
      status: 'analyzing',
      language: 'en',
      questionCount: 0,
      promptVersion: 'v3',
      createdAt: 1,
    }
    await db.table('homeworkSets').bulkPut([
      {
        ...base,
        id: 'stale',
        documentId: 'd1',
        progress: { stage: 'identifying', completed: 0, total: 3, updatedAt: 1 },
        updatedAt: now - RECOGNITION_STALE_MS - 1,
      },
      {
        ...base,
        id: 'fresh',
        documentId: 'd2',
        progress: { stage: 'identifying', completed: 0, total: 3, updatedAt: now },
        updatedAt: now,
      },
    ])
    const svc = new HomeworkService({ db, ai: null })
    expect(await svc.recoverInterrupted(project.id, now)).toBe(1)
    const stale = await db.table('homeworkSets').get('stale')
    expect(stale.status).toBe('paused')
    expect(stale.progress).toMatchObject({ stage: 'identifying', completed: 0, total: 3 })
    expect((await db.table('homeworkSets').get('fresh')).status).toBe('analyzing')
    db.close()
  })
})
