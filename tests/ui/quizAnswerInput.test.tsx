import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnswerInput } from '@/widgets/quiz/AnswerInput'
import type { Question, QuestionOption } from '@/entities/question/types'

/**
 * Regression cover for "single-choice options render with no content".
 * The option rows must show real text, and clicking one must submit its id.
 */

function options(labels: string[], correctIndex: number): QuestionOption[] {
  return labels.map((label, i) => ({
    id: `opt-${i + 1}`,
    label,
    isCorrect: i === correctIndex,
  }))
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'Arithmetic',
    type: 'multiple_choice',
    difficulty: 'basic',
    prompt: 'What is 2 + 2?',
    correctAnswer: '4',
    hints: [],
    sourceRefs: [],
    promptVersion: 'v1',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('AnswerInput — single choice', () => {
  it('renders every option label as visible, non-empty text', () => {
    render(
      <AnswerInput
        question={question({ options: options(['3', '4', '5', '6'], 1) })}
        value=""
        onChange={() => undefined}
      />,
    )

    for (const label of ['3', '4', '5', '6']) {
      const node = screen.getByText(label)
      expect(node).toBeInTheDocument()
      expect(node.textContent?.trim()).not.toBe('')
    }
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('submits the option id when an option is chosen', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AnswerInput
        question={question({ options: options(['3', '4', '5', '6'], 1) })}
        value=""
        onChange={onChange}
      />,
    )

    await user.click(screen.getByText('4'))
    expect(onChange).toHaveBeenCalledWith('opt-2')
  })

  it('marks the chosen option as selected', () => {
    render(
      <AnswerInput
        question={question({ options: options(['3', '4', '5', '6'], 1) })}
        value="opt-3"
        onChange={() => undefined}
      />,
    )
    const selected = screen.getByText('5').closest('button')
    expect(selected?.className).toContain('bg-accent')
  })

  it('renders no rows when a question has no options', () => {
    render(<AnswerInput question={question()} value="" onChange={() => undefined} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('AnswerInput — other types unchanged', () => {
  it('renders true/false buttons', () => {
    render(
      <AnswerInput
        question={question({ type: 'true_false', correctAnswer: 'true' })}
        value=""
        onChange={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'True' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'False' })).toBeInTheDocument()
  })

  it('renders a numeric input', () => {
    render(
      <AnswerInput
        question={question({ type: 'numeric', correctAnswer: '9.81' })}
        value=""
        onChange={() => undefined}
      />,
    )
    expect(screen.getByPlaceholderText('Enter a number, e.g. 9.81')).toBeInTheDocument()
  })

  it('renders a math-expression input', () => {
    render(
      <AnswerInput
        question={question({ type: 'math_expr', correctAnswer: '3x^2' })}
        value=""
        onChange={() => undefined}
      />,
    )
    expect(screen.getByPlaceholderText('e.g. x^3/3 + C')).toBeInTheDocument()
  })
})
