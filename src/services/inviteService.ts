import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { InviteRepository } from '@/entities/invite/repository'
import { UserRepository } from '@/entities/user/repository'
import { SEED_INVITE_CODES } from '@/shared/config/config'
import { logger } from '@/infrastructure/logger/logger'
import { AuthError, ValidationError } from '@/infrastructure/errors/AppError'

/**
 * Local-only invite code verification.
 *
 * The flow is intentionally simple:
 *   1. The app seeds a few demo invite codes into IndexedDB on first launch.
 *   2. The user enters a code, the service checks it against the local DB.
 *   3. On success, the user profile is marked as unlocked.
 *
 * There is no remote authentication. A determined user can edit their local
 * IndexedDB; that is acceptable because nothing sensitive lives server-side.
 */
export class InviteService {
  private invites: InviteRepository
  private users: UserRepository

  constructor(db?: AppDatabase) {
    const resolved = db ?? getDb()
    this.invites = new InviteRepository(resolved)
    this.users = new UserRepository(resolved)
  }

  /** Seed demo invite codes if none exist yet. */
  async ensureSeeded(): Promise<void> {
    const existing = await this.invites.list()
    if (existing.length > 0) return
    for (const code of SEED_INVITE_CODES) {
      await this.invites.add({ code })
    }
    logger.info('Seeded demo invite codes', { count: SEED_INVITE_CODES.length })
  }

  async validate(rawCode: string): Promise<boolean> {
    const code = rawCode.trim().toUpperCase()
    if (!code) return false
    const record = await this.invites.findByCode(code)
    if (!record) return false
    if (record.expiresAt && record.expiresAt < Date.now()) return false
    return true
  }

  async unlock(rawCode: string): Promise<void> {
    const code = rawCode.trim().toUpperCase()
    if (!code) throw new ValidationError('Invite code is required')
    const valid = await this.validate(code)
    if (!valid) throw new AuthError('Invite code is invalid or expired', 'INVALID_INVITE')
    await this.invites.add({ code, usedAt: Date.now() })
    await this.users.setUnlocked(code)
    logger.info('App unlocked', { code })
  }

  async isUnlocked(): Promise<boolean> {
    const profile = await this.users.get()
    return Boolean(profile.unlockedAt)
  }

  async addCode(code: string): Promise<void> {
    const normalised = code.trim().toUpperCase()
    if (!normalised) throw new ValidationError('Invite code is required')
    await this.invites.add({ code: normalised })
  }

  async removeCode(code: string): Promise<void> {
    await this.invites.remove(code)
  }

  async listCodes(): Promise<string[]> {
    const records = await this.invites.list()
    return records.map((r) => r.code)
  }

  async lock(): Promise<void> {
    await this.users.reset()
  }
}
