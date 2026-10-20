import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { recoverInterruptedAnalyses } from '@/services/courseContentService'
import type { CourseAnalysis } from '@/entities/courseAnalysis/types'

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

const row = (id: string, status: CourseAnalysis['status'], startedAt: number): CourseAnalysis =>
  ({
    id,
    projectId: `p-${id}`,
    status,
    language: 'en',
    progress: 0.3,
    documentIds: [],
    topicCount: 0,
    formulaCount: 0,
    symbolCount: 0,
    startedAt,
    promptVersion: 'v',
  }) as CourseAnalysis

describe('interrupted course analysis', () => {
  it('marks old unfinished runs as failed and leaves recent and finished ones alone', async () => {
    const now = 10 * 60 * 60_000
    await db.courseAnalyses.bulkPut([
      row('old', 'analyzing', now - 30 * 60_000),
      row('recent', 'analyzing', now - 60_000),
      row('done', 'ready', now - 30 * 60_000),
    ])
    expect(await recoverInterruptedAnalyses(db, now)).toBe(1)
    expect(await db.courseAnalyses.get('old')).toMatchObject({ status: 'failed', finishedAt: now })
    expect((await db.courseAnalyses.get('old'))!.errorMessage).toBeTruthy()
    expect((await db.courseAnalyses.get('recent'))!.status).toBe('analyzing')
    expect((await db.courseAnalyses.get('done'))!.status).toBe('ready')
  })
})
