import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { ProjectService } from '@/services/projectService'
import { DocumentService } from '@/services/documentService'
import { HomeworkProofreadService } from '@/services/homeworkProofreadService'
import { runDocumentBatch, type DocumentBatchDeps } from '@/features/documents/documentBatch'
import type { Document, LearningMaterialType } from '@/entities/document/types'
import type { HomeworkSet } from '@/entities/homework/types'
import type { CourseStructure } from '@/entities/courseStructure/types'

/**
 * Batch file actions (2o): each file goes through its single-file path in its
 * own transaction; protected files are skipped with a reason and never stop
 * the others; stopping leaves the rest untouched.
 */
describe('runDocumentBatch', () => {
  let db: AppDatabase
  let documents: DocumentRepository
  let chunks: ChunkRepository
  let homework: HomeworkRepository
  let service: DocumentService
  let reprocess: ReturnType<typeof vi.fn>
  let deps: DocumentBatchDeps

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    documents = new DocumentRepository(db)
    chunks = new ChunkRepository(db)
    homework = new HomeworkRepository(db)
    service = new DocumentService({
      documents,
      projects: new ProjectService(db),
      db,
      chunks,
      homework,
    })
    reprocess = vi.fn(async () => undefined)
    deps = {
      documents: service,
      reprocess,
      setEvalRole: (id, role) => new HomeworkProofreadService({ db }).setDocumentEvalRole(id, role),
      analyze: vi.fn(),
    }
  })

  async function makeDoc(
    projectId: string,
    name: string,
    materialType: LearningMaterialType,
    over: { hasBlob?: boolean } = {},
  ): Promise<Document> {
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType,
      name,
      sizeBytes: 10,
      ...(over.hasBlob === false ? {} : { blob: new Blob(['0123456789']) }),
    })
    await documents.update(doc.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        materialType,
        pageNumber: 1,
        contentType: 'paragraph',
        text: 'Topics of the examination\n1. The heart\n2. The lungs',
        sourceReference: `${name} · Page 1`,
        order: 0,
        chapterId: 'ch1',
      },
    ])
    return documents.get(doc.id)
  }

  async function addHomework(doc: Document, withWork: boolean): Promise<void> {
    const now = Date.now()
    const set: HomeworkSet = {
      id: crypto.randomUUID(),
      projectId: doc.projectId,
      documentId: doc.id,
      documentName: doc.name,
      title: 'Homework',
      status: 'ready',
      language: 'en',
      questionCount: 1,
      promptVersion: 'v1',
      createdAt: now,
      updatedAt: now,
    }
    await homework.upsertSet(set)
    await homework.upsertQuestion({
      id: crypto.randomUUID(),
      projectId: doc.projectId,
      setId: set.id,
      documentId: doc.id,
      documentName: doc.name,
      order: 0,
      prompt: 'Solve it.',
      sourceRefs: [],
      hints: [],
      solution: 's',
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: withWork ? 'my working' : '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: now,
      updatedAt: now,
    })
  }

  it('deletes unprotected files and skips files with student work, listing the reason', async () => {
    const free = await makeDoc('p1', 'notes.pdf', 'textbook')
    const protectedDoc = await makeDoc('p1', 'hw1.pdf', 'homework')
    await addHomework(protectedDoc, true)
    const other = await makeDoc('p2', 'slides.pdf', 'textbook')

    const result = await runDocumentBatch([free, protectedDoc, other], { kind: 'delete' }, { deps })

    expect(result.done).toBe(2)
    expect(result.skipped).toBe(1)
    const skipped = result.outcomes.find((o) => o.status === 'skipped')!
    expect(skipped.document.id).toBe(protectedDoc.id)
    expect(skipped.reason).toMatch(/homework/i)
    expect(await db.documents.get(free.id)).toBeUndefined()
    expect(await db.documents.get(other.id)).toBeUndefined()
    expect(await db.documents.get(protectedDoc.id)).toBeDefined()
    expect(result.projectIds.sort()).toEqual(['p1', 'p2'])
  })

  it('changes the material type: chunks follow, textbook structure removed, syllabus parsed', async () => {
    const book = await makeDoc('p1', 'topics.pdf', 'textbook')
    const structure = {
      id: 's1',
      projectId: 'p1',
      sourceDocumentId: book.id,
    } as unknown as CourseStructure
    await db.courseStructures.put(structure)

    const result = await runDocumentBatch(
      [book],
      { kind: 'materialType', materialType: 'syllabus' },
      { deps },
    )

    expect(result.done).toBe(1)
    const stored = await db.documents.get(book.id)
    expect(stored?.materialType).toBe('syllabus')
    expect(stored?.syllabus?.method).toBe('local')
    const storedChunks = await db.chunks.where('documentId').equals(book.id).toArray()
    expect(storedChunks.every((c) => c.materialType === 'syllabus')).toBe(true)
    expect(storedChunks[0]?.chapterId).toBeUndefined()
    expect(await db.courseStructures.get('s1')).toBeUndefined()
    expect(reprocess).not.toHaveBeenCalled()
  })

  it('keeps the type of a file with student work and removes derived sets otherwise', async () => {
    const withWork = await makeDoc('p1', 'hw1.pdf', 'homework')
    await addHomework(withWork, true)
    const without = await makeDoc('p1', 'hw2.pdf', 'homework')
    await addHomework(without, false)

    const result = await runDocumentBatch(
      [withWork, without],
      { kind: 'materialType', materialType: 'past_exam' },
      { deps },
    )

    expect(result.outcomes.map((o) => o.status)).toEqual(['skipped', 'done'])
    expect((await db.documents.get(withWork.id))?.materialType).toBe('homework')
    expect((await db.documents.get(without.id))?.materialType).toBe('past_exam')
    expect(await db.homeworkSets.where('documentId').equals(without.id).count()).toBe(0)
    expect(await db.homeworkSets.where('documentId').equals(withWork.id).count()).toBe(1)
  })

  it('reprocesses a file that becomes a textbook', async () => {
    const notes = await makeDoc('p1', 'notes.pdf', 'user_notes')
    await runDocumentBatch([notes], { kind: 'materialType', materialType: 'textbook' }, { deps })
    expect(reprocess).toHaveBeenCalledWith(notes.id)
    expect(deps.analyze).toHaveBeenCalledWith('p1')
  })

  it('moves files into a folder of their own course only', async () => {
    const a = await makeDoc('p1', 'a.pdf', 'textbook')
    const b = await makeDoc('p2', 'b.pdf', 'textbook')
    const result = await runDocumentBatch(
      [a, b],
      { kind: 'folder', folderPath: ' Week 3 / Slides ' },
      {
        deps,
      },
    )
    expect(result.done).toBe(2)
    const [sa, sb] = [await db.documents.get(a.id), await db.documents.get(b.id)]
    expect(sa?.folderPath).toBe('Week 3/Slides')
    expect(sb?.folderPath).toBe('Week 3/Slides')
    // No cross-course move: each file stays in its course.
    expect(sa?.projectId).toBe('p1')
    expect(sb?.projectId).toBe('p2')
  })

  it('reprocesses stored files and skips files without bytes', async () => {
    const stored = await makeDoc('p1', 'a.pdf', 'textbook')
    const pasted = await makeDoc('p1', 'pasted.txt', 'user_notes', { hasBlob: false })
    const result = await runDocumentBatch([stored, pasted], { kind: 'reprocess' }, { deps })
    expect(reprocess).toHaveBeenCalledTimes(1)
    expect(reprocess).toHaveBeenCalledWith(stored.id)
    expect(result.outcomes[1]?.status).toBe('skipped')
    expect(deps.analyze).toHaveBeenCalledTimes(1)
  })

  it('sets the evaluation role on the files and their chunks', async () => {
    const a = await makeDoc('p1', 'a.pdf', 'past_exam')
    await runDocumentBatch([a], { kind: 'evalRole', evalRole: 'independent' }, { deps })
    expect((await db.documents.get(a.id))?.evalRole).toBe('independent')
    const stored = await db.chunks.where('documentId').equals(a.id).toArray()
    expect(stored.every((c) => c.evalRole === 'independent')).toBe(true)
    await runDocumentBatch([a], { kind: 'evalRole', evalRole: undefined }, { deps })
    expect((await db.documents.get(a.id))?.evalRole).toBeUndefined()
  })

  it('stops before the next file; the rest are not run', async () => {
    const files = [
      await makeDoc('p1', 'a.pdf', 'textbook'),
      await makeDoc('p1', 'b.pdf', 'textbook'),
      await makeDoc('p1', 'c.pdf', 'textbook'),
    ]
    let calls = 0
    const result = await runDocumentBatch(
      files,
      { kind: 'folder', folderPath: 'X' },
      { deps, shouldContinue: () => calls++ < 1 },
    )
    expect(result.stopped).toBe(true)
    expect(result.outcomes.map((o) => o.status)).toEqual(['done', 'not-run', 'not-run'])
    expect((await db.documents.get(files[1]!.id))?.folderPath).toBeUndefined()
  })
})
