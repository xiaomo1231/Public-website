import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { TutorSession } from './types'
import { logger } from '@/infrastructure/logger/logger'

export class TutorSessionRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async get(id: string): Promise<TutorSession | undefined> {
    return this.db.table<TutorSession, string>('tutorSessions').get(id)
  }

  async listByProject(projectId: string): Promise<TutorSession[]> {
    return this.db.table<TutorSession, string>('tutorSessions').where('projectId').equals(projectId).reverse().sortBy('updatedAt')
  }

  async upsert(session: TutorSession): Promise<TutorSession> {
    await this.db.table<TutorSession, string>('tutorSessions').put(session)
    return session
  }

  /**
   * Most recently touched session for a topic, so reopening the Interactive
   * Tutor continues the existing conversation instead of starting a new one.
   */
  async findLatest(projectId: string, topicId: string): Promise<TutorSession | undefined> {
    const sessions = await this.db
      .table<TutorSession, string>('tutorSessions')
      .where('projectId')
      .equals(projectId)
      .toArray()
    return sessions
      .filter((session) => session.topicId === topicId && session.status !== 'abandoned')
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  }

  async delete(id: string): Promise<void> {
    await this.db.table<TutorSession, string>('tutorSessions').delete(id)
    logger.warn('Tutor session deleted', { id })
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db.table<TutorSession, string>('tutorSessions').where('projectId').equals(projectId).delete()
  }
}