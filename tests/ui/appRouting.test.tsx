import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter, useParams } from 'react-router-dom'
import { ProjectScope } from '@/app/layout/ProjectScope'
import { AppShell } from '@/app/layout/AppShell'
import { NotFoundPage, RouteError } from '@/app/RouteError'
import { safeReturnPath } from '@/features/auth/returnPath'
import { useProjectStore } from '@/features/project/projectStore'
import { useThemeStore } from '@/features/theme/themeStore'
import { useToastStore } from '@/features/toast/toastStore'
import { Toaster } from '@/shared/ui/Toast'
import type { Project } from '@/entities/project/types'

const PROJECT: Project = {
  id: 'p1',
  name: 'Physics 101',
  subject: 'physics',
  description: '',
  createdAt: 1,
  updatedAt: 2,
}

function seedProjects(projects: Project[], error: string | null = null): void {
  useProjectStore.setState({
    projects,
    currentProjectId: null,
    loading: false,
    error,
    loaded: true,
  })
}

function HomeworkStub(): JSX.Element {
  const { id } = useParams()
  return <div>Homework for {id}</div>
}

function Boom(): JSX.Element {
  throw new Error('render exploded')
}

function renderRoutes(path: string): void {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        errorElement: <RouteError fullScreen />,
        children: [
          {
            errorElement: <RouteError />,
            children: [
              { path: 'dashboard', element: <div>Dashboard</div> },
              { path: 'boom', element: <Boom /> },
              {
                element: <ProjectScope />,
                children: [{ path: 'projects/:id/homework', element: <HomeworkStub /> }],
              },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  seedProjects([])
  useToastStore.setState({ toasts: [] })
})

describe('project-scoped routes', () => {
  it('renders the page for a known project', () => {
    seedProjects([PROJECT])
    renderRoutes('/projects/p1/homework')
    expect(screen.getByText('Homework for p1')).toBeInTheDocument()
  })

  it('shows "project not found" instead of an empty landing for an unknown id', () => {
    seedProjects([PROJECT])
    renderRoutes('/projects/deleted/homework')
    expect(screen.getByText('Project not found')).toBeInTheDocument()
    expect(screen.queryByText(/Homework for/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to projects/ })).toHaveAttribute(
      'href',
      '/projects',
    )
  })

  it('reports a failed project load instead of "not found"', () => {
    seedProjects([], 'disk unavailable')
    renderRoutes('/projects/p1/homework')
    expect(screen.getByText('Failed to load projects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('router error and not-found states', () => {
  it('renders the localized error UI with a way home when a page throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRoutes('/boom')
    spy.mockRestore()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to home/ })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('button', { name: /Reload page/ })).toBeInTheDocument()
  })

  it('shows "page not found" for an unknown address', () => {
    renderRoutes('/no-such-page')
    expect(screen.getByText('Page not found')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })
})

describe('safeReturnPath', () => {
  it('returns same-app paths and rejects everything else', () => {
    expect(safeReturnPath({ from: '/projects/p1/quiz?x=1' })).toBe('/projects/p1/quiz?x=1')
    expect(safeReturnPath(undefined)).toBe('/dashboard')
    expect(safeReturnPath({ from: 'https://evil.example' })).toBe('/dashboard')
    expect(safeReturnPath({ from: '//evil.example/x' })).toBe('/dashboard')
    expect(safeReturnPath({ from: '/\\evil.example' })).toBe('/dashboard')
    expect(safeReturnPath({ from: '/invite' })).toBe('/dashboard')
    expect(safeReturnPath({ from: '/' })).toBe('/dashboard')
    expect(safeReturnPath({ from: 42 })).toBe('/dashboard')
  })
})

describe('app shell per interface style', () => {
  it('lecture: a top bar with the four places and no drawer', () => {
    useThemeStore.getState().setUiStyle('lecture')
    seedProjects([PROJECT])
    const router = createMemoryRouter(
      [{ path: '/', element: <AppShell />, children: [{ index: true, element: <div>Home</div> }] }],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-nav')).toBeNull()
  })
})

describe('mobile navigation drawer (lab style)', () => {
  it('is inert while closed, takes focus when opened and closes on Escape', async () => {
    useThemeStore.getState().setUiStyle('lab')
    seedProjects([PROJECT])
    const router = createMemoryRouter(
      [{ path: '/', element: <AppShell />, children: [{ index: true, element: <div>Home</div> }] }],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    const drawer = screen.getByTestId('mobile-nav')
    expect(drawer).toHaveAttribute('inert')

    const user = userEvent.setup()
    const opener = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(opener)
    expect(drawer).not.toHaveAttribute('inert')
    expect(drawer.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(drawer).toHaveAttribute('inert')
    expect(document.activeElement).toBe(opener)
  })
})

describe('toasts', () => {
  it('gives the close button an accessible name and leaves the timer to Radix', () => {
    vi.useFakeTimers()
    try {
      render(<Toaster />)
      act(() => {
        useToastStore.getState().push({ title: 'Saved', duration: 1000 })
      })
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
      // The store itself never removes a toast on a timer; Radix does, via
      // onOpenChange(false) — which pauses while hovered or focused.
      expect(useToastStore.getState().toasts).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
