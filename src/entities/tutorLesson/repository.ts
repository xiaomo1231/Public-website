import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { TutorLesson, TutorLessonKey } from './types'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Persistence for cached teaching lessons.
 *
 * Lookups are always scoped by project + topic + language so two topics can
 * never serve each other's content.
 */
export class TutorLessonRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private table() {
    return this.db.table<TutorLesson, string>('tutorLessons')
  }

  /** Any stored lesson for this topic + language, regardless of freshness. */
  async find(key: TutorLessonKey): Promise<TutorLesson | undefined> {
    return this.table()
      .where('[projectId+topicId+language]')
      .equals([key.projectId, key.topicId, key.language])
      .first()
  }

  async listByProject(projectId: string): Promise<TutorLesson[]> {
    return this.table().where('projectId').equals(projectId).toArray()
  }

  async upsert(lesson: TutorLesson): Promise<TutorLesson> {
    await this.table().put(lesson)
    return lesson
  }

  async deleteByTopic(key: TutorLessonKey): Promise<number> {
    const existing = await this.find(key)
    if (!existing) return 0
    await this.table().delete(existing.id)
    return 1
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Tutor lessons deleted', { projectId, count })
    return count
  }
}
