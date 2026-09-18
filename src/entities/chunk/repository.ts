import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { type DocumentChunk, type NewChunkInput } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

export class ChunkRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async listByDocument(documentId: string): Promise<DocumentChunk[]> {
    try {
      return this.db.chunks
        .where('documentId')
        .equals(documentId)
        .sortBy('order')
    } catch (err) {
      throw new StorageError(t('storage.failedToListChunks'), err)
    }
  }

  async listByProject(projectId: string): Promise<DocumentChunk[]> {
    try {
      return this.db.chunks
        .where('projectId')
        .equals(projectId)
        .sortBy('order')
    } catch (err) {
      throw new StorageError(t('storage.failedToListChunks'), err)
    }
  }

  async addMany(inputs: NewChunkInput[]): Promise<DocumentChunk[]> {
    if (inputs.length === 0) return []
    const now = Date.now()
    const rows: DocumentChunk[] = inputs.map((input) => ({
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
    }))
    try {
      await this.db.chunks.bulkAdd(rows)
      logger.debug('Chunks added', { count: rows.length, documentId: rows[0]?.documentId })
      return rows
    } catch (err) {
      throw new StorageError(t('storage.failedToSaveChunks'), err)
    }
  }

  async deleteByDocument(documentId: string): Promise<number> {
    return this.db.chunks.where('documentId').equals(documentId).delete()
  }

  /**
   * Case-insensitive substring search across a project's chunks.
   *
   * IndexedDB has no full-text index, so this is inherently an O(n) scan of
   * the project's chunks. It is implemented with a cursor so that:
   *   - peak memory is bounded by the result set, not the whole corpus, and
   *   - the scan stops as soon as `limit` matches are found.
   *
   * It is not a substitute for real retrieval — Phase 6 adds a token/vector
   * index. Until then this is the honest, bounded implementation.
   */
  async searchByProject(projectId: string, query: string, limit = 50): Promise<DocumentChunk[]> {
    const q = query.trim().toLowerCase()
    if (!q || limit <= 0) return []
    const matches: DocumentChunk[] = []
    await this.db.chunks
      .where('projectId')
      .equals(projectId)
      .until(() => matches.length >= limit)
      .each((chunk) => {
        if (chunk.text.toLowerCase().includes(q)) matches.push(chunk)
      })
    return matches.sort((a, b) => a.order - b.order)
  }

  async countByDocument(documentId: string): Promise<number> {
    return this.db.chunks.where('documentId').equals(documentId).count()
  }
}