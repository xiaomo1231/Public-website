import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '@/pages/DashboardPage'
import { useProjectStore } from '@/features/project/projectStore'
import type { Project } from '@/entities/project/types'
import type { CourseOverview, HomeOverview } from '@/services/homeOverviewService'

// The data itself is covered by tests/homeOverview.test.ts; here the overview
// and settings are stubbed so the suite pins what the page shows and links to.
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ profile: { name: 'Ada' } }),
}))

let apiKey = ''
vi.mock('@/features/settings/useAISettings', () => ({
  useAISettings: () => ({ settings: { apiKey }, loaded: true }),
}))

let overviewState: { overview: HomeOverview | null; loading: boolean; error: boolean } = {
  overview: null,
  loading: false,
  error: false,
}
vi.mock('@/features/home/useHomeOverview', () => ({
  useHomeOverview: () => overviewState,
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

function course(p: Project, patch: Partial<CourseOverview> = {}): CourseOverview {
  return {
    project: p,
    materials: { total: 2, processing: 0, failed: 0 },
    analysis: 'ready',
    topicCount: 12,
    homework: { questions: 0, worked: 0 },
    activeMistakes: 0,
    weakPoints: [],
    lastActivityAt: 2,
    nextStep: { kind: 'tutor' },
    ...patch,
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
  apiKey = ''
  overviewState = { overview: null, loading: false, error: false }
  setProjects([])
})

describe('DashboardPage — first run', () => {
  it('greets the learner and walks them through setup, AI first', () => {
    renderDashboard()

    expect(screen.getByRole('heading', { level: 1, name: /, Ada$/ })).toBeInTheDocument()
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    // Step 1 is current; step 2 can still be done; step 3 waits for a project.
    expect(within(steps[0]!).getByRole('link', { name: /Go/ })).toHaveAttribute('href', '/settings')
    expect(within(steps[1]!).getByRole('link', { name: /Go/ })).toHaveAttribute(
      'href',
      '/projects?new=1',
    )
    expect(within(steps[2]!).queryByRole('link')).not.toBeInTheDocument()
  })

  it('marks the AI step done once a key is saved', () => {
    apiKey = 'sk-test'
    renderDashboard()
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(within(steps[0]!).getByText('Done')).toBeInTheDocument()
    expect(within(steps[0]!).queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('DashboardPage — with projects', () => {
  it('resumes the latest activity and lists the next step per course', () => {
    apiKey = 'sk-test'
    const calc = project()
    const physics = project({ id: 'p2', name: 'Physics 101', subject: 'physics' })
    setProjects([calc, physics])
    overviewState.overview = {
      resume: {
        kind: 'homework',
        projectId: 'p1',
        projectName: 'Calculus I',
        at: Date.now() - 60_000,
        setId: 's1',
        title: 'Sheet 3',
        remaining: 2,
      },
      courses: [
        course(calc, {
          homework: { questions: 5, worked: 3 },
          nextStep: { kind: 'homework', setId: 's1', title: 'Sheet 3', remaining: 2 },
        }),
        course(physics, { activeMistakes: 4, nextStep: { kind: 'mistakes', count: 4 } }),
      ],
    }
    renderDashboard()

    expect(screen.getByText(/2 projects · 2 homework questions open · 4 mistakes to review/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sheet 3/ })).toHaveAttribute(
      'href',
      '/projects/p1/homework/s1',
    )
    // The resumed homework is not repeated in "Up next".
    expect(screen.getByRole('link', { name: /Review mistakes/ })).toHaveAttribute(
      'href',
      '/projects/p2/mistakes',
    )
    expect(screen.queryByRole('link', { name: /Continue homework/ })).not.toBeInTheDocument()

    const courses = screen.getByRole('region', { name: 'Your projects' })
    expect(within(courses).getByRole('link', { name: /Calculus I/ })).toHaveAttribute(
      'href',
      '/projects/p1',
    )
    expect(within(courses).getByText('Homework 3/5')).toBeInTheDocument()
    expect(screen.queryByText('No AI service connected yet')).not.toBeInTheDocument()
  })

  it('falls back to the top course next step when there is nothing to resume', () => {
    apiKey = 'sk-test'
    const calc = project()
    setProjects([calc])
    overviewState.overview = {
      resume: null,
      courses: [course(calc, { analysis: 'none', nextStep: { kind: 'analyze' } })],
    }
    renderDashboard()
    expect(screen.getByRole('link', { name: /Analyse the course/ })).toHaveAttribute(
      'href',
      '/projects/p1?tab=analysis',
    )
  })

  it('warns when no AI service is connected', () => {
    setProjects([project()])
    overviewState.overview = { resume: null, courses: [course(project())] }
    renderDashboard()
    expect(screen.getByText('No AI service connected yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Connect AI/ })).toHaveAttribute('href', '/settings')
  })

  it('still lists projects when the summary fails to load', () => {
    apiKey = 'sk-test'
    setProjects([project()])
    overviewState = { overview: null, loading: false, error: true }
    renderDashboard()
    expect(screen.getByRole('status')).toHaveTextContent(/Could not load your study summary/)
    expect(screen.getByRole('link', { name: /Calculus I/ })).toHaveAttribute('href', '/projects/p1')
  })

  it('shows the weakest practised knowledge points across courses', () => {
    apiKey = 'sk-test'
    const calc = project()
    setProjects([calc])
    overviewState.overview = {
      resume: null,
      courses: [
        course(calc, {
          weakPoints: [
            { knowledgePoint: 'chain rule', mastery: 0.45 },
            { knowledgePoint: 'limits', mastery: 0.2 },
          ],
        }),
      ],
    }
    renderDashboard()
    const weak = screen.getByRole('region', { name: 'Worth another look' })
    const links = within(weak).getAllByRole('link')
    expect(links[0]).toHaveTextContent('limits')
    expect(links[0]).toHaveTextContent('20% mastery')
    expect(links[0]).toHaveAttribute('href', '/projects/p1/mastery')
  })

  it('offers a "view all" link only when there are more projects than shown', () => {
    apiKey = 'sk-test'
    const many = Array.from({ length: 6 }, (_, i) => project({ id: `p${i}`, name: `Course ${i}` }))
    setProjects(many)
    overviewState.overview = { resume: null, courses: many.map((p) => course(p)) }
    renderDashboard()
    expect(screen.getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/projects')
  })
})
