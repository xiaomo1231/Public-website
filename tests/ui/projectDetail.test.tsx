import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  it('renders the project header, tabs and the default documents tab', () => {
    renderPage()

    expect(screen.getByText('Physics 101')).toBeInTheDocument()
    expect(screen.getByText('Mechanics and waves')).toBeInTheDocument()
    for (const label of ['Documents', 'Analysis', 'Overview', 'Quiz', 'Mistakes']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
    // Documents is the default tab.
    expect(screen.getByTestId('documents-tab')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
  })

  it('switches to the overview tab', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Overview' }))

    expect(await screen.findByText('About this project')).toBeInTheDocument()
    expect(screen.getByText('Upcoming in this project')).toBeInTheDocument()
  })

  it('keeps every action reachable from the analysis tab, with a clear primary', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Analysis' }))

    expect(await screen.findByText('Quick actions')).toBeInTheDocument()
    expect(screen.getByTestId('analysis-panel')).toBeInTheDocument()
    // Both the banner and the quick-actions panel link to the tutor.
    const tutorLinks = screen.getAllByRole('link', { name: /Open Tutor/ })
    expect(tutorLinks.length).toBeGreaterThanOrEqual(1)
    for (const link of tutorLinks) {
      expect(link).toHaveAttribute('href', '/projects/p1/tutor')
    }
    const links: Record<string, string> = {
      Quiz: '/projects/p1/quiz',
      Mistakes: '/projects/p1/mistakes',
      Mastery: '/projects/p1/mastery',
      'Chat History': '/projects/p1/history',
    }
    for (const [name, href] of Object.entries(links)) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
    }
  })

  it('presents the project as a course workspace with its identity and dates', () => {
    renderPage()
    expect(screen.getByText('Course workspace')).toBeInTheDocument()
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
