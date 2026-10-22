import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { AppShell } from '@/app/layout/AppShell'
import { useThemeStore } from '@/features/theme/themeStore'
import { useProjectStore } from '@/features/project/projectStore'
import { useAuthStore } from '@/features/auth/authStore'
import { useExamMode, resetExamModeForTesting } from '@/features/focus/examMode'
import { resetPomodoroForTesting, usePomodoroStore } from '@/features/focus/pomodoroStore'
import { FocusPageHeader } from '@/widgets/focus/FocusPageHeader'

function ExamStub(): JSX.Element {
  useExamMode(true)
  return <div>Self-test</div>
}

function FocusStub(): JSX.Element {
  return (
    <>
      <FocusPageHeader
        backTo="/projects/p1/homework"
        backLabel="Homework"
        title="HW4.pdf"
        meta="8 questions"
        actions={<button type="button">Walkthrough</button>}
      />
      <main id="main-content">Working area</main>
    </>
  )
}

function renderAt(path: string): void {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { path: 'dashboard', element: <div>Dashboard</div> },
          { path: 'projects/:id/homework', element: <div>Homework list</div> },
          { path: 'projects/:id/homework/:assignmentId', element: <FocusStub /> },
          { path: 'projects/:id/homework/:assignmentId/exam', element: <div>Mock exam</div> },
          { path: 'projects/:id/selftest', element: <ExamStub /> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  resetPomodoroForTesting()
  resetExamModeForTesting()
  useProjectStore.setState({
    projects: [],
    currentProjectId: null,
    loading: false,
    error: null,
    loaded: true,
  })
  useAuthStore.setState({ profile: null })
})

afterEach(() => {
  resetPomodoroForTesting()
  useThemeStore.getState().setUiStyle('lecture')
})

describe('focus pages in the app shell', () => {
  it('lab: the side rail shrinks to icons on a focus page and is full elsewhere', async () => {
    useThemeStore.getState().setUiStyle('lab')
    renderAt('/projects/p1/homework/s1')
    const rail = document.querySelector('[data-sidebar-rail]') as HTMLElement
    expect(rail).not.toBeNull()
    expect(rail.querySelector('[data-sidebar-variant="rail"]')).not.toBeNull()
    // Labels stay available to screen readers.
    const nav = within(rail).getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/dashboard')

    // A tap on the toggle expands it over the page; Escape folds it back.
    fireEvent.click(within(rail).getByRole('button', { name: 'Expand navigation' }))
    expect(rail).toHaveAttribute('data-expanded', 'true')
    expect(rail.querySelector('[data-sidebar-variant="full"]')).not.toBeNull()
    fireEvent.keyDown(within(rail).getByRole('button', { name: 'Collapse navigation' }), {
      key: 'Escape',
    })
    expect(rail).toHaveAttribute('data-expanded', 'false')

    // Keyboard focus entering the rail expands it too.
    // Tab order: skip link, pomodoro, then the rail (before the page).
    const user = userEvent.setup()
    for (let i = 0; i < 6 && !rail.contains(document.activeElement); i += 1) await user.tab()
    expect(rail.contains(document.activeElement)).toBe(true)
    expect(
      screen.getByRole('link', { name: 'Back to Homework' }).compareDocumentPosition(rail),
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING)
    expect(rail).toHaveAttribute('data-expanded', 'true')
  })

  it('lab: an ordinary page keeps the full sidebar', () => {
    useThemeStore.getState().setUiStyle('lab')
    renderAt('/projects/p1/homework')
    expect(document.querySelector('[data-sidebar-rail]')).toBeNull()
    expect(document.querySelector('[data-sidebar-variant="full"]')).not.toBeNull()
  })

  it('lecture: the back header leads back and keeps the page toolbar', () => {
    useThemeStore.getState().setUiStyle('lecture')
    renderAt('/projects/p1/homework/s1')
    expect(document.querySelector('[data-sidebar-rail]')).toBeNull()
    const back = screen.getByRole('navigation', { name: 'Back' })
    expect(within(back).getByRole('link', { name: 'Back to Homework' })).toHaveAttribute(
      'href',
      '/projects/p1/homework',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'HW4.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Walkthrough' })).toBeInTheDocument()
    // The skip link still reaches the working area.
    expect(screen.getByRole('link', { name: /Skip to/ })).toHaveAttribute('href', '#main-content')
  })
})

describe('pomodoro dock', () => {
  it('is shown on ordinary pages and opens its panel', async () => {
    renderAt('/dashboard')
    const trigger = document.querySelector('[data-pomodoro-trigger]') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(trigger).toHaveAccessibleName(/Pomodoro timer: Focus, 25:00 left/)
    const user = userEvent.setup()
    await user.click(trigger)
    const panel = screen.getByRole('dialog', { name: 'Pomodoro timer' })
    await user.click(within(panel).getByRole('button', { name: 'Start' }))
    expect(usePomodoroStore.getState().timer.status).toBe('running')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Pomodoro timer' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    act(() => usePomodoroStore.getState().reset())
  })

  it('is hidden on a mock exam (from the address)', () => {
    renderAt('/projects/p1/homework/s1/exam')
    expect(screen.getByText('Mock exam')).toBeInTheDocument()
    expect(document.querySelector('[data-pomodoro-trigger]')).toBeNull()
    expect(document.querySelector('[data-pomodoro-fab]')).toBeNull()
  })

  it('is hidden and auto-paused while a page declares an exam', () => {
    act(() => usePomodoroStore.getState().start())
    renderAt('/projects/p1/selftest')
    expect(screen.getByText('Self-test')).toBeInTheDocument()
    expect(document.querySelector('[data-pomodoro-trigger]')).toBeNull()
    expect(usePomodoroStore.getState().timer).toMatchObject({
      status: 'paused',
      autoPaused: true,
    })
  })

  it('can be turned off in settings', () => {
    useAuthStore.setState({
      profile: {
        id: 'singleton',
        name: 'S',
        language: 'auto',
        theme: 'system',
        pomodoro: { visible: false },
      },
    })
    renderAt('/dashboard')
    expect(document.querySelector('[data-pomodoro-trigger]')).toBeNull()
  })
})
