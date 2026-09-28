import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeworkQuestionView } from '@/widgets/homework/HomeworkQuestionView'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'

const QUESTION: HomeworkQuestion = {
  id: 'q1',
  projectId: 'p1',
  setId: 's1',
  documentId: 'd1',
  documentName: 'hw.txt',
  order: 0,
  number: '1',
  prompt: 'Find the limit of x squared as x tends to 3.',
  sourceRefs: [],
  hints: ['Hint one', 'Hint two'],
  solution: 'The full solution.',
  generationStatus: 'ready',
  promptVersion: 'v1',
  draftText: 'my partial working',
  revealedHints: 0,
  solutionRevealed: false,
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

function stubService(): HomeworkService {
  return {
    saveDraft: vi.fn(async () => QUESTION),
    revealNextHint: vi.fn(async () => ({ ...QUESTION, revealedHints: 1 })),
    revealSolution: vi.fn(async () => ({ ...QUESTION, solutionRevealed: true })),
    generateContent: vi.fn(async () => QUESTION),
    ask: vi.fn(async () => ({
      id: 'a1',
      role: 'assistant' as const,
      content: 'Start by writing what you know.',
      createdAt: 2,
    })),
  } as unknown as HomeworkService
}

describe('HomeworkQuestionView', () => {
  it('hides hints and the solution until asked, and keeps the draft', async () => {
    const user = userEvent.setup()
    const service = stubService()
    render(<HomeworkQuestionView question={QUESTION} service={service} />)

    expect(screen.getByText(/Find the limit/)).toBeInTheDocument()
    expect(screen.queryByText('Hint one')).not.toBeInTheDocument()
    expect(screen.queryByText('The full solution.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Hint/ }))
    expect(service.revealNextHint).toHaveBeenCalledWith('q1')
    expect(await screen.findByText('Hint one')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    expect(service.revealSolution).toHaveBeenCalledWith('q1')
    expect(await screen.findByText('The full solution.')).toBeInTheDocument()
    // Revealing the answer must not clear the student's working.
    expect(screen.getByLabelText('Your working')).toHaveValue('my partial working')
  })

  it('sends a question to the tutor and shows the reply', async () => {
    const user = userEvent.setup()
    const service = stubService()
    render(<HomeworkQuestionView question={QUESTION} service={service} />)

    await user.click(screen.getByRole('button', { name: /Ask/ }))
    const input = screen.getByLabelText('Ask about this question')
    await user.type(input, 'Where do I start?')
    await user.click(screen.getByRole('button', { name: /Send/ }))

    expect(service.ask).toHaveBeenCalledWith('q1', 'Where do I start?')
    expect(await screen.findByText('Start by writing what you know.')).toBeInTheDocument()
  })
})
