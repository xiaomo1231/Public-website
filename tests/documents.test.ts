import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach } from 'vitest'
import { AppDatabase } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProjectRepository } from '@/entities/project/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { ProcessingService } from '@/services/processingService'
import { ProjectService } from '@/services/projectService'
import { DocumentService } from '@/services/documentService'
import { validateFile, detectDocumentType } from '@/infrastructure/files/validation'
import { setDbForTesting } from '@/infrastructure/db/database'

function fresh() {
  return new AppDatabase()
}

describe('DocumentRepository', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = fresh()
    setDbForTesting(db)
  })

  it('creates and lists documents for a project', async () => {
    const repo = new DocumentRepository(db)
    const blob = new Blob(['hello'], { type: 'text/plain' })
    const doc = await repo.create({
      projectId: 'p1',
      type: 'text',
      name: 'Notes.txt',
      sizeBytes: blob.size,
      blob,
    })
    expect(doc.id).toBeTypeOf('string')
    expect(doc.hasBlob).toBe(true)
    expect(doc.status).toBe('uploading')

    const list = await repo.listByProject('p1')
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(doc.id)
  })

  it('isolates documents between projects', async () => {
    const repo = new DocumentRepository(db)
    await repo.create({ projectId: 'p1', type: 'text', name: 'A', sizeBytes: 0 })
    await repo.create({ projectId: 'p2', type: 'text', name: 'B', sizeBytes: 0 })

    const list1 = await repo.listByProject('p1')
    const list2 = await repo.listByProject('p2')
    expect(list1.every((d) => d.projectId === 'p1')).toBe(true)
    expect(list2.every((d) => d.projectId === 'p2')).toBe(true)
    expect(list1).toHaveLength(1)
    expect(list2).toHaveLength(1)
  })

  it('returns blob bytes from the blob table', async () => {
    const repo = new DocumentRepository(db)
    const blob = new Blob(['abc'], { type: 'text/plain' })
    const doc = await repo.create({
      projectId: 'p1',
      type: 'text',
      name: 'X',
      sizeBytes: blob.size,
      blob,
    })
    const round = await repo.getBlob(doc.id)
    expect(round).toBeDefined()
    expect(await (round as Blob).text()).toBe('abc')
  })

  it('cascades delete to chunks and jobs', async () => {
    const repo = new DocumentRepository(db)
    const chunksRepo = new ChunkRepository(db)
    const jobsRepo = new ProcessingJobRepository(db)
    const doc = await repo.create({ projectId: 'p1', type: 'text', name: 'X', sizeBytes: 0 })
    await chunksRepo.addMany([
      {
        documentId: doc.id,
        projectId: 'p1',
        contentType: 'paragraph',
        text: 'hi',
        sourceReference: 'X',
        order: 0,
      },
    ])
    await jobsRepo.create(doc.id, 'p1')

    await repo.delete(doc.id)
    expect(await chunksRepo.listByDocument(doc.id)).toHaveLength(0)
    expect(await jobsRepo.getActiveByDocument(doc.id)).toBeUndefined()
  })

  it('renames a document', async () => {
    const repo = new DocumentRepository(db)
    const doc = await repo.create({ projectId: 'p1', type: 'text', name: 'Old', sizeBytes: 0 })
    const updated = await repo.update(doc.id, { name: 'New' })
    expect(updated.name).toBe('New')
  })

  it('rejects empty names', async () => {
    const repo = new DocumentRepository(db)
    const doc = await repo.create({ projectId: 'p1', type: 'text', name: 'A', sizeBytes: 0 })
    await expect(repo.update(doc.id, { name: '   ' })).rejects.toThrow(/required/i)
  })
})

describe('validateFile', () => {
  it('accepts common PDF mime types', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'book.pdf', { type: 'application/pdf' })
    expect(validateFile(file)).toBe('pdf')
    expect(detectDocumentType(file)).toBe('pdf')
  })

  it('accepts by extension when MIME is missing', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'slides.PPTX', { type: '' })
    expect(detectDocumentType(file)).toBe('pptx')
  })

  it('rejects unknown types', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'weird.xyz', { type: '' })
    expect(detectDocumentType(file)).toBeNull()
    expect(() => validateFile(file)).toThrow(/Unsupported/)
  })

  it('rejects oversized files', () => {
    const big = new File([new Uint8Array(10)], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 200 * 1024 * 1024 })
    expect(() => validateFile(big)).toThrow(/too large/i)
  })
})

