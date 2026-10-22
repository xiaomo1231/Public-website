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
          ...(patch.uiStyle !== undefined ? { uiStyle: patch.uiStyle } : {}),
          ...(patch.uiLanguage !== undefined ? { uiLanguage: patch.uiLanguage } : {}),
          ...(patch.questionLanguage !== undefined
            ? { questionLanguage: patch.questionLanguage }
            : {}),
          ...(patch.noteMarkStyle !== undefined ? { noteMarkStyle: patch.noteMarkStyle } : {}),
          ...(patch.noteHighlightColor !== undefined
            ? { noteHighlightColor: patch.noteHighlightColor }
            : {}),
          ...(patch.showUsageReadout !== undefined
            ? { showUsageReadout: patch.showUsageReadout }
            : {}),
          ...(patch.vocabBookId !== undefined ? { vocabBookId: patch.vocabBookId } : {}),
          ...(patch.vocabDailyNew !== undefined ? { vocabDailyNew: patch.vocabDailyNew } : {}),
          ...(patch.vocabReviewMode !== undefined
            ? { vocabReviewMode: patch.vocabReviewMode }
            : {}),
          ...(patch.walkthroughLevel !== undefined
            ? { walkthroughLevel: patch.walkthroughLevel }
            : {}),
          ...(patch.handwritingRecognition !== undefined
            ? { handwritingRecognition: patch.handwritingRecognition }
            : {}),
          // Merged field by field, so a quick edit of one length keeps the rest.
          ...(patch.pomodoro !== undefined
            ? { pomodoro: { ...current.pomodoro, ...patch.pomodoro } }
            : {}),
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

  /**
   * Lock the app: forget only the unlock state (when and with which invite
   * code). Appearance, name, languages and vocab settings are preferences and
   * survive a lock.
   */
  async clearUnlock(): Promise<void> {
    await this.db.transaction('rw', this.db.user, async () => {
      const current = await this.db.user.get('singleton')
      if (!current) return
      const { unlockedAt: _unlockedAt, inviteCode: _inviteCode, ...rest } = current
      await this.db.user.put(rest)
    })
    logger.info('App locked')
  }

  async reset(): Promise<void> {
    await this.db.user.delete('singleton')
  }
}
