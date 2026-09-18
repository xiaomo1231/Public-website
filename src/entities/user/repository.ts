import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { UpdateUserInput, UserProfile } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError } from '@/infrastructure/errors/AppError'

const DEFAULT_PROFILE: UserProfile = {
  id: 'singleton',
  name: 'Student',
  language: 'auto',
  theme: 'system',
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
      throw new StorageError('Failed to read user profile', err)
    }
  }

  async update(patch: UpdateUserInput): Promise<UserProfile> {
    const current = await this.get()
    const next: UserProfile = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
    }
    await this.db.user.put(next)
    logger.info('User profile updated')
    return next
  }

  async setUnlocked(inviteCode: string): Promise<UserProfile> {
    const current = await this.get()
    const next: UserProfile = { ...current, unlockedAt: Date.now(), inviteCode }
    await this.db.user.put(next)
    logger.info('App unlocked')
    return next
  }

  async reset(): Promise<void> {
    await this.db.user.delete('singleton')
  }
}