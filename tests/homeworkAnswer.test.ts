import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { DocumentService } from '@/services/documentService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { DocumentChunk } from '@/entities/chunk/types'

type StubCall = { system: string; user: string }

function stubAI(handler: (system: string, user: string) => unknown) {
  const calls: StubCall[] = []
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const system = messages[0]?.content ?? ''
    const user = messages[1]?.content ?? ''
    calls.push({ system, user })
    return { data: await handler(system, user), raw: {} }
  })
  return {
    calls,
    ai: { streamJSON, chatJSON: streamJSON, chat: async () => ({ content: 'ok' }), maxOutputTokens: 2048 } as unknown as AIService,
  }
}

describe('HomeworkService — professor answer key', () => {
  let db: AppDatabase
  let projectId: string
  let documentId: string
  let setId: string
  let answerDocumentId: string
  let chunks: DocumentChunk[]
  let repo: HomeworkRepository

  function question(partial: Partial<HomeworkQuestion>): HomeworkQuestion {
    return {
      id: crypto.randomUUID(),
      projectId,
      setId,
      documentId,
      documentName: 'hw.txt',
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
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id

    const documents = new DocumentRepository(db)
    const doc = await documents.create({ projectId, type: 'text', materialType: 'homework', name: 'hw.txt', sizeBytes: 0 })
    await documents.update(doc.id, { status: 'ready' })
    documentId = doc.id

    chunks = await new ChunkRepository(db).addMany([
      { documentId, projectId, materialType: 'homework', pageNumber: 1, contentType: 'paragraph', text: 'Question 1. Add 4 and 5.', sourceReference: 'hw.txt · Page 1', order: 0 },
      { documentId, projectId, materialType: 'homework', pageNumber: 1, contentType: 'paragraph', text: 'Question 2. Multiply 6 by 7.', sourceReference: 'hw.txt · Page 1', order: 1 },
    ])

    repo = new HomeworkRepository(db)
    setId = crypto.randomUUID()
    const set: HomeworkSet = {
      id: setId,
      projectId,
      documentId,
      documentName: 'hw.txt',
      title: 'hw.txt',
      status: 'ready',
      language: 'en',
      questionCount: 2,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    }
    await repo.upsertSet(set)
    await repo.upsertQuestion(question({ id: 'q1', order: 0, number: '1', prompt: 'Add 4 and 5.', sourceRefs: [{ documentId, documentName: 'hw.txt', page: 1, chunkId: chunks[0]!.id }] }))
    await repo.upsertQuestion(question({ id: 'q2', order: 1, number: '2', prompt: 'Multiply 6 by 7.', sourceRefs: [{ documentId, documentName: 'hw.txt', page: 1, chunkId: chunks[1]!.id }] }))

    const answerDoc = await documents.create({ projectId, type: 'text', materialType: 'homework_answer', name: 'answers.txt', sizeBytes: 0 })
    await documents.update(answerDoc.id, { status: 'ready' })
    answerDocumentId = answerDoc.id
    await new ChunkRepository(db).addMany([
      { documentId: answerDocumentId, projectId, materialType: 'homework_answer', pageNumber: 1, contentType: 'paragraph', text: '1. 9', sourceReference: 'answers.txt', order: 0 },
      { documentId: answerDocumentId, projectId, materialType: 'homework_answer', pageNumber: 1, contentType: 'paragraph', text: '2. 42', sourceReference: 'answers.txt', order: 1 },
    ])
  })

  function service(ai: AIService | null) {
    return new HomeworkService({ ai, db })
  }

  it('links only a real answer file in the same project', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)

    await svc.attachAnswerDocument(setId, answerDocumentId)
    expect((await svc.getAnswerDocument(setId))?.id).toBe(answerDocumentId)

    // An ordinary homework file is refused.
    await expect(svc.attachAnswerDocument(setId, documentId)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    // A file from another project is refused.
    const other = await new ProjectService(db).create({ name: 'Other', subject: 'cs' })
    const otherDoc = await new DocumentRepository(db).create({ projectId: other.id, type: 'text', materialType: 'homework_answer', name: 'a.txt', sizeBytes: 0 })
    await expect(svc.attachAnswerDocument(setId, otherDoc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('proposes a one-to-one mapping and stores it after confirmation', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)

    const mapping = await svc.buildAnswerMapping(setId)
    expect(mapping.entries.map((e) => e.number)).toEqual(['1', '2'])
    expect(mapping.result.assignments.map((a) => a.status)).toEqual(['matched', 'matched'])

    await svc.confirmAnswerMapping(setId, [
      { questionId: 'q1', answerIndex: 0 },
      { questionId: 'q2', answerIndex: 1 },
    ])
    const q1 = (await repo.getQuestion('q1'))!
    expect(q1.answerStatus).toBe('matched')
    expect(q1.answerText).toBe('9')
    expect(q1.answerChunkIds?.length).toBeGreaterThan(0)
  })

  it('generates help grounded in the professor answer and keeps the previous AI solution', async () => {
    const { ai, calls } = stubAI((system) =>
      system.includes('extract the individual questions')
        ? { questions: [] }
        : { hints: ['hint from answer'], solution: 'solution from answer' },
    )
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await repo.updateQuestion('q1', {
      answerText: '9',
      answerNumber: '1',
      answerChunkIds: [chunks[0]!.id],
      answerStatus: 'matched',
      hints: ['old hint'],
      solution: 'old ai solution',
    })

    const result = await svc.generateAnswerContent(setId, ['q1'])
    expect(result.generated).toBe(1)
    const q1 = (await repo.getQuestion('q1'))!
    expect(q1.answerBased).toBe(true)
    expect(q1.hints).toEqual(['hint from answer'])
    expect(q1.solution).toBe('solution from answer')
    expect(q1.previousSolution).toBe('old ai solution')
    // The professor answer was sent to the model.
    const questionCall = calls.find((c) => c.system.includes('homework question'))
    expect(questionCall?.user).toContain('PROFESSOR ANSWER')
    expect(questionCall?.user).toContain('9')
  })

  it('keeps the previous helps and student fields when generation fails', async () => {
    const { ai } = stubAI((system) => {
      if (system.includes('extract the individual questions')) return { questions: [] }
      throw new Error('provider exploded')
    })
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await repo.updateQuestion('q1', {
      answerText: '9',
      answerStatus: 'matched',
      hints: ['keep me'],
      solution: 'keep solution',
      draftText: 'my work',
    })

    const result = await svc.generateAnswerContent(setId, ['q1'])
    expect(result.failed).toBe(1)
    const q1 = (await repo.getQuestion('q1'))!
    expect(q1.hints).toEqual(['keep me'])
    expect(q1.solution).toBe('keep solution')
    expect(q1.draftText).toBe('my work')
    expect(q1.generationStatus).toBe('failed')
  })

  it('replacing the answer file clears old links but keeps student work', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await repo.updateQuestion('q1', {
      answerText: '9',
      answerStatus: 'matched',
      draftText: 'draft',
      hints: ['h'],
    })

    const documents = new DocumentRepository(db)
    const replacement = await documents.create({ projectId, type: 'text', materialType: 'homework_answer', name: 'answers2.txt', sizeBytes: 0 })
    await documents.update(replacement.id, { status: 'ready' })
    await svc.attachAnswerDocument(setId, replacement.id)

    const q1 = (await repo.getQuestion('q1'))!
    expect(q1.answerText).toBeUndefined()
    expect(q1.answerStatus).toBeUndefined()
    expect(q1.draftText).toBe('draft')
    expect(q1.hints).toEqual(['h'])
    expect((await svc.getAnswerDocument(setId))?.id).toBe(replacement.id)
  })

  it('unlinking keeps the answer file unless deletion is requested', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    const documents = new DocumentRepository(db)
    await svc.attachAnswerDocument(setId, answerDocumentId)

    await svc.detachAnswerDocument(setId, projectId, { deleteFile: false })
    expect(await documents.get(answerDocumentId)).toBeTruthy()
    expect((await repo.getSet(setId))?.answerDocumentId).toBeUndefined()

    await svc.attachAnswerDocument(setId, answerDocumentId)
    await svc.detachAnswerDocument(setId, projectId, { deleteFile: true })
    await expect(documents.get(answerDocumentId)).rejects.toBeDefined()
  })

  it('unlinks an answer file deleted elsewhere without removing the assignment', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await repo.updateQuestion('q1', { answerText: '9', answerStatus: 'matched' })

    const documents = new DocumentRepository(db)
    await new DocumentService({ documents, projects: new ProjectService(db), db }).delete(answerDocumentId)

    const set = await repo.getSet(setId)
    expect(set?.answerDocumentId).toBeUndefined()
    expect((await repo.getQuestion('q1'))?.answerText).toBeUndefined()
    expect(await repo.listQuestions(setId)).toHaveLength(2)
  })

  it('downgrades a confirmed answer to review when re-analysis moves the number', async () => {
    const { ai } = stubAI((system) => {
      if (system.includes('extract the individual questions')) {
        return {
          questions: [
            { number: '7', prompt: 'Add 4 and 5.', sourceChunkIds: [`c:${chunks[0]!.id}`] },
          ],
        }
      }
      return { hints: ['h'], solution: 's' }
    })
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await repo.updateQuestion('q1', {
      answerText: '9',
      answerNumber: '1',
      answerStatus: 'matched',
      draftText: 'kept draft',
    })

    await svc.retrySet(setId)

    const q1 = (await repo.getQuestion('q1'))!
    expect(q1.answerStatus).toBe('needs_review')
    expect(q1.answerText).toBe('9') // the answer is kept, just not trusted
    expect(q1.draftText).toBe('kept draft')
    expect((await svc.getAnswerDocument(setId))?.id).toBe(answerDocumentId)
  })
})
