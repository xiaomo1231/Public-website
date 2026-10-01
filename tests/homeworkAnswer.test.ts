import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { ProcessingService } from '@/services/processingService'
import { DocumentService } from '@/services/documentService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import { OutputTruncatedError, RateLimitedError, TimeoutError } from '@/infrastructure/ai/errors'
import { buildAnswerLines, isDeferredProfessorAnswer, segmentsToAnswerEntries } from '@/entities/homework/answerMatching'
import { checkObjectiveAnswer } from '@/entities/homework/answerCheck'

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

  it('checks a clear numeric professor answer locally without an AI provider', async () => {
    await repo.updateQuestion('q1', { answerStatus: 'matched', answerText: '1. 9', answerChunkIds: ['answer-chunk'] })
    const svc = service(null)
    const correct = await svc.checkAnswer('q1', '9', 'en')
    expect(correct).toMatchObject({ method: 'local', verdict: 'correct', expectedAnswer: '9', referenceKind: 'professor' })
    expect(correct.similarityPercent).toBeUndefined()
    expect((await repo.getQuestion('q1'))?.draftText).toBe('9')
    expect(await svc.checkAnswer('q1', '9', 'en')).toEqual(correct)
    const incorrect = await svc.checkAnswer('q1', '7', 'en')
    expect(incorrect).toMatchObject({ method: 'local', verdict: 'incorrect' })
  })

  it('keeps multistep and proof questions out of direct answer matching', () => {
    expect(checkObjectiveAnswer(question({ prompt: 'Set up the system, solve it by hand, and explain the result.' }), '9', '9')).toBeNull()
    expect(checkObjectiveAnswer(question({ prompt: 'Prove that the span is a subspace.' }), 'True', 'True')).toBeNull()
  })

  it('uses AI for a worked answer and saves its semantic estimate with provenance', async () => {
    await repo.updateQuestion('q1', {
      prompt: 'Explain why 4 + 5 = 9.', answerStatus: 'matched',
      answerText: 'Adding five to four gives nine because the total increases by five.',
      answerChunkIds: ['answer-chunk'],
    })
    const { ai, calls } = stubAI(() => ({
      status: 'ready', similarityPercent: 75, verdict: 'partial',
      feedback: 'The total is right, but explain the addition.',
      matchedPoints: ['The total is 9.'], missingPoints: ['Explain the addition.'],
    }))
    const result = await service(ai).checkAnswer('q1', '4 + 5 = 9', 'en')
    expect(result).toMatchObject({ method: 'ai', verdict: 'partial', similarityPercent: 75, referenceKind: 'professor' })
    expect(result.answerChunkIds).toEqual(['answer-chunk'])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.user).toContain('STUDENT ANSWER')
    expect((await repo.getQuestion('q1'))?.answerCheck).toEqual(result)
  })

  it('rejects an unusable AI judgment without saving it', async () => {
    await repo.updateQuestion('q1', { prompt: 'Explain why 4 + 5 = 9.', answerStatus: 'matched', answerText: 'Because addition combines quantities.' })
    const { ai } = stubAI(() => ({ status: 'ready', similarityPercent: 130, verdict: 'correct', feedback: 'Fine', matchedPoints: [], missingPoints: [] }))
    await expect(service(ai).checkAnswer('q1', 'It is 9.', 'en')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect((await repo.getQuestion('q1'))?.answerCheck).toBeUndefined()
  })

  it('does not commit a check after the student or professor answer changes', async () => {
    await repo.updateQuestion('q1', { answerStatus: 'matched', answerText: '9', answerChunkIds: ['answer-chunk'] })
    const result = await service(null).checkAnswer('q1', '9', 'en')
    await repo.updateQuestion('q1', { draftText: '8' })
    expect(await repo.applyAnswerCheck('q1', '9', result)).toBeUndefined()
    await repo.updateQuestion('q1', { draftText: '9', answerText: '10' })
    expect(await repo.applyAnswerCheck('q1', '9', result)).toBeUndefined()
  })

  it('builds a complete review once, caches it, and refreshes when the answer changes', async () => {
    const { ai, calls } = stubAI(() => ({
      status: 'ready', questionMeaning: 'Add two numbers.',
      knowledgePoints: ['Addition'], method: 'Combine units.',
      steps: ['Write $4+5$.', 'Compute $4+5=9$.'],
      explanation: 'Five added to four gives nine.', interpretation: 'The total is nine.',
      check: '$9-5=4$.',
    }))
    const svc = service(ai)
    const first = await svc.getOrGenerateReviewGuide('q1', 'en')
    expect(first.steps).toHaveLength(2)
    expect(first.questionSourceRefs[0]?.chunkId).toBe(chunks[0]!.id)
    expect(calls).toHaveLength(1)
    expect(await svc.getOrGenerateReviewGuide('q1', 'en')).toEqual(first)
    expect(calls).toHaveLength(1)

    await repo.updateQuestion('q1', { answerStatus: 'matched', answerText: 'Professor: $4+5=9$.', answerChunkIds: ['answer-1'] })
    const refreshed = await svc.getOrGenerateReviewGuide('q1', 'en')
    expect(refreshed.inputHash).not.toBe(first.inputHash)
    expect(refreshed.answerChunkIds).toEqual(['answer-1'])
    expect(calls).toHaveLength(2)
    expect(calls[1]!.user).toContain('CONFIRMED PROFESSOR ANSWER')
  })

  it('does not save partial review output', async () => {
    const { ai } = stubAI(() => ({ status: 'ready', questionMeaning: 'Add two numbers.', steps: ['Add.'] }))
    await expect(service(ai).getOrGenerateReviewGuide('q1', 'en')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect((await repo.getQuestion('q1'))?.reviewGuide).toBeUndefined()
  })

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

  it('re-reads a linked PDF while preserving student work and clearing stale answer links only on success', async () => {
    const svc = service(null)
    await db.documents.update(answerDocumentId, { type: 'pdf' })
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await svc.confirmAnswerMapping(setId, [
      { questionId: 'q1', answerIndex: 0 },
      { questionId: 'q2', answerIndex: 1 },
    ])
    await repo.updateQuestion('q1', {
      draftText: 'My own work',
      hints: ['First hint'],
      revealedHints: 1,
      solution: 'Previous solution',
      messages: [{ id: 'm1', role: 'student', content: 'Why?', createdAt: 2 }],
    })
    const before = (await repo.getQuestion('q1'))!
    const process = vi.spyOn(ProcessingService.prototype, 'process')
    process.mockRejectedValueOnce(new Error('PDF unreadable'))
    await expect(svc.reprocessAnswerDocument(setId, projectId)).rejects.toThrow('PDF unreadable')
    expect(await repo.getQuestion('q1')).toEqual(before)

    process.mockResolvedValueOnce()
    await svc.reprocessAnswerDocument(setId, projectId)
    const after = (await repo.getQuestion('q1'))!
    expect(after.answerStatus).toBeUndefined()
    expect(after.answerText).toBeUndefined()
    expect(after.draftText).toBe('My own work')
    expect(after.hints).toEqual(['First hint'])
    expect(after.revealedHints).toBe(1)
    expect(after.solution).toBe('Previous solution')
    expect(after.messages).toEqual(before.messages)
    expect((await repo.getSet(setId))?.answerDocumentId).toBe(answerDocumentId)
    process.mockRestore()
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

  it('does not ask AI to invent a worked answer when the professor leaves the problem to students', async () => {
    const officialText = 'Solution: This is similar to the last problem and is left to you.'
    expect(isDeferredProfessorAnswer(officialText)).toBe(true)
    expect(isDeferredProfessorAnswer('Solution: x_1 = 2 and x_2 = 1.')).toBe(false)
    const { ai } = stubAI(() => ({ hints: ['invented'], solution: 'invented' }))
    await repo.updateQuestion('q1', {
      answerText: officialText,
      answerStatus: 'matched',
      draftText: 'My equations',
      hints: ['Old hint'],
      messages: [{ id: 'm1', role: 'student', content: 'What next?', createdAt: 2 }],
    })
    const result = await service(ai).generateAnswerContent(setId, ['q1'])
    expect(result).toMatchObject({ generated: 0, failed: 0, skipped: 1 })
    const saved = (await repo.getQuestion('q1'))!
    expect(saved.generationError).toMatch(/教授|professor/i)
    expect(saved.draftText).toBe('My equations')
    expect(saved.hints).toEqual(['Old hint'])
    expect(saved.messages).toHaveLength(1)
    expect(ai.streamJSON).not.toHaveBeenCalled()
  })

  it('generates matched answers with bounded concurrency, reports progress, and skips completed work on repeat', async () => {
    await repo.updateQuestion('q1', { answerText: '9', answerStatus: 'matched' })
    await repo.updateQuestion('q2', { answerText: '42', answerStatus: 'matched' })
    await repo.upsertQuestion(question({ id: 'q3', order: 2, number: '3', answerText: '7', answerStatus: 'matched' }))
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started = 0
    const streamJSON = vi.fn(async () => {
      started += 1
      await gate
      return { data: { hints: ['Try a step'], solution: 'Worked answer' }, raw: {} }
    })
    const svc = service({ streamJSON, maxOutputTokens: 2048 } as unknown as AIService)
    const progress: number[] = []
    const run = svc.generateAnswerContent(setId, undefined, (step) => progress.push(step.completed))
    await vi.waitFor(() => expect(started).toBe(2))
    expect(progress[0]).toBe(0)
    release()
    expect(await run).toEqual({ generated: 3, failed: 0, skipped: 0 })
    expect(started).toBe(3)
    expect(progress.at(-1)).toBe(3)

    expect(await svc.generateAnswerContent(setId)).toEqual({ generated: 0, failed: 0, skipped: 3 })
    expect(started).toBe(3)
  })

  it('prepares professor-grounded hints and solution in stages when combined output is truncated', async () => {
    await repo.updateQuestion('q1', { answerText: '9', answerStatus: 'matched' })
    const streamJSON = vi.fn(async (
      messages: Array<{ content: string }>,
      _onDelta?: unknown,
      _options?: { signal?: AbortSignal },
    ) => {
      const system = messages[0]?.content ?? ''
      if (system.includes('exactly two fields')) throw new OutputTruncatedError(2048)
      if (system.includes('one field: {"hints"')) return { data: { hints: ['Add the terms'] }, raw: {} }
      return { data: { solution: '4 + 5 = 9' }, raw: {} }
    })
    const svc = service({ streamJSON, maxOutputTokens: 2048 } as unknown as AIService)
    expect(await svc.generateAnswerContent(setId, ['q1'])).toMatchObject({ generated: 1, failed: 0 })
    const saved = (await repo.getQuestion('q1'))!
    expect(saved.answerBased).toBe(true)
    expect(saved.hints).toEqual(['Add the terms'])
    expect(saved.solution).toBe('4 + 5 = 9')
    expect(streamJSON).toHaveBeenCalledTimes(4)
    expect(streamJSON.mock.calls.every(([messages]) => messages[1]?.content.includes('PROFESSOR ANSWER'))).toBe(true)
    expect(streamJSON.mock.calls.every(([, , options]) => options?.signal instanceof AbortSignal)).toBe(true)
  })

  it('stops scheduling more answer generation after the provider rate-limits the batch', async () => {
    await repo.updateQuestion('q1', { answerText: '9', answerStatus: 'matched' })
    await repo.updateQuestion('q2', { answerText: '42', answerStatus: 'matched' })
    await repo.upsertQuestion(question({ id: 'q3', order: 2, number: '3', answerText: '7', answerStatus: 'matched' }))
    const streamJSON = vi.fn(async () => { throw new RateLimitedError() })
    const svc = service({ streamJSON, maxOutputTokens: 2048 } as unknown as AIService)
    expect(await svc.generateAnswerContent(setId)).toEqual({ generated: 0, failed: 3, skipped: 0 })
    expect(streamJSON).toHaveBeenCalledTimes(2)
    expect((await repo.getQuestion('q3'))?.generationError).toMatch(/rate limit|限流/i)
  })

  it('stops a batch after two timed-out questions instead of waiting through every question', async () => {
    await repo.updateQuestion('q1', { answerText: '9', answerStatus: 'matched' })
    await repo.updateQuestion('q2', { answerText: '42', answerStatus: 'matched' })
    await repo.upsertQuestion(question({ id: 'q3', order: 2, number: '3', answerText: '7', answerStatus: 'matched' }))
    const streamJSON = vi.fn(async () => { throw new TimeoutError(120_000) })
    const svc = service({ streamJSON, maxOutputTokens: 2048 } as unknown as AIService)
    expect(await svc.generateAnswerContent(setId)).toEqual({ generated: 0, failed: 3, skipped: 0 })
    expect(streamJSON).toHaveBeenCalledTimes(2)
    expect((await repo.getQuestion('q3'))?.generationError).toMatch(/long|time|超时|过长/i)
  })

  it('marks old AI help ungrounded when a confirmed answer changes, while retaining student records', async () => {
    const svc = service(null)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await svc.confirmAnswerMapping(setId, [{ questionId: 'q1', answerIndex: 0 }])
    await repo.updateQuestion('q1', { answerBased: true, draftText: 'my attempt', hints: ['prior hint'] })
    await svc.confirmAnswerMapping(setId, [{ questionId: 'q1', answerIndex: 0 }])
    expect((await repo.getQuestion('q1'))?.answerBased).toBe(true)
    await repo.setAnswerLinks(setId, [{ questionId: 'q1', answer: {
      answerText: 'new official answer', answerNumber: '1', answerChunkIds: ['new-chunk'],
    } }])
    const updated = (await repo.getQuestion('q1'))!
    expect(updated.answerBased).toBe(false)
    expect(updated.draftText).toBe('my attempt')
    expect(updated.hints).toEqual(['prior hint'])
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

  async function answerLines() {
    const chunks = await new ChunkRepository(db).listByDocument(answerDocumentId)
    return buildAnswerLines(
      chunks
        .sort((a, b) => a.order - b.order)
        .map((chunk) => ({ id: chunk.id, text: chunk.text, pageNumber: chunk.pageNumber })),
    )
  }

  it('saves a manual division and uses it for the mapping', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)

    const entries = segmentsToAnswerEntries(await answerLines(), [0], { 0: '1' })
    const saved = await svc.saveAnswerEntries(setId, entries)
    expect(saved).toBe(1)

    const mapping = await svc.buildAnswerMapping(setId)
    expect(mapping.manual).toBe(true)
    expect(mapping.entries).toHaveLength(1)
    expect(mapping.entries[0]!.number).toBe('1')

    await svc.confirmAnswerMapping(setId, [{ questionId: 'q1', answerIndex: 0 }])
    const q1 = (await repo.getQuestion('q1'))!
    expect(q1.answerStatus).toBe('matched')
    expect(q1.answerText).toContain('9')
  })

  it('clearAnswerEntries restores the automatic parse', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await svc.saveAnswerEntries(setId, segmentsToAnswerEntries(await answerLines(), [0], { 0: '1' }))
    await svc.clearAnswerEntries(setId)
    const mapping = await svc.buildAnswerMapping(setId)
    expect(mapping.manual).toBe(false)
  })

  it('rejects a saved division that cites chunks from another document', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await expect(
      svc.saveAnswerEntries(setId, [{ number: '1', text: 'x', chunkIds: [chunks[0]!.id] }]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('enforces one-to-one mapping in the service, not just the UI', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)

    // The same answer entry cannot be assigned to two questions.
    await expect(
      svc.confirmAnswerMapping(setId, [
        { questionId: 'q1', answerIndex: 0 },
        { questionId: 'q2', answerIndex: 0 },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect((await repo.getQuestion('q1'))?.answerStatus).toBeUndefined()

    // Out-of-range index, duplicate question id and a foreign question all fail.
    await expect(
      svc.confirmAnswerMapping(setId, [{ questionId: 'q1', answerIndex: 9 }]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      svc.confirmAnswerMapping(setId, [
        { questionId: 'q1', answerIndex: 0 },
        { questionId: 'q1', answerIndex: 1 },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      svc.confirmAnswerMapping(setId, [{ questionId: 'other', answerIndex: 0 }]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('confirms a mapping without touching student work', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await repo.updateQuestion('q1', {
      draftText: 'my work',
      hints: ['keep'],
      solutionRevealed: true,
      messages: [{ id: 'm1', role: 'student', content: 'why?', createdAt: 1 }],
    })

    await svc.confirmAnswerMapping(setId, [
      { questionId: 'q1', answerIndex: 0 },
      { questionId: 'q2', answerIndex: 1 },
    ])

    const q1 = (await repo.getQuestion('q1'))!
    expect(q1.answerStatus).toBe('matched')
    expect(q1.draftText).toBe('my work')
    expect(q1.hints).toEqual(['keep'])
    expect(q1.solutionRevealed).toBe(true)
    expect(q1.messages).toHaveLength(1)
  })

  it('drops a manual division when the answer file is replaced', async () => {
    const { ai } = stubAI(() => ({}))
    const svc = service(ai)
    const documents = new DocumentRepository(db)
    await svc.attachAnswerDocument(setId, answerDocumentId)
    await svc.saveAnswerEntries(setId, segmentsToAnswerEntries(await answerLines(), [0], { 0: '1' }))

    const replacement = await documents.create({ projectId, type: 'text', materialType: 'homework_answer', name: 'answers2.txt', sizeBytes: 0 })
    await documents.update(replacement.id, { status: 'ready' })
    await svc.attachAnswerDocument(setId, replacement.id)

    const mapping = await svc.buildAnswerMapping(setId)
    expect(mapping.manual).toBe(false)
    expect((await repo.getSet(setId))?.answerEntries).toBeUndefined()
  })
})
