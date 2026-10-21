import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QuestionCard } from '@/widgets/quiz/QuestionCard'
import { optionIndexForKey } from '@/widgets/quiz/quizKeyboard'
import type { Question } from '@/entities/question/types'

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'Arithmetic',
    type: 'multiple_choice',
    difficulty: 'basic',
    prompt: 'What is 2 + 2?',
    correctAnswer: '4',
    options: ['3', '4', '5', '6'].map((label, i) => ({
      id: `opt-${i + 1}`,
      label,
      isCorrect: i === 1,
    })),
    hints: ['think'],
    sourceRefs: [],
    promptVersion: 'v1',
    createdAt: 1,
    ...overrides,
  }
}

function Harness({
  q,
  onSubmit,
  onChange,
}: {
  q: Question
  onSubmit: (h: number) => void
  onChange?: (v: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <>
      <QuestionCard
        question={q}
        index={2}
        total={10}
        difficulty="basic"
        value={value}
        onChange={(v) => {
          setValue(v)
          onChange?.(v)
        }}
        onSubmit={onSubmit}
        onNext={() => undefined}
        isLast={false}
      />
      <input aria-label="elsewhere" />
    </>
  )
}

describe('quiz keyboard', () => {
  it('maps A–F and 1–6 within the option count', () => {
    expect(optionIndexForKey('a', 4)).toBe(0)
    expect(optionIndexForKey('D', 4)).toBe(3)
    expect(optionIndexForKey('3', 4)).toBe(2)
    expect(optionIndexForKey('e', 4)).toBe(-1)
    expect(optionIndexForKey('f', 6)).toBe(5)
    expect(optionIndexForKey('7', 8)).toBe(-1)
    expect(optionIndexForKey('x', 4)).toBe(-1)
  })

  it('picks an option with a letter or number and submits with Enter', () => {
    const onSubmit = vi.fn()
    render(<Harness q={question()} onSubmit={onSubmit} />)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled() // nothing chosen yet

    fireEvent.keyDown(document.body, { key: 'c' })
    expect(screen.getByText('5').closest('button')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(document.body, { key: '2' })
    expect(screen.getByText('4').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('5').closest('button')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith(0)
    expect(screen.getByTestId('quiz-keyboard-hint')).toHaveTextContent('A–D')
  })

  it('ignores keys typed in a text field or held with a modifier', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    render(<Harness q={question()} onSubmit={onSubmit} onChange={onChange} />)
    const field = screen.getByLabelText('elsewhere')
    fireEvent.keyDown(field, { key: 'a' })
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'b', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'c', shiftKey: true })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: 'a' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps Enter on another button for that button (the hint does not submit)', () => {
    const onSubmit = vi.fn()
    render(<Harness q={question()} onSubmit={onSubmit} />)
    fireEvent.keyDown(document.body, { key: 'a' })
    fireEvent.keyDown(screen.getByRole('button', { name: /show hint/i }), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    // Enter on a focused option row submits.
    fireEvent.keyDown(screen.getByText('3').closest('button')!, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('toggles options of a multi-select question', () => {
    const onChange = vi.fn()
    render(
      <Harness
        q={question({ type: 'multiple_select', correctAnswer: 'opt-1,opt-3' })}
        onSubmit={() => undefined}
        onChange={onChange}
      />,
    )
    fireEvent.keyDown(document.body, { key: 'c' })
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(onChange).toHaveBeenLastCalledWith('opt-1,opt-3')
    fireEvent.keyDown(document.body, { key: 'c' })
    expect(onChange).toHaveBeenLastCalledWith('opt-1')
  })

  it('shows no option hint and takes no letters for typed answers', () => {
    const onChange = vi.fn()
    render(
      <Harness
        q={question({ type: 'numeric', options: undefined })}
        onSubmit={() => undefined}
        onChange={onChange}
      />,
    )
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByTestId('quiz-keyboard-hint')).toBeNull()
  })
})
