import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DataManagementService } from '@/services/dataManagementService'
import { ProjectService } from '@/services/projectService'

/**
 * Every table indexed by `projectId` must be emptied for a deleted project and
 * left alone for the others — including tables added after this test.
 */
describe('deleteProject covers every project table', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('removes the project rows of every table and keeps other projects', async () => {
    const projects = new ProjectService(db)
    const doomed = await projects.create({ name: 'Doomed', subject: 'cs' })
    const kept = await projects.create({ name: 'Kept', subject: 'cs' })
    const tables = db.tables.filter(
      (table) =>
        table.name !== 'projects' && table.schema.indexes.some((i) => i.name === 'projectId'),
    )
    expect(tables.length).toBeGreaterThanOrEqual(40)
    for (const table of tables) {
      for (const project of [doomed, kept]) {
        await table.put({
          id: `${table.name}-${project.id}`,
          projectId: project.id,
          documentId: `doc-${project.id}`,
          setId: `set-${project.id}`,
          structureId: `structure-${project.id}`,
          bookId: `book-${project.id}`,
          questionId: `q-${project.id}`,
          topicId: `topic-${project.id}`,
          createdAt: 1,
          updatedAt: 1,
          order: 0,
        })
      }
    }

    await new DataManagementService(db).deleteProject(doomed.id)

    const leftovers: string[] = []
    const lost: string[] = []
    for (const table of tables) {
      if ((await table.where('projectId').equals(doomed.id).count()) > 0) leftovers.push(table.name)
      if ((await table.where('projectId').equals(kept.id).count()) === 0) lost.push(table.name)
    }
    expect(leftovers).toEqual([])
    expect(lost).toEqual([])
    expect(await db.table('projects').get(kept.id)).toBeTruthy()
  })
})
