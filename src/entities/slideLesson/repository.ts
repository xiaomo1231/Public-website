import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { SlideLesson, SlideLessonKey } from './types'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Persistence for per-slide study records.
 *
 * Every query is scoped by project (and usually document + slide) so one course
 * can never read another's slide material.
 */
export class SlideLessonRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private table() {
    return this.db.table<SlideLesson, string>('slideLessons')
  }

  /** Any stored row for this slide + language, regardless of freshness. */
  async find(key: SlideLessonKey): Promise<SlideLesson | undefined> {
    return this.table()
      .where('[projectId+documentId+slideNumber+language]')
      .equals([key.projectId, key.documentId, key.slideNumber, key.language])
      .first()
  }

  get(id: string): Promise<SlideLesson | undefined> {
    return this.table().get(id)
  }

  listByDocument(documentId: string): Promise<SlideLesson[]> {
    return this.table().where('documentId').equals(documentId).toArray()
  }

  async listByProject(projectId: string): Promise<SlideLesson[]> {
    return this.table().where('projectId').equals(projectId).toArray()
  }

  async upsert(lesson: SlideLesson): Promise<SlideLesson> {
    await this.table().put(lesson)
    return lesson
  }

  /** Patch from the CURRENT row inside a transaction (never clobbers a concurrent write). */
  async update(id: string, patch: Partial<SlideLesson>): Promise<SlideLesson | undefined> {
    return this.db.transaction('rw', this.table(), async () => {
      const existing = await this.table().get(id)
      if (!existing) return undefined
      const next: SlideLesson = { ...existing, ...patch, id, updatedAt: Date.now() }
      await this.table().put(next)
      return next
    })
  }

  async deleteByDocument(documentId: string): Promise<number> {
    return this.table().where('documentId').equals(documentId).delete()
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Slide lessons deleted', { projectId, count })
    return count
  }
}
