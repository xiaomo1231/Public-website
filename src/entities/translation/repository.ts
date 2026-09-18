import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { TranslationEntry } from './types'

export class TranslationRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async add(entry: TranslationEntry): Promise<TranslationEntry> {
    await this.db.table<TranslationEntry, string>('translations').put(entry)
    return entry
  }

  async listByProject(projectId: string, limit = 50): Promise<TranslationEntry[]> {
    return this.db
      .table<TranslationEntry, string>('translations')
      .where('projectId')
      .equals(projectId)
      .reverse()
      .sortBy('createdAt')
      .then((rows) => rows.slice(0, limit))
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db.table<TranslationEntry, string>('translations').where('projectId').equals(projectId).delete()
  }
}