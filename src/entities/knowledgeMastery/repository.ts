import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { KnowledgeMastery } from './types'
import { masteryId } from './types'

export class KnowledgeMasteryRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async get(projectId: string, knowledgePoint: string): Promise<KnowledgeMastery | undefined> {
    return this.db.table<KnowledgeMastery, string>('knowledgeMastery').get(masteryId(projectId, knowledgePoint))
  }

  async listByProject(projectId: string): Promise<KnowledgeMastery[]> {
    return this.db
      .table<KnowledgeMastery, string>('knowledgeMastery')
      .where('projectId')
      .equals(projectId)
      .toArray()
  }

  async upsert(row: KnowledgeMastery): Promise<KnowledgeMastery> {
    await this.db.table<KnowledgeMastery, string>('knowledgeMastery').put(row)
    return row
  }

  async upsertMany(rows: KnowledgeMastery[]): Promise<void> {
    if (rows.length === 0) return
    await this.db.table<KnowledgeMastery, string>('knowledgeMastery').bulkPut(rows)
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db.table<KnowledgeMastery, string>('knowledgeMastery').where('projectId').equals(projectId).delete()
  }
}