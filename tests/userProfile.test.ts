import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { UserRepository } from '@/entities/user/repository'

/**
 * The user profile is the single row every appearance/language/name change
 * writes to. Two changes made in quick succession must not lose one another.
 */
describe('UserRepository read-modify-write', () => {
  let db: AppDatabase
  let users: UserRepository

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    users = new UserRepository(db)
  })

  it('keeps both changes when two updates are issued concurrently', async () => {
    const [afterTheme, afterColor] = await Promise.all([
      users.update({ theme: 'dark' }),
      users.update({ colorTheme: 'academic' }),
    ])

    // Each call reports its own change...
    expect(afterTheme.theme).toBe('dark')
    expect(afterColor.colorTheme).toBe('academic')

    // ...and neither change is lost: the stored row has both. (Before the
    // read-modify-write was made atomic, the second writer could commit a row
    // read before the first write landed, silently reverting it.)
    expect(await users.get()).toMatchObject({ theme: 'dark', colorTheme: 'academic' })
  })

  it('preserves unrelated fields across a sequence of updates', async () => {
    await users.update({ name: 'Ada' })
    await users.update({ theme: 'light' })
    await users.update({ uiLanguage: 'zh-CN' })
    await users.update({ colorTheme: 'pinkAqua' })

    expect(await users.get()).toMatchObject({
      name: 'Ada',
      theme: 'light',
      uiLanguage: 'zh-CN',
      colorTheme: 'pinkAqua',
    })
  })

  it('setUnlocked keeps the appearance settings', async () => {
    await users.update({ colorTheme: 'warmOrange', theme: 'dark' })
    const unlocked = await users.setUnlocked('INVITE-1')

    expect(unlocked).toMatchObject({
      colorTheme: 'warmOrange',
      theme: 'dark',
      inviteCode: 'INVITE-1',
    })
    expect(unlocked.unlockedAt).toBeTypeOf('number')
  })

  it('defaults a fresh profile to the original palette', async () => {
    expect(await users.get()).toMatchObject({ theme: 'system', colorTheme: 'default' })
  })
})
