import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '@/pages/DashboardPage'
import { useProjectStore } from '@/features/project/projectStore'
import type { Project } from '@/entities/project/types'

// The dashboard's heavy widgets are covered by their own suites; here we focus
// on the page structure, its data summary and its calls to action.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ profile: { name: 'Ada' } }),
}))
vi.mock('@/widgets/theme/ThemePicker', () => ({
  ThemePicker: () => <div data-testid="theme-picker" />,
}))
vi.mock('@/widgets/mistakes/WeaknessPanel', () => ({
  WeaknessPanel: () => <div data-testid="weakness-panel" />,
}))

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Calculus I',
    subject: 'calculus',
    description: '',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function setProjects(projects: Project[]): void {
  useProjectStore.setState({
    projects,
    currentProjectId: null,
    loading: false,
    error: null,
    loaded: true,
  })
}

function renderDashboard(): void {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setProjects([])
})

describe('DashboardPage', () => {
  it('welcomes the learner and shows a clear empty state', () => {
    renderDashboard()

    expect(screen.getByRole('heading', { name: /Welcome, Ada/ })).toBeInTheDocument()
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByTestId('theme-picker')).toBeInTheDocument()
    // The empty-state call to action is present.
    expect(screen.getAllByRole('link', { name: /Create your first project/ }).length).toBeGreaterThan(0)
  })

  it('summarises projects and links to the most recent ones', () => {
    setProjects([
      project(),
      project({ id: 'p2', name: 'Physics 101', subject: 'physics' }),
    ])
    renderDashboard()

    expect(screen.getByRole('heading', { name: 'Ready to continue' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Calculus I/ })).toHaveAttribute('href', '/projects/p1')
    expect(screen.getByRole('link', { name: /Physics 101/ })).toHaveAttribute('href', '/projects/p2')
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument()
    expect(screen.getByTestId('weakness-panel')).toBeInTheDocument()
  })

  it('offers a "view all" link only when the list is longer than the preview', () => {
    setProjects(
      Array.from({ length: 5 }, (_, index) =>
        project({ id: `p${index}`, name: `Course ${index}` }),
      ),
    )
    renderDashboard()
    expect(screen.getByRole('link', { name: /View all/ })).toBeInTheDocument()
  })

  it('does not add a "view all" link for a short list', () => {
    setProjects([project()])
    renderDashboard()
    expect(screen.queryByRole('link', { name: /View all/ })).not.toBeInTheDocument()
  })

  it('spotlights the most recent project instead of an empty state', () => {
    setProjects([project()])
    renderDashboard()
    expect(screen.getByText('Continue learning')).toBeInTheDocument()
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument()
  })

  it('shows the local-first reassurance and the primary workspace action', () => {
    renderDashboard()
    expect(screen.getByText('Local-first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /My Projects/ })).toHaveAttribute('href', '/projects')
  })
})
