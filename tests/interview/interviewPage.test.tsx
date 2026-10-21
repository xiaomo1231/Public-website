import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { useProjectStore } from '@/features/project/projectStore'
import { InterviewPage } from '@/pages/InterviewPage'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import type { Project } from '@/entities/project/types'
import type { InterviewSession } from '@/entities/interview/types'

// The AI bundle pulls in the file extractors; the page only needs it on click.
vi.mock('@/services/aiServices', () => ({ buildAIServices: async () => null }))

function project(subject: Project['subject']): Project {
  return {
    id: 'p1',
    name: 'Magyar',
    subject,
    ...(subject === 'language' ? { targetLanguage: 'hu' } : {}),
    createdAt: 1,
    updatedAt: 1,
  } as Project
}

const SESSION: InterviewSession = {
  id: 's1',
  projectId: 'p1',
  targetLanguage: 'hu',
  examMode: true,
  scenario: {
    title: 'Szabó József',
    source: 'textbook',
    sourceChunkIds: ['c1'],
    questions: [
      { id: 'q1', label: 'Hogy hívják?', englishGloss: 'Name, age' },
      { id: 'q2', label: 'Van láza?', englishGloss: 'Fever' },
    ],
    facts: [
      { id: 'f1', fact: 'Szabó József vagyok.' },
      { id: 'f2', fact: '66 éves vagyok.' },
      { id: 'f3', fact: 'Igen, 39,2 a lázam.' },
    ],
  },
  turns: [
    {
      role: 'student',
      text: 'Hogy hivják?',
      at: 1,
      coveredQuestionIds: ['q1'],
      correction: 'Hogy hívják?',
    },
    { role: 'patient', text: 'Szabó József vagyok.', at: 1 },
  ],
  summary: '',
  status: 'interviewing',
  createdAt: 1,
  updatedAt: 1,
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:id/interview" element={<InterviewPage />} />
        <Route path="/projects/:id/interview/:sessionId" element={<InterviewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('InterviewPage', () => {
  let db: AppDatabase
  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })
  afterEach(() => db.close())

  it('explains that the interview is for language courses only', () => {
    useProjectStore.setState({
      projects: [project('biology')],
      loaded: true,
      loading: false,
      error: null,
    })
    renderAt('/projects/p1/interview')
    expect(screen.getByText('Patient interviews are for language courses')).toBeInTheDocument()
  })

  it('in exam mode hides the checklist and language notes during the interview', async () => {
    useProjectStore.setState({
      projects: [project('language')],
      loaded: true,
      loading: false,
      error: null,
    })
    await db.interviewSessions.put(SESSION)
    renderAt('/projects/p1/interview/s1')
    expect(await screen.findByText('Szabó József vagyok.')).toBeInTheDocument()
    expect(screen.getByText('Exam mode: the checklist is shown at the end.')).toBeInTheDocument()
    expect(screen.queryByText('Language note')).not.toBeInTheDocument()
    expect(screen.queryByText('Van láza?')).not.toBeInTheDocument()
  })

  it('lists the interview tab only for language courses', () => {
    useProjectStore.setState({
      projects: [project('language')],
      loaded: true,
      loading: false,
      error: null,
    })
    const { unmount } = render(
      <MemoryRouter>
        <ProjectFlowNav projectId="p1" active="home" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Interview' })).toBeInTheDocument()
    unmount()
    useProjectStore.setState({ projects: [project('medicine')] })
    render(
      <MemoryRouter>
        <ProjectFlowNav projectId="p1" active="home" />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: 'Interview' })).not.toBeInTheDocument()
  })
})
