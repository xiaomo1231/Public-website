import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { PracticeRepository } from '@/entities/practice/repository'
import { ProjectService } from '@/services/projectService'
import { DocumentService } from '@/services/documentService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { PracticeAttempt, PracticeQuestion, PracticeSet } from '@/entities/practice/types'

/**
 * Deleting a project file must clean up what was derived from it and must
 * never silently destroy the learner's own work. These tests pin the impact
 * summary, the guard, the cross-project isolation and the rollback shape.
 */
describe('DocumentService — project file deletion', () => {
  let db: AppDatabase
  let documents: DocumentRepository
  let service: DocumentService
  let chunks: ChunkRepository
  let homework: HomeworkRepository
  let practice: PracticeRepository

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    documents = new DocumentRepository(db)
    chunks = new ChunkRepository(db)
    homework = new HomeworkRepository(db)
    practice = new PracticeRepository(db)
    const projects = new ProjectService(db)
    service = new DocumentService({ documents, projects, db, chunks, homework, practice })
  })

  async function makeDoc(projectId: string, materialType: 'textbook' | 'homework' | 'professor_practice') {
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType,
      name: `${materialType}.pdf`,
      sizeBytes: 10,
      blob: new Blob(['0123456789'], { type: 'text/plain' }),
    })
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        materialType,
        pageNumber: 1,
        contentType: 'paragraph',
        text: 'one passage',
        sourceReference: `${doc.name} · Page 1`,
        order: 0,
      },
    ])
    return doc
  }

  function hwQuestion(setId: string, documentId: string, over: Partial<HomeworkQuestion> = {}): HomeworkQuestion {
    const now = Date.now()
    return {
      id: crypto.randomUUID(),
      projectId: 'p1',
      setId,
      documentId,
      documentName: 'homework.pdf',
      order: 0,
      prompt: 'Solve it.',
      sourceRefs: [],
      hints: ['h'],
      solution: 's',
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: now,
      updatedAt: now,
      ...over,
    }
  }

  async function makeHomework(documentId: string, withWork: boolean): Promise<HomeworkSet> {
    const now = Date.now()
    const set: HomeworkSet = {
      id: crypto.randomUUID(),
      projectId: 'p1',
      documentId,
      documentName: 'homework.pdf',
      title: 'Homework',
      status: 'ready',
      language: 'en',
      questionCount: 1,
      promptVersion: 'v1',
      createdAt: now,
      updatedAt: now,
    }
    await homework.upsertSet(set)
    await homework.upsertQuestion(
      hwQuestion(set.id, documentId, withWork ? { draftText: 'my working' } : {}),
    )
    return set
  }

  async function makePractice(documentId: string, withAttempt: boolean): Promise<PracticeSet> {
    const now = Date.now()
    const set: PracticeSet = {
      id: crypto.randomUUID(),
      projectId: 'p1',
      documentId,
      documentName: 'practice.pdf',
      name: 'Practice',
      questionCount: 1,
      sourceHash: 'x',
      createdAt: now,
      updatedAt: now,
    }
    await practice.upsertSet(set)
    const question: PracticeQuestion = {
      id: crypto.randomUUID(),
      projectId: 'p1',
      setId: set.id,
      documentId,
      documentName: 'practice.pdf',
      order: 0,
      type: 'numeric',
      prompt: 'Compute.',
      options: [],
      answerSource: 'professor',
      confidence: 0.9,
      status: 'verified',
      createdAt: now,
    }
    await practice.addQuestions([question])
    if (withAttempt) {
      const attempt: PracticeAttempt = {
        id: crypto.randomUUID(),
        projectId: 'p1',
        setId: set.id,
        questionId: question.id,
        userAnswer: '42',
        attemptNumber: 1,
        submittedAt: now,
      }
      await practice.addAttempt(attempt)
    }
    return set
  }

  it('reports what a textbook file would remove and is not blocked', async () => {
    const doc = await makeDoc('p1', 'textbook')
    const impact = await service.getDeleteImpact(doc.id, 'p1')
    expect(impact.blocked).toBe(false)
    expect(impact.removes.chunks).toBe(1)
    expect(impact.removes.homeworkSets).toBe(0)
    expect(impact.document.id).toBe(doc.id)
  })

  it('deletes the file and its derived rows when there is no student work', async () => {
    const doc = await makeDoc('p1', 'homework')
    const set = await makeHomework(doc.id, false)

    const impact = await service.getDeleteImpact(doc.id, 'p1')
    expect(impact.removes.chunks).toBe(1)
    expect(impact.removes.homeworkSets).toBe(1)
    expect(impact.removes.homeworkQuestions).toBe(1)
    expect(impact.blocked).toBe(false)

    await service.delete(doc.id, 'p1')

    expect(await db.documents.get(doc.id)).toBeUndefined()
    expect(await db.documentBlobs.get(doc.id)).toBeUndefined()
    expect(await chunks.countByDocument(doc.id)).toBe(0)
    expect(await homework.getSet(set.id)).toBeUndefined()
  })

  it('blocks the delete when the homework set holds saved work, changing nothing', async () => {
    const doc = await makeDoc('p1', 'homework')
    const set = await makeHomework(doc.id, true)

    const impact = await service.getDeleteImpact(doc.id, 'p1')
    expect(impact.blocked).toBe(true)
    expect(impact.studentWork.homeworkAnswers).toBe(1)

    await expect(service.delete(doc.id, 'p1')).rejects.toMatchObject({ code: 'FILE_IN_USE' })

    // Nothing was removed — not the document, not the derived rows.
    expect(await db.documents.get(doc.id)).toBeDefined()
    expect(await homework.getSet(set.id)).toBeDefined()
    expect(await chunks.countByDocument(doc.id)).toBe(1)
  })

  it('blocks the delete when a practice attempt exists', async () => {
    const doc = await makeDoc('p1', 'professor_practice')
    const set = await makePractice(doc.id, true)

    const impact = await service.getDeleteImpact(doc.id, 'p1')
    expect(impact.blocked).toBe(true)
    expect(impact.studentWork.practiceAttempts).toBe(1)

    await expect(service.delete(doc.id, 'p1')).rejects.toMatchObject({ code: 'FILE_IN_USE' })
    expect(await db.documents.get(doc.id)).toBeDefined()
    expect(await practice.getSet(set.id)).toBeDefined()
  })

  it('deletes an unattempted practice file and its derived rows', async () => {
    const doc = await makeDoc('p1', 'professor_practice')
    const set = await makePractice(doc.id, false)
    await service.delete(doc.id, 'p1')
    expect(await db.documents.get(doc.id)).toBeUndefined()
    expect(await practice.getSet(set.id)).toBeUndefined()
  })

  it('refuses to delete a document through the wrong project', async () => {
    const doc = await makeDoc('p1', 'textbook')
    await expect(service.delete(doc.id, 'p2')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await db.documents.get(doc.id)).toBeDefined()
  })

  it('lets the same file be uploaded again after it is deleted', async () => {
    const first = await makeDoc('p1', 'homework')
    await service.delete(first.id, 'p1')
    const remaining = await documents.listByProject('p1')
    expect(remaining.some((d) => d.name === first.name)).toBe(false)

    const second = await documents.create({
      projectId: 'p1',
      type: 'text',
      materialType: 'homework',
      name: 'homework.pdf',
      sizeBytes: 10,
    })
    expect(second.id).not.toBe(first.id)
    expect((await documents.listByProject('p1')).filter((d) => d.name === 'homework.pdf')).toHaveLength(1)
  })
})
