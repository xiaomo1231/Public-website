import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { MistakeService } from '@/services/mistakeService'
import { useProjectStore } from '@/features/project/projectStore'

describe('projectStore.remove', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    useProjectStore.getState().reset()
  })

  it('deletes every row that belongs to the project, not only the project row', async () => {
    const projects = new ProjectService(db)
    const keep = await projects.create({ name: 'Keep', subject: 'cs' })
    const p = await projects.create({ name: 'Gone', subject: 'cs' })
    for (const projectId of [p.id, keep.id]) {
      await new DocumentRepository(db).create({
        projectId,
        type: 'text',
        name: 'a.txt',
        sizeBytes: 5,
        blob: new Blob(['hello'], { type: 'text/plain' }),
      })
      await new MistakeService(db).addManual({
        projectId,
        question: 'Q',
        studentAnswer: 'a',
        correctAnswer: 'b',
        knowledgePoint: 'KP',
      })
    }
    await db.vocabBooks.put({
      id: 'course-book',
      projectId: p.id,
      kind: 'course',
      name: 'Gone words',
      createdAt: 1,
      updatedAt: 1,
    } as never)
    await db.user.put({
      ...((await db.user.get('singleton')) ?? { id: 'singleton' }),
      vocabBookId: 'course-book',
    } as never)

    await useProjectStore.getState().load()
    await useProjectStore.getState().remove(p.id)

    expect(useProjectStore.getState().projects.map((x) => x.id)).toEqual([keep.id])
    expect(await db.projects.get(p.id)).toBeUndefined()
    expect(await db.documents.where('projectId').equals(p.id).count()).toBe(0)
    expect(await db.documentBlobs.where('projectId').equals(p.id).count()).toBe(0)
    expect(await db.mistakes.where('projectId').equals(p.id).count()).toBe(0)
    expect(await db.vocabBooks.where('projectId').equals(p.id).count()).toBe(0)
    expect((await db.user.get('singleton'))?.vocabBookId).toBe('')
    // The other project is untouched.
    expect(await db.documents.where('projectId').equals(keep.id).count()).toBe(1)
    expect(await db.mistakes.where('projectId').equals(keep.id).count()).toBe(1)
  })
})
