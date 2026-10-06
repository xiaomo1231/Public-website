import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ReviewCard } from './types'
import { logger } from '@/infrastructure/logger/logger'

/** Flashcards, scoped by project. */
export class ReviewCardRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private table() {
    return this.db.table<ReviewCard, string>('reviewCards')
  }

  async listByProject(projectId: string): Promise<ReviewCard[]> {
    return this.table().where('projectId').equals(projectId).sortBy('createdAt')
  }

  /** Cards due at `now`, oldest due first. */
  async listDue(projectId: string, now: number): Promise<ReviewCard[]> {
    return this.table()
      .where('[projectId+due]')
      .between([projectId, -Infinity], [projectId, now], true, true)
      .sortBy('due')
  }

  async get(id: string): Promise<ReviewCard | undefined> {
    return this.table().get(id)
  }

  async put(card: ReviewCard): Promise<ReviewCard> {
    await this.table().put(card)
    return card
  }

  async bulkAdd(cards: ReviewCard[]): Promise<void> {
    if (cards.length) await this.table().bulkAdd(cards)
  }

  async delete(id: string): Promise<void> {
    await this.table().delete(id)
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Review cards deleted', { projectId, count })
    return count
  }
}
