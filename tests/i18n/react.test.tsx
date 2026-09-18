import { describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTranslation, setUILanguage } from '@/i18n'
import { useUILanguage } from '@/features/settings/useUILanguage'
import { UserService } from '@/services/userService'

function TranslationProbe(): JSX.Element {
  const { t, language } = useTranslation()
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="nav">{t('nav.dashboard')}</span>
      <span data-testid="interpolated">{t('header.welcomeNamed', { name: 'Ada' })}</span>
    </div>
  )
}

function SwitchProbe(): JSX.Element {
  const { language, setLanguage } = useUILanguage()
  return (
    <button type="button" onClick={() => setLanguage('zh-CN')}>
      {language}
    </button>
  )
}

describe('useTranslation', () => {
  it('renders English by default', () => {
    render(<TranslationProbe />)
    expect(screen.getByTestId('language')).toHaveTextContent('en')
    expect(screen.getByTestId('nav')).toHaveTextContent('Dashboard')
  })

  it('re-renders immediately when the language changes', () => {
    render(<TranslationProbe />)

    act(() => setUILanguage('zh-CN'))

    expect(screen.getByTestId('language')).toHaveTextContent('zh-CN')
    expect(screen.getByTestId('nav')).toHaveTextContent('仪表盘')
  })

  it('re-renders interpolated strings in the new language', () => {
    render(<TranslationProbe />)
    expect(screen.getByTestId('interpolated')).toHaveTextContent('Welcome, Ada')

    act(() => setUILanguage('zh-CN'))
    expect(screen.getByTestId('interpolated')).toHaveTextContent('欢迎，Ada')
  })

  it('switches back to English', () => {
    render(<TranslationProbe />)
    act(() => setUILanguage('zh-CN'))
    act(() => setUILanguage('en'))
    expect(screen.getByTestId('nav')).toHaveTextContent('Dashboard')
  })
})

describe('useUILanguage persistence', () => {
  it('persists the choice to the local user profile', async () => {
    const user = userEvent.setup()
    render(<SwitchProbe />)

    expect(await new UserService().get()).toMatchObject({ uiLanguage: 'en' })

    await user.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveTextContent('zh-CN')
    // Persistence is fire-and-forget so the UI is never blocked by storage.
    await waitFor(async () => {
      expect(await new UserService().get()).toMatchObject({ uiLanguage: 'zh-CN' })
    })
  })

  it('survives a simulated reload by reading the persisted profile', async () => {
    const user = userEvent.setup()
    render(<SwitchProbe />)
    await user.click(screen.getByRole('button'))

    await waitFor(async () => {
      const profile = await new UserService().get()
      expect(profile.uiLanguage).toBe('zh-CN')
    })
  })
})
