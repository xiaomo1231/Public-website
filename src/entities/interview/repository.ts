import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { logger } from '@/infrastructure/logger/logger'
import type { InterviewSession } from './types'

/** Patient interview sessions, scoped by project. */
export class InterviewSessionRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private table() {
    return this.db.table<InterviewSession, string>('interviewSessions')
  }

  /** Most recently updated first. */
  async listByProject(projectId: string): Promise<InterviewSession[]> {
    const rows = await this.table()
      .where('[projectId+updatedAt]')
      .between([projectId, -Infinity], [projectId, Infinity])
      .toArray()
    return rows.reverse()
  }

  get(id: string): Promise<InterviewSession | undefined> {
    return this.table().get(id)
  }

  async put(session: InterviewSession): Promise<InterviewSession> {
    await this.table().put(session)
    return session
  }

  async delete(id: string): Promise<void> {
    await this.table().delete(id)
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Interview sessions deleted', { projectId, count })
    return count
  }
}
