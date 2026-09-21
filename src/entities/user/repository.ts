import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { UpdateUserInput, UserProfile } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

const DEFAULT_PROFILE: UserProfile = {
  id: 'singleton',
  name: 'Student',
  language: 'auto',
  theme: 'system',
  colorTheme: 'default',
  uiLanguage: 'en',
}

export class UserRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async get(): Promise<UserProfile> {
    try {
      const row = await this.db.user.get('singleton')
      return row ?? DEFAULT_PROFILE
    } catch (err) {
      logger.error('UserRepository.get failed', undefined, err)
      throw new StorageError(t('storage.failedToReadUserProfile'), err)
    }
  }

  async update(patch: UpdateUserInput): Promise<UserProfile> {
    // Read-modify-write inside one transaction: appearance, language and name
    // can be changed in quick succession (e.g. picking a color theme and then a
    // mode), and two concurrent `get` + `put` pairs would otherwise lose one of
    // the two changes.
    try {
      const next = await this.db.transaction('rw', this.db.user, async () => {
        const current = (await this.db.user.get('singleton')) ?? DEFAULT_PROFILE
        const merged: UserProfile = {
          ...current,
          ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
          ...(patch.language !== undefined ? { language: patch.language } : {}),
          ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
          ...(patch.colorTheme !== undefined ? { colorTheme: patch.colorTheme } : {}),
          ...(patch.uiLanguage !== undefined ? { uiLanguage: patch.uiLanguage } : {}),
        }
        await this.db.user.put(merged)
        return merged
      })
      logger.info('User profile updated')
      return next
    } catch (err) {
      logger.error('UserRepository.update failed', undefined, err)
      throw new StorageError(t('storage.failedToSaveUserProfile'), err)
    }
  }

  async setUnlocked(inviteCode: string): Promise<UserProfile> {
    const next = await this.db.transaction('rw', this.db.user, async () => {
      const current = (await this.db.user.get('singleton')) ?? DEFAULT_PROFILE
      const merged: UserProfile = { ...current, unlockedAt: Date.now(), inviteCode }
      await this.db.user.put(merged)
      return merged
    })
    logger.info('App unlocked')
    return next
  }

  async reset(): Promise<void> {
    await this.db.user.delete('singleton')
  }
}