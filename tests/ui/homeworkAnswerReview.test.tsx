import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HomeworkQuestionView } from '@/widgets/homework/HomeworkQuestionView'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'
import type { HomeworkReviewGuide } from '@/entities/homework/reviewGuide'

const REVIEW: HomeworkReviewGuide = {
  questionMeaning: 'Find the sum of 4 and 5.',
  knowledgePoints: ['Addition combines two quantities.'],
  method: 'Add the units.',
  steps: ['Write $4+5$.', 'Compute $4+5=9$.'],
  explanation: 'The result is 9 because five more than four is nine.',
  interpretation: 'The sum is 9.',
  check: 'Subtract 5 from 9 to get 4.',
  language: 'en', promptVersion: 'v1', inputHash: 'test',
  questionSourceRefs: [], answerChunkIds: [], createdAt: 1,
}

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
    loadAnswerSourcePages: vi.fn(async () => []),
    getOrGenerateReviewGuide: vi.fn(async () => REVIEW),
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
  return { generateAnswerForQuestion, generateContent, service }
}

describe('HomeworkQuestionView professor answer', () => {
  it('hides the professor answer while practising', () => {
    renderView('practice')
    expect(screen.queryByText(/Professor answer \(verbatim\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/4 \+ 5 = 9/)).not.toBeInTheDocument()
  })

  it('shows the complete teaching review first and keeps the original answer collapsed', async () => {
    const user = userEvent.setup()
    const { service } = renderView('review')
    expect(await screen.findByText('Addition combines two quantities.')).toBeInTheDocument()
    expect(screen.getByText('Add the units.')).toBeInTheDocument()
    expect(screen.getByText('The sum is 9.')).toBeInTheDocument()
    expect(service.getOrGenerateReviewGuide).toHaveBeenCalledWith('q1', 'en')
    expect(screen.getByText(/Professor answer \(verbatim\)/)).toBeInTheDocument()
    expect(screen.getByText(/Professor answer \(verbatim\)/).closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/AI explanation based on the professor answer/)).toBeInTheDocument()
    await user.click(screen.getByText(/Professor answer \(verbatim\)/))
    expect(screen.getByRole('link', { name: /Open answer file/ })).toBeInTheDocument()
  })

  it('renders escaped line breaks from an older cached check as a list', async () => {
    const { service } = stubService()
    vi.mocked(service.getOrGenerateReviewGuide).mockResolvedValue({
      ...REVIEW,
      check: '正确性核对\\n- $P(0)=5$\\n- $P(1)=8$\\n\\n三个点均符合。',
    })
    render(<MemoryRouter><HomeworkQuestionView question={ANSWERED} service={service} mode="review" /></MemoryRouter>)
    const heading = await screen.findByText('Final check')
    const section = heading.closest('section')
    expect(section?.querySelectorAll('li')).toHaveLength(2)
    expect(section?.textContent).not.toContain('\\n-')
    expect(section?.textContent).toContain('三个点均符合。')
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
