import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { DEFAULT_AI_SETTINGS, type AISettingsRow } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

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
      // Two first reads at once (two services built together) must not both
      // add the row: the check and the insert share one transaction.
      return await this.db.transaction('rw', this.db.settings, async () => {
        const existing = await this.db.settings.get('singleton')
        if (existing) return existing
        const seed: AISettingsRow = { ...DEFAULT_AI_SETTINGS, updatedAt: Date.now() }
        await this.db.settings.add(seed)
        return seed
      })
    } catch (err) {
      logger.error('SettingsRepository.getRow failed', undefined, err)
      throw new StorageError(t('storage.failedToReadSettings'), err)
    }
  }

  /**
   * Write the settings row. The local usage counters (`usage`) are owned by
   * `AIUsageService`, which updates them after every AI response; a settings
   * write keeps the counters currently stored instead of the (possibly stale)
   * copy it read earlier, so a save never rolls usage back.
   */
  async putRow(row: AISettingsRow): Promise<AISettingsRow> {
    try {
      return await this.db.transaction('rw', this.db.settings, async () => {
        const current = await this.db.settings.get('singleton')
        const next: AISettingsRow = { ...row }
        if (current?.usage) next.usage = current.usage
        else delete next.usage
        await this.db.settings.put(next)
        return next
      })
    } catch (err) {
      throw new StorageError(t('storage.failedToSaveSettings'), err)
    }
  }

  async reset(): Promise<void> {
    await this.db.settings.delete('singleton')
  }
}
