import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DataManagementService } from '@/services/dataManagementService'
import { DocumentService } from '@/services/documentService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { SlideLessonRepository } from '@/entities/slideLesson/repository'
import type { SlideLesson } from '@/entities/slideLesson/types'

function slideLesson(projectId: string, documentId: string): SlideLesson {
  return {
    id: crypto.randomUUID(),
    projectId,
    documentId,
    documentName: 'deck.pptx',
    slideNumber: 1,
    slideTotal: 3,
    language: 'en',
    status: 'ready',
    content: 'A limit.',
    question: 'Why?',
    symbols: [],
    sourceChunkIds: [],
    sourceRefs: [],
    messages: [{ id: 'm1', role: 'student', content: 'hi', createdAt: 1 }],
    contentHash: 'h',
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
    version: 1,
  }
}

describe('SlideLesson lifecycle', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('is included in the data export', async () => {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'P', subject: 'cs' })
    await new SlideLessonRepository(db).upsert(slideLesson(project.id, 'doc1'))

    const exported = await new DataManagementService(db).exportAll()
    expect(Array.isArray(exported.json.slideLessons)).toBe(true)
    expect((exported.json.slideLessons as unknown[]).length).toBe(1)
  })

  it('is removed when its project is deleted', async () => {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'P', subject: 'cs' })
    const repo = new SlideLessonRepository(db)
    await repo.upsert(slideLesson(project.id, 'doc1'))

    await new DataManagementService(db).deleteProject(project.id)
    expect(await db.slideLessons.count()).toBe(0)
  })

  it('is removed with its document, and the impact reports it', async () => {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'P', subject: 'cs' })
    const documents = new DocumentRepository(db)
    const doc = await documents.create({ projectId: project.id, type: 'pptx', name: 'deck.pptx', sizeBytes: 0 })
    await new SlideLessonRepository(db).upsert(slideLesson(project.id, doc.id))

    const service = new DocumentService({ documents, projects, db })
    const impact = await service.getDeleteImpact(doc.id)
    expect(impact.removes.slideLessons).toBe(1)

    await service.delete(doc.id)
    expect(await db.slideLessons.where('documentId').equals(doc.id).count()).toBe(0)
  })
})
