import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemePicker } from '@/widgets/theme/ThemePicker'
import { COLOR_THEMES, isCssHexColor, resolveColorTheme } from '@/features/theme/colorThemes'
import { useThemeStore, resetThemeForTesting } from '@/features/theme/themeStore'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { UserService } from '@/services/userService'

beforeEach(() => {
  resetThemeForTesting()
})

describe('color theme definitions', () => {
  it('ships Default plus the three new themes', () => {
    expect(COLOR_THEMES.map((theme) => theme.id)).toEqual([
      'default',
      'pinkAqua',
      'warmOrange',
      'academic',
    ])
  })

  it('keeps the original palette as the default', () => {
    expect(resolveColorTheme(undefined)).toBe('default')
    expect(resolveColorTheme('not-a-theme')).toBe('default')
    expect(resolveColorTheme('academic')).toBe('academic')
  })

  it('previews five source colours per theme', () => {
    for (const theme of COLOR_THEMES) {
      expect(theme.preview).toHaveLength(5)
      for (const color of theme.preview) expect(color).toMatch(/^#[0-9a-fA-F]+$/)
    }
  })

  it('keeps the Warm Orange deep colour exactly as specified', () => {
    const warm = COLOR_THEMES.find((theme) => theme.id === 'warmOrange')
    expect(warm?.palette.deep).toBe('#4C1A2')
  })

  it('classifies hex colours without inventing a replacement for #4C1A2', () => {
    expect(isCssHexColor('#2A9BB8')).toBe(true)
    expect(isCssHexColor('#FFF')).toBe(true)
    expect(isCssHexColor('#11223344')).toBe(true)
    expect(isCssHexColor('#4C1A2')).toBe(false)
    expect(isCssHexColor('4C1A2D')).toBe(false)
    expect(isCssHexColor('rebeccapurple')).toBe(false)
  })
})

describe('applying the theme to the DOM', () => {
  it('sets data-color-theme independently of the light/dark mode', () => {
    act(() => useThemeStore.getState().setColorTheme('academic'))
    expect(document.documentElement.dataset.colorTheme).toBe('academic')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => useThemeStore.getState().setPreference('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    // Switching the mode must not reset the palette.
    expect(document.documentElement.dataset.colorTheme).toBe('academic')
  })

  it('keeps the mode when only the color theme changes', () => {
    act(() => useThemeStore.getState().setPreference('dark'))
    act(() => useThemeStore.getState().setColorTheme('pinkAqua'))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.colorTheme).toBe('pinkAqua')
  })

  it('system mode resolves light/dark while keeping the palette', () => {
    act(() => useThemeStore.getState().setColorTheme('warmOrange'))
    act(() => useThemeStore.getState().setPreference('system'))

    // jsdom has no matchMedia, so the system preference resolves to light.
    expect(document.documentElement.dataset.colorTheme).toBe('warmOrange')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(useThemeStore.getState().preference).toBe('system')
  })

  it('default is the unmarked state: no palette override is applied', () => {
    act(() => useThemeStore.getState().setColorTheme('academic'))
    act(() => useThemeStore.getState().setColorTheme('default'))
    expect(document.documentElement.dataset.colorTheme).toBe('default')
  })
})

describe('ThemePicker', () => {
  it('offers every mode and every color theme', () => {
    render(<ThemePicker />)

    for (const mode of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('radio', { name: mode })).toBeInTheDocument()
    }
    for (const theme of ['Default', 'Pink Aqua', 'Warm Orange', 'Academic']) {
      expect(screen.getByRole('radio', { name: theme })).toBeInTheDocument()
    }
  })

  it('applies and persists a color theme choice', async () => {
    const user = userEvent.setup()
    render(<ThemePicker />)

    await user.click(screen.getByRole('radio', { name: 'Warm Orange' }))
    expect(document.documentElement.dataset.colorTheme).toBe('warmOrange')

    await waitFor(
      async () => {
        expect((await new UserService().get()).colorTheme).toBe('warmOrange')
      },
      { timeout: 5000 },
    )
  })

  it('applies and persists a mode choice', async () => {
    const user = userEvent.setup()
    render(<ThemePicker />)

    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await waitFor(
      async () => {
        expect((await new UserService().get()).theme).toBe('dark')
      },
      { timeout: 5000 },
    )
  })

  it('restores both dimensions after a simulated reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ThemePicker />)

    await user.click(screen.getByRole('radio', { name: 'Academic' }))
    await user.click(screen.getByRole('radio', { name: 'Dark' }))

    await waitFor(
      async () => {
        expect(await new UserService().get()).toMatchObject({
          colorTheme: 'academic',
          theme: 'dark',
        })
      },
      { timeout: 5000 },
    )

    unmount()
    // Cold start: the DOM is reset, then the app re-applies the profile.
    resetThemeForTesting()
    expect(document.documentElement.dataset.colorTheme).toBeUndefined()

    const profile = await new UserService().get()
    act(() => {
      useThemeStore.getState().setPreference(profile.theme)
      useThemeStore.getState().setColorTheme(profile.colorTheme ?? 'default')
    })

    expect(document.documentElement.dataset.colorTheme).toBe('academic')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('marks the invalid palette entry as unavailable instead of faking a colour', () => {
    const { container } = render(<ThemePicker />)

    // The invalid entry keeps its raw value in the tooltip...
    const unavailable = container.querySelector('[title*="#4C1A2"]')
    expect(unavailable).not.toBeNull()
    expect(unavailable?.getAttribute('title')).toContain('not a valid colour')
    // ...and is never painted as a colour.
    expect((unavailable as HTMLElement).style.backgroundColor).toBe('')
    expect(unavailable?.textContent).toBe('?')

    // Every other swatch is a real colour.
    const warm = COLOR_THEMES.find((theme) => theme.id === 'warmOrange')!
    for (const color of warm.preview.filter((value) => value !== '#4C1A2')) {
      expect(container.querySelector(`[title="${color}"]`)).not.toBeNull()
    }
  })

  it('never makes a network request when switching themes', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const user = userEvent.setup()
      render(<ThemePicker />)

      await user.click(screen.getByRole('radio', { name: 'Pink Aqua' }))
      await user.click(screen.getByRole('radio', { name: 'Dark' }))
      await user.click(screen.getByRole('radio', { name: 'Academic' }))

      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not touch course analysis or topics when the theme changes', async () => {
    const db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calc', subject: 'calculus' })
    const analyses = new CourseAnalysisRepository(db)
    await analyses.reseedProject(
      project.id,
      {
        topics: [{ name: 'Derivatives', description: 'rate of change', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash: 'source-hash' },
    )
    const before = await analyses.getByProject(project.id)

    const user = userEvent.setup()
    render(<ThemePicker />)
    await user.click(screen.getByRole('radio', { name: 'Warm Orange' }))
    await user.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(await analyses.getByProject(project.id)).toEqual(before)
    expect(await analyses.listTopics(project.id)).toHaveLength(1)
  })
})
