import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { UserRepository } from '@/entities/user/repository'
import { useAuthStore } from '@/features/auth/authStore'
import {
  NOTE_COLOR_ATTRIBUTE,
  NOTE_MARK_ATTRIBUTE,
  applyNoteHighlightColor,
  resolveNoteHighlightColor,
} from '@/features/theme/noteMarkStyle'
import { NOTE_HIGHLIGHT_COLORS } from '@/entities/user/types'
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

  it('shows colour swatches only for the highlighter style; picking one applies and saves it', async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    await new UserRepository(db).update({ noteMarkStyle: 'link' })
    useAuthStore.setState({ profile: await new UserRepository(db).get() })
    const { container } = render(<NoteMarkStyleSetting />)
    expect(container.querySelector('[data-note-color-picker]')).toBeNull()
    // The live preview uses the link look: no fill.
    expect(
      (container.querySelector('[data-preview-mark="saved"]') as HTMLElement).style.backgroundColor,
    ).toBe('')

    fireEvent.click(screen.getByRole('radio', { name: /highlighter|荧光笔/i }))
    const picker = await waitFor(() => {
      const found = container.querySelector('[data-note-color-picker]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    const swatches = picker.querySelectorAll<HTMLElement>('[role="radio"]')
    expect(swatches).toHaveLength(NOTE_HIGHLIGHT_COLORS.length)
    // Default colour is yellow.
    expect(swatches[0]).toHaveAttribute('aria-checked', 'true')
    expect(swatches[0]).toHaveAttribute('tabindex', '0')

    // Arrow keys move the selection (radio-group pattern).
    fireEvent.keyDown(swatches[0]!, { key: 'ArrowRight' })
    expect(document.documentElement.getAttribute(NOTE_COLOR_ATTRIBUTE)).toBe('green')
    fireEvent.click(picker.querySelector('[data-note-color-option="purple"]')!)
    expect(document.documentElement.getAttribute(NOTE_COLOR_ATTRIBUTE)).toBe('purple')
    await waitFor(async () =>
      expect((await new UserRepository(db).get()).noteHighlightColor).toBe('purple'),
    )
    await waitFor(() =>
      expect(picker.querySelector('[data-note-color-option="purple"]')).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
    // The preview sentence shows the highlighter fill in the chosen colour, no underline.
    const preview = container.querySelector('[data-note-mark-preview]') as HTMLElement
    expect(preview).toHaveAttribute('data-note-color', 'purple')
    const saved = preview.querySelector('[data-preview-mark="saved"]') as HTMLElement
    expect(saved.getAttribute('style')).toContain('--note-hl-saved-a')
    expect(saved.style.textDecoration).toBe('')
  })

  it('resolves and applies the highlighter colour (unknown values fall back to yellow)', () => {
    expect(resolveNoteHighlightColor(undefined)).toBe('yellow')
    expect(resolveNoteHighlightColor('neon')).toBe('yellow')
    expect(applyNoteHighlightColor('theme')).toBe('theme')
    expect(document.documentElement.getAttribute(NOTE_COLOR_ATTRIBUTE)).toBe('theme')
  })
})
