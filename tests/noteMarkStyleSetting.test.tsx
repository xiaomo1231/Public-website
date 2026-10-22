import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { UserRepository } from '@/entities/user/repository'
import { useAuthStore } from '@/features/auth/authStore'
import { NOTE_MARK_ATTRIBUTE } from '@/features/theme/noteMarkStyle'
import { NoteMarkStyleSetting } from '@/widgets/settings/NoteMarkStyleSetting'

let db: AppDatabase

afterEach(() => {
  db?.close()
})

describe('问答标记样式 setting', () => {
  it('switches the mark style at once and saves it on the profile', async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    useAuthStore.setState({ profile: await new UserRepository(db).get() })
    render(<NoteMarkStyleSetting />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(radios[1]!)
    expect(document.documentElement.getAttribute(NOTE_MARK_ATTRIBUTE)).toBe('highlighter')
    await waitFor(async () =>
      expect((await new UserRepository(db).get()).noteMarkStyle).toBe('highlighter'),
    )
    await waitFor(() =>
      expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true'),
    )
  })
})
