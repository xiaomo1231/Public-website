import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { logger } from '@/infrastructure/logger/logger'
import type { FocusRange, FocusSession } from './types'

/** Pomodoro focus phases. Course-linked rows carry `projectId`; global rows do not. */
export class FocusSessionRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private table() {
    return this.db.table<FocusSession, string>('focusSessions')
  }

  async get(id: string): Promise<FocusSession | undefined> {
    return this.table().get(id)
  }

  async put(row: FocusSession): Promise<FocusSession> {
    await this.table().put(row)
    return row
  }

  async delete(id: string): Promise<void> {
    await this.table().delete(id)
  }

  /** Rows whose phase started inside `range`, oldest first. */
  async listStartedIn(range: FocusRange): Promise<FocusSession[]> {
    return this.table().where('startedAt').between(range.from, range.to, true, false).toArray()
  }

  async listByProject(projectId: string): Promise<FocusSession[]> {
    return this.table().where('projectId').equals(projectId).sortBy('startedAt')
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Focus sessions deleted', { projectId, count })
    return count
  }
}
