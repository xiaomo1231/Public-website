import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { courseContextId, type CourseContext } from './types'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Persistence for the derived course context (professor profile, class
 * progress, note/lecture links). One row per project.
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

  async upsert(context: CourseContext): Promise<CourseContext> {
    await this.table().put(context)
    return context
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Course context deleted', { projectId, count })
    return count
  }
}
