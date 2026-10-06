import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QuizService } from '@/services/quizService'
import type { AIService } from '@/services/aiService'
import type { QuizGenerationOutput } from '@/infrastructure/ai/prompts/quiz-generator/v5'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import { expectedAnswerText, questionTypesForSubject, type Question } from '@/entities/question/types'
import { scoreOrdering, shuffledForDisplay } from '@/infrastructure/math/orderingAnswer'
import { inferSubject } from '@/entities/project/subjectInference'
import { OrderingInput } from '@/widgets/quiz/OrderingInput'

function question(overrides: Partial<Question>): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'K',
    type: 'chem_equation',
    difficulty: 'basic',
    prompt: 'Write the equation.',
    correctAnswer: '2H2 + O2 -> 2H2O',
    hints: [],
    sourceRefs: [],
    promptVersion: 'v4',
    createdAt: 1,
    ...overrides,
  }
}

describe('chemical equation grading', () => {
  const q = question({})

  it('accepts the same balanced equation in any notation', () => {
    expect(evaluateDeterministic(q, '2 H₂ + O₂ → 2 H₂O')).toMatchObject({ isCorrect: true, method: 'chem_equation' })
    expect(evaluateDeterministic(q, 'O2 + 2H2 = 2H2O').isCorrect).toBe(true)
  })

  it('explains what is wrong', () => {
    expect(evaluateDeterministic(q, 'H2 + O2 -> H2O')).toMatchObject({ isCorrect: false })
    expect(evaluateDeterministic(q, 'H2 + O2 -> H2O').note).toMatch(/balance/i)
    expect(evaluateDeterministic(q, '2H2 + O2 -> 2H2O2').note).toBeTruthy()
    // A common multiple of the coefficients is the same balanced equation.
    expect(evaluateDeterministic(q, '4H2 + 2O2 -> 4H2O').isCorrect).toBe(true)
  })

  it('never marks an unreadable answer wrong', () => {
    expect(evaluateDeterministic(q, 'hydrogen burns')).toMatchObject({ isCorrect: null, method: 'unverified' })
  })
})

describe('ordering grading', () => {
  const steps = ['Transcription', 'mRNA processing', 'Export', 'Translation']
  const q = question({ type: 'ordering', correctAnswer: steps.join('\n'), orderItems: steps })

  it('gives partial credit for the longest run in order', () => {
    expect(scoreOrdering(steps.join('\n'), steps.join('\n'))).toEqual({ earned: 4, total: 4 })
    expect(scoreOrdering(['Export', 'Transcription', 'mRNA processing', 'Translation'].join('\n'), steps.join('\n'))).toEqual({ earned: 3, total: 4 })
    const result = evaluateDeterministic(q, [...steps].reverse().join('\n'))
    expect(result).toMatchObject({ isCorrect: false, method: 'order_match', score: { earned: 1, total: 4 } })
    expect(expectedAnswerText(q)).toBe(steps.join(' → '))
  })

  it('starts from a stable shuffle that is never the answer', () => {
    const shuffled = shuffledForDisplay(steps, 'q1')
    expect(shuffled).not.toEqual(steps)
    expect([...shuffled].sort()).toEqual([...steps].sort())
    expect(shuffledForDisplay(steps, 'q1')).toEqual(shuffled)
  })

  it('reorders with the arrow buttons', () => {
    const onChange = vi.fn()
    render(<OrderingInput question={q} value={steps.join('\n')} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move “Export” up' }))
    expect(onChange).toHaveBeenCalledWith(['Transcription', 'Export', 'mRNA processing', 'Translation'].join('\n'))
  })
})

describe('quiz validation for the new types', () => {
  const service = new QuizService({ ai: {} as AIService })
  const base = { solution: '', knowledgePoint: 'K', difficulty: 'basic' as const, hints: [] }

  it('keeps a chemical equation only when its reference balances', () => {
    const output = {
      questions: [
        { ...base, prompt: 'Combustion of hydrogen', type: 'chem_equation', correctAnswer: '2H2 + O2 -> 2H2O' },
        { ...base, prompt: 'Broken', type: 'chem_equation', correctAnswer: 'H2 + O2 -> H2O' },
      ],
    } as unknown as QuizGenerationOutput
    const valid = service.validateGenerated(output, 2)
    expect(valid.map((q) => q.prompt)).toEqual(['Combustion of hydrogen'])
  })

  it('rebuilds the ordering answer from distinct items', () => {
    const output = {
      questions: [
        { ...base, prompt: 'Order', type: 'ordering', correctAnswer: 'ignored', orderItems: ['A', 'B', 'B', 'C'] },
        { ...base, prompt: 'Too short', type: 'ordering', correctAnswer: 'x', orderItems: ['A', 'B'] },
      ],
    } as unknown as QuizGenerationOutput
    const valid = service.validateGenerated(output, 2)
    expect(valid).toHaveLength(1)
    expect(valid[0]).toMatchObject({ correctAnswer: 'A\nB\nC', orderItems: ['A', 'B', 'C'] })
  })

  it('offers chemical equations to chemistry only', () => {
    expect(questionTypesForSubject('chemistry')).toContain('chem_equation')
    expect(questionTypesForSubject('biology')).not.toContain('chem_equation')
    expect(questionTypesForSubject('biology')).toContain('ordering')
  })
})

describe('biology subject inference', () => {
  it('recognises biology courses before chemistry', () => {
    expect(inferSubject('分子生物学')).toBe('biology')
    expect(inferSubject('Cell Biology 101')).toBe('biology')
    expect(inferSubject('Genetics')).toBe('biology')
    expect(inferSubject('有机化学')).toBe('chemistry')
  })
})
