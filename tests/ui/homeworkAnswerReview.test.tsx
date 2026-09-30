import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HomeworkQuestionView } from '@/widgets/homework/HomeworkQuestionView'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'

const ANSWERED: HomeworkQuestion = {
  id: 'q1',
  projectId: 'p1',
  setId: 's1',
  documentId: 'd1',
  documentName: 'hw.txt',
  order: 0,
  number: '1',
  prompt: 'Add 4 and 5.',
  sourceRefs: [],
  hints: ['Think about place value.'],
  solution: 'The answer is $9$.',
  generationStatus: 'ready',
  promptVersion: 'v3',
  answerText: 'Answer: $4 + 5 = 9$.',
  answerNumber: '1',
  answerStatus: 'matched',
  answerBased: true,
  previousSolution: 'An older AI-only solution.',
  draftText: '',
  revealedHints: 0,
  solutionRevealed: false,
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

function stubService() {
  const generateAnswerForQuestion = vi.fn(async () => ANSWERED)
  const generateContent = vi.fn(async () => ANSWERED)
  const service = {
    loadQuestionSourcePages: vi.fn(async () => []),
    resolveQuestionSources: vi.fn(async () => []),
    saveDraft: vi.fn(async () => ANSWERED),
    revealNextHint: vi.fn(async () => ({ ...ANSWERED, revealedHints: 1 })),
    revealSolution: vi.fn(async () => ({ ...ANSWERED, solutionRevealed: true })),
    generateContent,
    generateAnswerForQuestion,
    ask: vi.fn(async () => ({ id: 'a1', role: 'assistant' as const, content: 'ok', createdAt: 2 })),
  } as unknown as HomeworkService
  return { service, generateAnswerForQuestion, generateContent }
}

function renderView(mode: 'practice' | 'review') {
  const { service, generateAnswerForQuestion, generateContent } = stubService()
  render(
    <MemoryRouter>
      <HomeworkQuestionView
        question={ANSWERED}
        service={service}
        mode={mode}
        answerDocumentId="a1"
      />
    </MemoryRouter>,
  )
  return { generateAnswerForQuestion, generateContent }
}

describe('HomeworkQuestionView professor answer', () => {
  it('hides the professor answer while practising', () => {
    renderView('practice')
    expect(screen.queryByText(/Professor answer \(verbatim\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/4 \+ 5 = 9/)).not.toBeInTheDocument()
  })

  it('shows the professor answer, labels the explanation and links the file in review', () => {
    renderView('review')
    expect(screen.getByText(/Professor answer \(verbatim\)/)).toBeInTheDocument()
    // The answer text is typeset through RichText (KaTeX), not raw.
    expect(screen.queryByText(/\$4 \+ 5/)).not.toBeInTheDocument()
    expect(screen.getByText(/AI explanation based on the professor answer/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open answer file/ })).toBeInTheDocument()
  })

  it('regenerates from the professor answer for a matched question', async () => {
    const user = userEvent.setup()
    const { generateAnswerForQuestion, generateContent } = renderView('review')
    await user.click(screen.getByRole('button', { name: /Regenerate hints/ }))
    await waitFor(() => expect(generateAnswerForQuestion).toHaveBeenCalledWith('q1'))
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('keeps the replaced AI solution available instead of silently overwriting it', async () => {
    const user = userEvent.setup()
    renderView('review')
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    expect(await screen.findByText(/Previous AI solution/)).toBeInTheDocument()
  })
})
