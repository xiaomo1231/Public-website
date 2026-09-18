import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { InviteKeyRecord } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError } from '@/infrastructure/errors/AppError'

export class InviteRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async list(): Promise<InviteKeyRecord[]> {
    try {
      return this.db.inviteKeys.toArray()
    } catch (err) {
      logger.error('InviteRepository.list failed', undefined, err)
      throw new StorageError('Failed to list invite keys', err)
    }
  }

  async add(record: InviteKeyRecord): Promise<void> {
    await this.db.inviteKeys.put(record)
  }

  async remove(code: string): Promise<void> {
    await this.db.inviteKeys.delete(code)
  }

  async findByCode(code: string): Promise<InviteKeyRecord | undefined> {
    return this.db.inviteKeys.get(code)
  }
}