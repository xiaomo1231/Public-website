import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QuestionCard } from '@/widgets/quiz/QuestionCard'
import type { Question } from '@/entities/question/types'

function question(id: string): Question {
  return {
    id,
    projectId: 'p',
    knowledgePoint: 'K',
    type: 'numeric',
    difficulty: 'basic',
    prompt: `Prompt ${id}`,
    correctAnswer: '1',
    hints: ['first hint', 'second hint'],
    sourceRefs: [],
    promptVersion: 'v6',
    createdAt: 1,
  }
}

function card(q: Question, onSubmit: (hints: number) => void) {
  return (
    <QuestionCard
      key={q.id}
      question={q}
      index={0}
      total={2}
      difficulty="basic"
      value="1"
      onChange={() => undefined}
      onSubmit={onSubmit}
      onNext={() => undefined}
      isLast={false}
    />
  )
}

describe('QuestionCard hints', () => {
  it('reports how many hints were revealed and starts the next question with none', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(card(question('a'), onSubmit))
    fireEvent.click(screen.getByRole('button', { name: /show hint/i }))
    expect(screen.getByText('first hint')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(onSubmit).toHaveBeenCalledWith(1)

    rerender(card(question('b'), onSubmit))
    expect(screen.queryByText('first hint')).toBeNull()
  })
})
