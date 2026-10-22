import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { courseContextId, keepStoredQuestionHabits, type CourseContext } from './types'
import type { QuestionHabitsProfile } from '@/entities/questionHabits/types'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Persistence for the derived course context (professor profile, class
 * progress, note/lecture links, question habits). One row per project.
 */
export class CourseContextRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private table() {
    return this.db.table<CourseContext, string>('courseContexts')
  }

  async get(projectId: string): Promise<CourseContext | undefined> {
    return this.table().get(courseContextId(projectId))
  }

  /**
   * Write the row. The question-habit profile is not taken from `context`:
   * the stored one is kept (see `updateQuestionHabits`).
   */
  async upsert(context: CourseContext): Promise<CourseContext> {
    return this.db.transaction('rw', this.table(), async () => {
      const stored = await this.table().get(context.id)
      const next = keepStoredQuestionHabits(context, stored)
      await this.table().put(next)
      return next
    })
  }

  /**
   * Read-modify-write the question-habit profile in one transaction (the row
   * is created when the course has none yet). `update` returning `undefined`
   * removes the profile.
   */
  async updateQuestionHabits(
    projectId: string,
    update: (current: QuestionHabitsProfile | undefined) => QuestionHabitsProfile | undefined,
  ): Promise<QuestionHabitsProfile | undefined> {
    return this.db.transaction('rw', this.table(), async () => {
      const id = courseContextId(projectId)
      const stored = await this.table().get(id)
      const next = update(stored?.questionHabits)
      const base: CourseContext = stored ?? {
        id,
        projectId,
        noteLinks: [],
        lectureLinks: [],
        sourceHash: '',
        updatedAt: Date.now(),
      }
      const { questionHabits: _old, ...rest } = base
      void _old
      await this.table().put(next ? { ...rest, questionHabits: next } : rest)
      return next
    })
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Course context deleted', { projectId, count })
    return count
  }
}
