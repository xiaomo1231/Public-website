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
    return this.db
      .table<TutorSession, string>('tutorSessions')
      .where('projectId')
      .equals(projectId)
      .reverse()
      .sortBy('updatedAt')
  }

  /**
   * Sessions that hold a conversation (at least one turn), newest first —
   * what the history lists. Empty rows (a visit whose first AI request
   * failed, saved by older versions) are left out.
   */
  async listConversations(projectId: string): Promise<TutorSession[]> {
    const sessions = await this.listByProject(projectId)
    return sessions.filter((session) => session.turns.length > 0)
  }

  /** A topic's sessions, most recently touched first. */
  async listByTopic(projectId: string, topicId: string): Promise<TutorSession[]> {
    const sessions = await this.db
      .table<TutorSession, string>('tutorSessions')
      .where('projectId')
      .equals(projectId)
      .toArray()
    return sessions
      .filter((session) => session.topicId === topicId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Remove a topic's sessions that never received a turn. */
  async deleteEmpty(projectId: string, topicId: string): Promise<number> {
    const empty = (await this.listByTopic(projectId, topicId)).filter(
      (session) => session.turns.length === 0,
    )
    if (empty.length === 0) return 0
    await this.db
      .table<TutorSession, string>('tutorSessions')
      .bulkDelete(empty.map((session) => session.id))
    return empty.length
  }

  async upsert(session: TutorSession): Promise<TutorSession> {
    await this.db.table<TutorSession, string>('tutorSessions').put(session)
    return session
  }

  async delete(id: string): Promise<void> {
    await this.db.table<TutorSession, string>('tutorSessions').delete(id)
    logger.warn('Tutor session deleted', { id })
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db
      .table<TutorSession, string>('tutorSessions')
      .where('projectId')
      .equals(projectId)
      .delete()
  }
}
