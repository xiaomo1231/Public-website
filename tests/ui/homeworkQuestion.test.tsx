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
    loadQuestionSourcePages: vi.fn(async () => []),
    resolveQuestionSources: vi.fn(async () => QUESTION.sourceRefs),
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
    const { container } = render(<HomeworkQuestionView question={QUESTION} service={service} />)

    expect(screen.getByText(/Find the limit/)).toBeInTheDocument()
    expect(container.querySelector('[data-selection-context="homework"]')).toHaveAttribute('data-selection-title', '1')
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

  it('keeps the question in its own anchored region with a control to return to it', async () => {
    const service = stubService()
    const scrollSpy = vi.fn()
    ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy
    const { container } = render(<HomeworkQuestionView question={QUESTION} service={service} />)

    // The question has a stable, scrollable anchor and the working area is
    // rendered beside it (single column below lg).
    expect(container.querySelector('#homework-question-q1')).toBeInTheDocument()
    expect(screen.getByLabelText('Your working')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'View question' }))
    expect(scrollSpy).toHaveBeenCalled()

    delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView
  })
})

const FORMULA_QUESTION: HomeworkQuestion = {
  ...QUESTION,
  id: 'q2',
  number: '2',
  prompt: 'Compute $P(x)=ax^2+bx+c$.',
  hints: ['Use $P(x)=ax^2+bx+c$ and the coefficients $a,b,c$.', 'Check the point $(x,P(x))$.'],
  messages: [
    { id: 'm1', role: 'student', content: 'Why $a$?', createdAt: 1 },
    {
      id: 'm2',
      role: 'assistant',
      content: 'Because $a,b,c$ are the coefficients of $P(x)$.',
      createdAt: 2,
    },
  ],
}

function formulaService(question: HomeworkQuestion = FORMULA_QUESTION): HomeworkService {
  return {
    loadQuestionSourcePages: vi.fn(async () => []),
    resolveQuestionSources: vi.fn(async () => question.sourceRefs),
    saveDraft: vi.fn(async () => question),
    revealNextHint: vi.fn(async () => ({ ...question, revealedHints: 1 })),
    revealSolution: vi.fn(async () => ({ ...question, solutionRevealed: true })),
    generateContent: vi.fn(async () => question),
    ask: vi.fn(async () => ({
      id: 'a1',
      role: 'assistant' as const,
      content: 'Because $a,b,c$ are the coefficients of $P(x)$.',
      createdAt: 3,
    })),
  } as unknown as HomeworkService
}

describe('HomeworkQuestionView formula rendering', () => {
  it('typesets a saved hint instead of showing raw LaTeX delimiters', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <HomeworkQuestionView question={FORMULA_QUESTION} service={formulaService()} />,
    )

    // The prompt is already typeset.
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1)
    expect(container.textContent).not.toContain('$P(x)')

    await user.click(screen.getByRole('button', { name: /Hint/ }))

    // Hints reveal one at a time; the first hint's two formulas are typeset.
    expect(await screen.findByText('Hint 1 of 2')).toBeInTheDocument()
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3)
    expect(container.textContent).not.toContain('$P(x)')
    expect(container.textContent).not.toContain('$a,b,c$')
    // The saved draft and hint progress are untouched by rendering.
    expect(screen.getByLabelText('Your working')).toHaveValue('my partial working')
  })

  it('typesets the tutor reply but shows the student text verbatim', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <HomeworkQuestionView question={FORMULA_QUESTION} service={formulaService()} />,
    )

    await user.click(screen.getByRole('button', { name: /^Ask$/ }))
    expect(await screen.findByText(/Because/)).toBeInTheDocument()

    // The assistant reply's formula is typeset, not shown as `$…$`.
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3)
    expect(container.textContent).not.toContain('$a,b,c$')
    // The student's own words are shown exactly as written: a complete `$a$`
    // span stays literally `$a$` (it is never typeset).
    expect(container.textContent).toContain('Why $a$?')
  })

  it('falls back to readable source when a hint formula cannot be parsed', async () => {
    const user = userEvent.setup()
    const broken: HomeworkQuestion = {
      ...FORMULA_QUESTION,
      hints: ['This is broken: $\\frac{1}{$ here.'],
    }
    const { container } = render(
      <HomeworkQuestionView question={broken} service={formulaService(broken)} />,
    )

    await user.click(screen.getByRole('button', { name: /Hint/ }))

    // The card survives and the unparseable source is shown in a code fallback.
    expect(await screen.findByText(/This is broken:/)).toBeInTheDocument()
    expect(container.querySelector('code')?.textContent).toContain('\\frac')
  })
})
