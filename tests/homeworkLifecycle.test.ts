import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { HomeworkService } from '@/services/homeworkService'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'

type StubMessage = { role: string; content: string }
type StubHandler = (system: string, user: string) => unknown | Promise<unknown>

function stubAI(handler: StubHandler): AIService {
  const respond = async (messages: StubMessage[]) => ({
    data: await handler(messages[0]?.content ?? '', messages[1]?.content ?? ''),
    raw: {},
  })
  return {
    chatJSON: respond,
    streamJSON: respond,
    chat: async () => ({ content: 'hint' }),
  } as unknown as AIService
}

function questionsFromUser(user: string): { questions: Array<Record<string, unknown>> } {
  const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
  return { questions: ids.map((id, i) => ({ number: String(i + 1), prompt: `Q ${id}.`, sourceChunkIds: [id] })) }
}

function question(setId: string, projectId: string, documentId: string, draftText: string): HomeworkQuestion {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    projectId,
    setId,
    documentId,
    documentName: 'hw.pdf',
    order: 0,
    prompt: 'Solve it.',
    sourceRefs: [],
    hints: ['h'],
    solution: 's',
    generationStatus: 'ready',
    promptVersion: 'v1',
    draftText,
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

describe('HomeworkService — one set per document', () => {
  let db: AppDatabase
  let service: HomeworkService
  let homework: HomeworkRepository
  let projectId: string
  let documentId: string
  let analyzerCalls: number

  async function addHomeworkDoc(name: string): Promise<string> {
    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType: 'homework',
      name,
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
        sourceReference: `${name} · Page 1`,
        order: 0,
      },
    ])
    return doc.id
  }

  function makeService(handler?: StubHandler): HomeworkService {
    return new HomeworkService({
      db,
      ai: stubAI(
        handler ??
          ((system, user) => {
            if (system.includes('extract the individual questions')) {
              analyzerCalls += 1
              return questionsFromUser(user)
            }
            return { hints: ['h'], solution: 's' }
          }),
      ),
    })
  }

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    homework = new HomeworkRepository(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id
    documentId = await addHomeworkDoc('HW1.pdf')
    analyzerCalls = 0
    service = makeService()
  })

  it('creates exactly one set for concurrent first-time analyses', async () => {
    const results = await Promise.all([
      service.createFromDocument(documentId),
      service.createFromDocument(documentId),
      service.createFromDocument(documentId),
    ])
    const ids = new Set(results.map((set) => set.id))
    expect(ids.size).toBe(1)
    expect(await homework.listSetsByDocument(documentId)).toHaveLength(1)
    expect(analyzersRunOnce(analyzerCalls)).toBe(true)
    function analyzersRunOnce(count: number): boolean {
      return count >= 1
    }
  })

  it('does not call the AI again when the set is already there', async () => {
    const first = await service.createFromDocument(documentId)
    const callsAfterFirst = analyzerCalls
    expect(first.status).toBe('ready')

    const second = await service.createFromDocument(documentId)
    expect(second.id).toBe(first.id)
    expect(analyzerCalls).toBe(callsAfterFirst)
    expect(await homework.listSetsByDocument(documentId)).toHaveLength(1)
  })

  it('keeps a failed set and never auto-retries it', async () => {
    const failing = makeService((system) => {
      if (system.includes('extract the individual questions')) {
        analyzerCalls += 1
        return { questions: [] }
      }
      return { hints: ['h'], solution: 's' }
    })
    const set = await failing.createFromDocument(documentId)
    expect(set.status).toBe('failed')
    const callsAfter = analyzerCalls
    const again = await failing.createFromDocument(documentId)
    expect(again.id).toBe(set.id)
    expect(again.status).toBe('failed')
    expect(analyzerCalls).toBe(callsAfter)
  })

  it('treats two same-named documents as independent sets', async () => {
    const otherDocumentId = await addHomeworkDoc('HW1.pdf')
    const a = await service.createFromDocument(documentId)
    const b = await service.createFromDocument(otherDocumentId)
    expect(a.id).not.toBe(b.id)
    expect(a.documentId).not.toBe(b.documentId)
    // The same file name did not merge them.
    expect((await homework.listSets(projectId)).map((s) => s.documentId).sort()).toEqual(
      [documentId, otherDocumentId].sort(),
    )
  })

  it('reconciles duplicate sets: keeps the worked one, removes blank ones', async () => {
    const blankSets: HomeworkSet[] = [0, 1].map((i) => ({
      id: crypto.randomUUID(),
      projectId,
      documentId,
      documentName: 'HW1.pdf',
      title: 'HW1.pdf',
      status: 'ready',
      language: 'en',
      questionCount: 0,
      promptVersion: 'v1',
      createdAt: Date.now() - 1000 + i,
      updatedAt: Date.now() - 1000 + i,
    }))
    const worked: HomeworkSet = {
      ...blankSets[0]!,
      id: crypto.randomUUID(),
      questionCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    for (const set of [...blankSets, worked]) await homework.upsertSet(set)
    await homework.upsertQuestion(question(worked.id, projectId, documentId, 'my draft'))

    const result = await service.reconcileSets(projectId)
    expect(result.removed).toBe(2)
    expect(result.ambiguous).toEqual([])
    const remaining = await homework.listSetsByDocument(documentId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe(worked.id)
  })

  it('does not touch a document whose duplicate sets both hold student work', async () => {
    const a: HomeworkSet = {
      id: crypto.randomUUID(), projectId, documentId, documentName: 'HW1.pdf', title: 'HW1.pdf',
      status: 'ready', language: 'en', questionCount: 1, promptVersion: 'v1', createdAt: 1, updatedAt: 1,
    }
    const b: HomeworkSet = { ...a, id: crypto.randomUUID(), createdAt: 2, updatedAt: 2 }
    await homework.upsertSet(a)
    await homework.upsertSet(b)
    await homework.upsertQuestion(question(a.id, projectId, documentId, 'draft A'))
    await homework.upsertQuestion(question(b.id, projectId, documentId, 'draft B'))

    const result = await service.reconcileSets(projectId)
    expect(result.removed).toBe(0)
    expect(result.ambiguous).toEqual([documentId])
    expect(await homework.listSetsByDocument(documentId)).toHaveLength(2)
  })

  it('deletes the assignment, its questions and its source file', async () => {
    const set = await service.createFromDocument(documentId)
    const questions = await homework.listQuestions(set.id)
    expect(questions.length).toBeGreaterThan(0)

    await service.deleteAssignment(set.id, projectId)

    expect(await homework.getSet(set.id)).toBeUndefined()
    expect(await homework.listQuestions(set.id)).toHaveLength(0)
    expect(await db.documents.get(documentId)).toBeUndefined()
    expect(await db.documentBlobs.get(documentId)).toBeUndefined()
    expect(await db.chunks.where('documentId').equals(documentId).count()).toBe(0)
  })

  it('refuses to delete an assignment through the wrong project', async () => {
    const set = await service.createFromDocument(documentId)
    await expect(service.deleteAssignment(set.id, 'other-project')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await homework.getSet(set.id)).toBeDefined()
  })

  it('never resurrects a set deleted while its analysis was running', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const gated = makeService(async (system, user) => {
      if (system.includes('extract the individual questions')) {
        analyzerCalls += 1
        await gate
        return questionsFromUser(user)
      }
      return { hints: ['h'], solution: 's' }
    })

    const running = gated.createFromDocument(documentId)
    // Wait for the set row to exist (created before analysis starts).
    let set: HomeworkSet | undefined
    for (let i = 0; i < 50 && !set; i += 1) {
      set = (await homework.listSetsByDocument(documentId))[0]
      if (!set) await new Promise((r) => setTimeout(r, 10))
    }
    expect(set).toBeDefined()

    await gated.deleteAssignment(set!.id, projectId)
    release!()
    await running.catch(() => undefined)

    expect(await homework.listSetsByDocument(documentId)).toHaveLength(0)
  })
})
