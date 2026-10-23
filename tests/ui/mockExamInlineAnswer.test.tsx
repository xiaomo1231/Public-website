import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { MockExamPage } from '@/pages/MockExamPage'

vi.mock('@/services/aiServices', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildAIServices: async () => null,
}))

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})
afterEach(() => db.close())

const SECRET = 'INLINE-KEY: x equals two'

async function seed(submitted: boolean): Promise<string> {
  const project = await new ProjectService(db).create({ name: 'Econ', subject: 'economics' })
  const now = Date.now()
  await db.table('homeworkSets').put({
    id: 'paper',
    projectId: project.id,
    documentId: 'doc',
    documentName: 'midterm.pdf',
    title: 'Midterm',
    kind: 'exam',
    status: 'ready',
    language: 'en',
    questionCount: 1,
    promptVersion: 'v3',
    exam: {
      current: {
        id: 'a1',
        startedAt: now,
        durationMinutes: 60,
        endsAt: now + 3_600_000,
        answers: { q1: 'x = 2' },
        mode: 'online',
        ...(submitted
          ? {
              submittedAt: now,
              checkedAt: now,
              results: [{ questionId: 'q1', status: 'correct', method: 'local' }],
            }
          : {}),
      },
    },
    createdAt: 1,
    updatedAt: now,
  })
  await db.table('homeworkQuestions').put({
    id: 'q1',
    setId: 'paper',
    projectId: project.id,
    documentId: 'doc',
    documentName: 'midterm.pdf',
    order: 0,
    number: '1',
    prompt: 'Find x if x + 1 = 3. (2 marks)',
    sourceRefs: [],
    hints: [],
    generationStatus: 'ready',
    promptVersion: 'v3',
    draftText: '',
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    answerText: SECRET,
    answerStatus: 'matched',
    answerSource: 'inline',
    inlineAnswer: { text: SECRET, chunkIds: ['c1'] },
    createdAt: 1,
    updatedAt: 1,
  })
  return project.id
}

function renderExam(projectId: string) {
  render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/homework/paper/exam`]}>
      <Routes>
        <Route path="/projects/:id/homework/:assignmentId/exam" element={<MockExamPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('模拟考试 with 教授答案（卷内附带）', () => {
  it('never shows the answer printed in the paper while writing', async () => {
    renderExam(await seed(false))
    expect(await screen.findByText(/Find x if x \+ 1 = 3/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('INLINE-KEY')
  })

  it('shows it after the paper is handed in', async () => {
    renderExam(await seed(true))
    await waitFor(() => expect(document.body.textContent).toContain('INLINE-KEY'))
  })
})
