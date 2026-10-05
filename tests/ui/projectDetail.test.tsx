import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { useProjectStore } from '@/features/project/projectStore'
import type { Project } from '@/entities/project/types'

// The tab bodies are covered elsewhere; this suite pins the page shell: the
// header, the tab navigation and the action hierarchy.
vi.mock('@/widgets/documents/ProjectDocumentsTab', () => ({
  ProjectDocumentsTab: () => <div data-testid="documents-tab" />,
}))
vi.mock('@/widgets/documentAnalysis/CourseAnalysisPanel', () => ({
  CourseAnalysisPanel: () => <div data-testid="analysis-panel" />,
}))

const PROJECT: Project = {
  id: 'p1',
  name: 'Physics 101',
  subject: 'physics',
  description: 'Mechanics and waves',
  createdAt: 1,
  updatedAt: 2,
}

function renderPage(): void {
  useProjectStore.setState({
    projects: [PROJECT],
    currentProjectId: null,
    loading: false,
    error: null,
    loaded: true,
  })
  render(
    <MemoryRouter initialEntries={['/projects/p1']}>
      <Routes>
        <Route path="/projects" element={<div>Projects list</div>} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useProjectStore.setState({
    projects: [],
    currentProjectId: null,
    loading: false,
    error: null,
    loaded: false,
  })
})

describe('ProjectDetailPage', () => {
  it('renders the project header, its two tabs and the default documents tab', () => {
    renderPage()

    expect(screen.getByText('Physics 101')).toBeInTheDocument()
    expect(screen.getByText('Mechanics and waves')).toBeInTheDocument()
    // Only real content tabs: quiz / mistakes live on their own pages, not as
    // placeholder tabs that always look empty.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Documents',
      'Analysis',
    ])
    expect(screen.getByTestId('documents-tab')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('opens the analysis tab from the URL and keeps the tab in the URL', async () => {
    const user = userEvent.setup()
    useProjectStore.setState({
      projects: [PROJECT],
      currentProjectId: null,
      loading: false,
      error: null,
      loaded: true,
    })
    render(
      <MemoryRouter initialEntries={['/projects/p1?tab=analysis']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('analysis-panel')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Documents' }))
    expect(await screen.findByTestId('documents-tab')).toBeInTheDocument()
  })

  it('uses the shared course navigation, with a clear primary action', async () => {
    const user = userEvent.setup()
    renderPage()

    const nav = screen.getByRole('navigation', { name: 'Course sections' })
    expect(within(nav).getByRole('link', { name: 'Course home' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const links: Record<string, string> = {
      Files: '/projects/p1/files',
      Homework: '/projects/p1/homework',
      Tutor: '/projects/p1/tutor',
      Quiz: '/projects/p1/quiz',
      Mistakes: '/projects/p1/mistakes',
      Mastery: '/projects/p1/mastery',
      History: '/projects/p1/history',
    }
    for (const [name, href] of Object.entries(links)) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href)
    }
    expect(screen.getByRole('link', { name: /Open Tutor/ })).toHaveAttribute(
      'href',
      '/projects/p1/tutor',
    )

    await user.click(screen.getByRole('tab', { name: 'Analysis' }))
    expect(await screen.findByTestId('analysis-panel')).toBeInTheDocument()
  })

  it('presents the project as a course workspace with its identity and dates', () => {
    renderPage()
    expect(screen.getByText('Physics 101')).toBeInTheDocument()
    expect(screen.getByText(/Created:/)).toBeInTheDocument()
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument()
    // The primary workspace action is available from the banner.
    expect(screen.getAllByRole('link', { name: /Open Tutor/ }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Mechanics and waves')).toBeInTheDocument()
  })

  it('does not render a not-found state while the project list is still loading', () => {
    useProjectStore.setState({ projects: [], loaded: false, loading: true })
    render(
      <MemoryRouter initialEntries={['/projects/p1']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Loading project')).toBeInTheDocument()
    expect(screen.queryByText('Project not found')).not.toBeInTheDocument()
  })
})