describe('ProcessingService + project isolation', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = fresh()
    setDbForTesting(db)
  })

  it('text document processes end-to-end and stores chunks under correct project', async () => {
    const projectsSvc = new ProjectService(db)
    const project = await projectsSvc.create({ name: 'Calc', subject: 'calculus' })

    const documentsRepo = new DocumentRepository(db)
    const chunksRepo = new ChunkRepository(db)
    const jobsRepo = new ProcessingJobRepository(db)
    const documentsSvc = new DocumentService({ documents: documentsRepo, projects: projectsSvc })

    const blob = new Blob(
      ['Chapter 1\nThe derivative measures sensitivity.\n\nChapter 2\nIntegrals accumulate change.'],
      { type: 'text/plain' },
    )
    const doc = await documentsSvc.create({
      projectId: project.id,
      type: 'text',
      name: 'Notes.txt',
      sizeBytes: blob.size,
      blob,
    })
    const processing = new ProcessingService({
      documents: documentsRepo,
      chunks: chunksRepo,
      jobs: jobsRepo,
      projects: projectsSvc,
    })
    await processing.process(doc.id)

    const refreshed = await documentsRepo.get(doc.id)
    expect(refreshed.status).toBe('ready')
    expect(refreshed.chunkCount).toBeGreaterThan(0)

    const chunks = await chunksRepo.listByDocument(doc.id)
    expect(chunks.length).toBe(refreshed.chunkCount)
    expect(chunks.every((c) => c.projectId === project.id)).toBe(true)

    const results = await chunksRepo.searchByProject(project.id, 'derivative')
    expect(results.length).toBeGreaterThan(0)
  })

  it('chunks from one project are not visible to another', async () => {
    const projectsSvc = new ProjectService(db)
    const documentsRepo = new DocumentRepository(db)
    const chunksRepo = new ChunkRepository(db)
    const jobsRepo = new ProcessingJobRepository(db)

    const p1 = await projectsSvc.create({ name: 'P1', subject: 'physics' })
    const p2 = await projectsSvc.create({ name: 'P2', subject: 'cs' })

    const blob1 = new Blob(['P1-only secret xyzzy'], { type: 'text/plain' })
    const blob2 = new Blob(['P2 unrelated content'], { type: 'text/plain' })
    const d1 = await documentsRepo.create({
      projectId: p1.id,
      type: 'text',
      name: 'd1',
      sizeBytes: blob1.size,
      blob: blob1,
    })
    const d2 = await documentsRepo.create({
      projectId: p2.id,
      type: 'text',
      name: 'd2',
      sizeBytes: blob2.size,
      blob: blob2,
    })

    const processing = new ProcessingService({
      documents: documentsRepo,
      chunks: chunksRepo,
      jobs: jobsRepo,
      projects: projectsSvc,
    })
    await processing.process(d1.id)
    await processing.process(d2.id)

    const p1Results = await chunksRepo.searchByProject(p1.id, 'xyzzy')
    expect(p1Results.length).toBeGreaterThan(0)
    const p2Results = await chunksRepo.searchByProject(p2.id, 'xyzzy')
    expect(p2Results.length).toBe(0)
  })

  it('deleting a project removes its documents and chunks', async () => {
    const documentsRepo = new DocumentRepository(db)
    const projectRepo = new ProjectRepository(db)
    const project = await projectRepo.create({ name: 'P', subject: 'cs' })
    await documentsRepo.create({ projectId: project.id, type: 'text', name: 'a', sizeBytes: 0 })
    const count = await documentsRepo.deleteByProject(project.id)
    expect(count).toBe(1)
    expect(await documentsRepo.listByProject(project.id)).toHaveLength(0)
  })
})