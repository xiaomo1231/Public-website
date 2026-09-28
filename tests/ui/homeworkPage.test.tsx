import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HomeworkPage } from '@/pages/HomeworkPage'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'

const holder = vi.hoisted(() => ({ service: null as unknown as HomeworkService }))

vi.mock('@/widgets/project/ProjectFlowNav', () => ({ ProjectFlowNav: () => <div /> }))
vi.mock('@/widgets/homework/HomeworkQuestionView', () => ({
  HomeworkQuestionView: ({ question }: { question: HomeworkQuestion }) => (
    <div data-testid="question-view">{question.prompt}</div>
  ),
}))
vi.mock('@/features/homework/useHomeworkService', () => ({
  useHomeworkService: () => holder.service,
}))

const SET: HomeworkSet = {
  id: 's1',
  projectId: 'p1',
  documentId: 'd1',
  documentName: 'Homework 1.txt',
  title: 'Homework 1.txt',
  status: 'ready',
  language: 'en',
  questionCount: 1,
  promptVersion: 'v1',
  createdAt: 1,
  updatedAt: 1,
}

function question(over: Partial<HomeworkQuestion>): HomeworkQuestion {
  return {
    id: 'q1',
    projectId: 'p1',
    setId: 's1',
    documentId: 'd1',
    documentName: 'Homework 1.txt',
    order: 0,
    prompt: 'Compute the value.',
    sourceRefs: [],
    hints: ['h'],
    solution: 's',
    generationStatus: 'ready',
    promptVersion: 'v1',
    draftText: '',
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

let rows: HomeworkQuestion[]

beforeEach(() => {
  rows = [
    question({ id: 'q1', order: 0 }),
    question({
      id: 'q2',
      order: 1,
      prompt: 'Solve the equation for x.',
      retired: true,
      draftText: 'kept',
    }),
  ]
  holder.service = {
    getSet: vi.fn(async () => SET),
    listQuestions: vi.fn(async () => rows.filter((row) => !row.retired)),
    listRetiredQuestions: vi.fn(async () => rows.filter((row) => row.retired)),
    restoreQuestion: vi.fn(async (id: string) => {
      rows = rows.map((row) => (row.id === id ? { ...row, retired: false } : row))
      return rows.find((row) => row.id === id)
    }),
    deleteQuestion: vi.fn(async () => undefined),
    retrySet: vi.fn(async () => ({
      set: SET,
      summary: { matched: 0, regenerated: 0, added: 0, restored: 1, retired: 0, failed: 0 },
    })),
    saveDraft: vi.fn(),
    revealNextHint: vi.fn(),
    revealSolution: vi.fn(),
    generateContent: vi.fn(),
    ask: vi.fn(),
  } as unknown as HomeworkService
})

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/projects/p1/homework/s1']}>
      <Routes>
        <Route path="/projects/:id/homework/:assignmentId" element={<HomeworkPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomeworkPage archive and re-analysis summary', () => {
  it('lists archived questions and restores one on request', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Removed questions (your work is kept)')).toBeInTheDocument()
    expect(screen.getByText('Solve the equation for x.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restore' }))
    expect(holder.service.restoreQuestion).toHaveBeenCalledWith('q2')

    await waitFor(() =>
      expect(screen.queryByText('Removed questions (your work is kept)')).not.toBeInTheDocument(),
    )
  })

  it('surfaces the restored count after a re-analysis', async () => {
    const user = userEvent.setup()
    renderPage()

    const reanalyze = await screen.findByRole('button', { name: /Re-analyze questions/ })
    await user.click(reanalyze)

    expect(await screen.findByText(/restored 1/)).toBeInTheDocument()
  })
})
