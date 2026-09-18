import { describe, expect, it } from 'vitest'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import type { Question, QuestionType } from '@/entities/question/types'

function question(overrides: Partial<Question> & { type: QuestionType }): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'KP',
    difficulty: 'basic',
    prompt: 'Q?',
    correctAnswer: 'answer',
    hints: [],
    sourceRefs: [],
    promptVersion: 'v1',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('evaluateDeterministic — multiple choice', () => {
  const q = question({
    type: 'multiple_choice',
    prompt: 'Pick one',
    correctAnswer: 'opt-2',
    options: [
      { id: 'opt-1', label: 'First', isCorrect: false },
      { id: 'opt-2', label: 'Second', isCorrect: true },
      { id: 'opt-3', label: 'Third', isCorrect: false },
    ],
  })

  it('accepts the option id', () => {
    const r = evaluateDeterministic(q, 'opt-2')
    expect(r.isCorrect).toBe(true)
    expect(r.method).toBe('option_id')
  })

  it('accepts the option label', () => {
    expect(evaluateDeterministic(q, 'Second').isCorrect).toBe(true)
  })

  it('rejects the wrong option', () => {
    expect(evaluateDeterministic(q, 'opt-1').isCorrect).toBe(false)
  })

  it('is case-insensitive on labels', () => {
    expect(evaluateDeterministic(q, 'second').isCorrect).toBe(true)
  })
})

describe('evaluateDeterministic — true/false', () => {
  const q = question({ type: 'true_false', prompt: 'True?', correctAnswer: 'true' })

  it.each([
    ['true', true],
    ['True', true],
    ['yes', true],
    ['1', true],
    ['false', false],
    ['False', false],
    ['no', false],
    ['0', false],
  ])('interprets %s', (input, expected) => {
    expect(evaluateDeterministic(q, input as string).isCorrect).toBe(expected)
  })

  it('rejects nonsense', () => {
    const r = evaluateDeterministic(q, 'maybe')
    expect(r.isCorrect).toBe(false)
  })
})

describe('evaluateDeterministic — numeric', () => {
  const q = question({ type: 'numeric', prompt: 'Value?', correctAnswer: '9.81' })

  it('accepts an exact match', () => {
    expect(evaluateDeterministic(q, '9.81').isCorrect).toBe(true)
  })

  it('accepts a value within 1%', () => {
    expect(evaluateDeterministic(q, '9.8').isCorrect).toBe(true)
  })

  it('rejects a value outside tolerance', () => {
    expect(evaluateDeterministic(q, '9.5').isCorrect).toBe(false)
  })

  it('returns unverified for non-numeric input', () => {
    const r = evaluateDeterministic(q, 'about ten')
    expect(r.isCorrect).toBeNull()
    expect(r.note).toMatch(/verify/i)
  })

  it('rejects an empty answer', () => {
    expect(evaluateDeterministic(q, '').isCorrect).toBe(false)
  })

  it('handles fractions', () => {
    const q2 = question({ type: 'numeric', prompt: 'Half?', correctAnswer: '0.5' })
    expect(evaluateDeterministic(q2, '1/2').isCorrect).toBe(true)
  })
})

describe('evaluateDeterministic — math expression', () => {
  const q = question({ type: 'math_expr', prompt: 'Integrate', correctAnswer: 'x^3/3 + C' })

  it('accepts an equivalent expression', () => {
    const r = evaluateDeterministic(q, 'x^3/3')
    expect(r.isCorrect).toBe(true)
    expect(r.method).toBe('math_equivalent')
  })

  it('accepts a unicode form', () => {
    expect(evaluateDeterministic(q, '(1/3)x³').isCorrect).toBe(true)
  })

  it('rejects a non-equivalent expression', () => {
    expect(evaluateDeterministic(q, 'x^2/2').isCorrect).toBe(false)
  })

  it('returns unverified when parsing fails', () => {
    const r = evaluateDeterministic(q, '¯\\_(ツ)_/¯')
    expect(r.isCorrect).toBeNull()
    expect(r.note).toMatch(/verify/i)
  })
})
