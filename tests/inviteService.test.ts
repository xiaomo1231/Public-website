import 'fake-indexeddb/auto'

import { describe, expect, it, beforeEach } from 'vitest'
import { AppDatabase } from '@/infrastructure/db/database'
import { InviteService } from '@/services/inviteService'
import { AuthError } from '@/infrastructure/errors/AppError'
import { UserRepository } from '@/entities/user/repository'

describe('InviteService', () => {
  let svc: InviteService

  beforeEach(() => {
    svc = new InviteService()
  })

  function fresh() {
    return new InviteService()
  }

  it('seeds demo codes on first call', async () => {
    const s = fresh()
    await s.ensureSeeded()
    const codes = await s.listCodes()
    expect(codes.length).toBeGreaterThan(0)
    expect(codes).toContain('WELCOME-LEARN')
  })

  it('validates a seeded code', async () => {
    const s = fresh()
    await s.ensureSeeded()
    expect(await s.validate('welcome-learn')).toBe(true) // case-insensitive
    expect(await s.validate('NOT-A-CODE')).toBe(false)
  })

  it('rejects an empty code', async () => {
    const s = fresh()
    await s.ensureSeeded()
    expect(await s.validate('')).toBe(false)
    expect(await s.validate('   ')).toBe(false)
  })

  it('unlocks the app with a valid code', async () => {
    const s = fresh()
    await s.ensureSeeded()
    await s.unlock('welcome-learn')
    expect(await s.isUnlocked()).toBe(true)
  })

  it('throws AuthError on invalid code', async () => {
    const s = fresh()
    await s.ensureSeeded()
    await expect(s.unlock('nope')).rejects.toBeInstanceOf(AuthError)
    expect(await s.isUnlocked()).toBe(false)
  })

  it('supports adding and removing custom codes', async () => {
    const s = fresh()
    await s.ensureSeeded()
    await s.addCode('CUSTOM-123')
    expect(await s.validate('custom-123')).toBe(true)
    await s.removeCode('CUSTOM-123')
    expect(await s.validate('custom-123')).toBe(false)
  })

  it('locks the app', async () => {
    const s = fresh()
    await s.ensureSeeded()
    await s.unlock('welcome-learn')
    expect(await s.isUnlocked()).toBe(true)
    await s.lock()
    expect(await s.isUnlocked()).toBe(false)
  })

  it('locking keeps the user preferences and only clears the unlock state', async () => {
    const s = fresh()
    const users = new UserRepository()
    await s.ensureSeeded()
    await s.unlock('welcome-learn')
    await users.update({
      name: 'Ada',
      theme: 'dark',
      colorTheme: 'academic',
      uiLanguage: 'zh-CN',
      questionLanguage: 'en',
      vocabDailyNew: 35,
    })
    await s.lock()
    const profile = await users.get()
    expect(profile.unlockedAt).toBeUndefined()
    expect(profile.inviteCode).toBeUndefined()
    expect(profile).toMatchObject({
      name: 'Ada',
      theme: 'dark',
      colorTheme: 'academic',
      uiLanguage: 'zh-CN',
      questionLanguage: 'en',
      vocabDailyNew: 35,
    })
    // Unlocking again still works after a lock.
    await s.unlock('welcome-learn')
    expect(await s.isUnlocked()).toBe(true)
  })

  it('AppDatabase constructed standalone works', () => {
    const db = new AppDatabase()
    expect(db.name).toBe('ai-learning-platform')
    void svc // silence unused
  })
})