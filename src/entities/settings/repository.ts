import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { DEFAULT_AI_SETTINGS, type AISettingsRow } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError } from '@/infrastructure/errors/AppError'

/**
 * Raw storage for AI settings.
 *
 * This layer is deliberately dumb: it reads and writes rows exactly as given.
 * Encryption, validation, and legacy migration belong to `SettingsService`.
 */
export class SettingsRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async getRow(): Promise<AISettingsRow> {
    try {
      const row = await this.db.settings.get('singleton')
      if (row) return row
      const seed: AISettingsRow = { ...DEFAULT_AI_SETTINGS, updatedAt: Date.now() }
      await this.db.settings.add(seed)
      return seed
    } catch (err) {
      logger.error('SettingsRepository.getRow failed', undefined, err)
      throw new StorageError('Failed to read AI settings', err)
    }
  }

  async putRow(row: AISettingsRow): Promise<AISettingsRow> {
    try {
      await this.db.settings.put(row)
      return row
    } catch (err) {
      throw new StorageError('Failed to save AI settings', err)
    }
  }

  async reset(): Promise<void> {
    await this.db.settings.delete('singleton')
  }
}
