import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProjectService } from '@/services/projectService'

describe('ChunkRepository.searchByProject', () => {
  let db: AppDatabase
  let chunks: ChunkRepository
  let projectId: string
  let otherProjectId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    chunks = new ChunkRepository(db)
    const projects = new ProjectService(db)
    projectId = (await projects.create({ name: 'A', subject: 'calculus' })).id
    otherProjectId = (await projects.create({ name: 'B', subject: 'physics' })).id
  })

  async function seed(project: string, texts: string[]) {
    await chunks.addMany(
      texts.map((text, index) => ({
        documentId: 'doc-1',
        projectId: project,
        contentType: 'paragraph' as const,
        text,
        sourceReference: `doc-1#${index}`,
        order: index,
      })),
    )
  }

  it('finds case-insensitive substring matches', async () => {
    await seed(projectId, ['The DERIVATIVE of x^2', 'Integrals accumulate change'])
    const results = await chunks.searchByProject(projectId, 'derivative')
    expect(results).toHaveLength(1)
    expect(results[0]!.text).toContain('DERIVATIVE')
  })

  it('returns an empty array for an empty query', async () => {
    await seed(projectId, ['anything'])
    expect(await chunks.searchByProject(projectId, '')).toEqual([])
    expect(await chunks.searchByProject(projectId, '   ')).toEqual([])
  })

  it('returns an empty array for a non-positive limit', async () => {
    await seed(projectId, ['match me'])
    expect(await chunks.searchByProject(projectId, 'match', 0)).toEqual([])
    expect(await chunks.searchByProject(projectId, 'match', -1)).toEqual([])
  })

  it('respects the limit and stops scanning early', async () => {
    await seed(
      projectId,
      Array.from({ length: 200 }, (_, i) => `match number ${i}`),
    )
    const results = await chunks.searchByProject(projectId, 'match', 5)
    expect(results).toHaveLength(5)
  })

  it('returns matches ordered by their position in the document', async () => {
    await seed(projectId, ['no', 'match two', 'no', 'match four'])
    const results = await chunks.searchByProject(projectId, 'match')
    expect(results.map((c) => c.order)).toEqual([1, 3])
  })

  it('never returns chunks from another project', async () => {
    await seed(projectId, ['shared keyword here'])
    await seed(otherProjectId, ['shared keyword there'])
    const results = await chunks.searchByProject(projectId, 'shared')
    expect(results).toHaveLength(1)
    expect(results[0]!.projectId).toBe(projectId)
  })

  it('returns an empty array when nothing matches', async () => {
    await seed(projectId, ['alpha', 'beta'])
    expect(await chunks.searchByProject(projectId, 'gamma')).toEqual([])
  })
})
