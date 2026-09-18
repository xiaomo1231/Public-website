import { describe, expect, it } from 'vitest'
import { compareMath } from '@/infrastructure/math/expressionEvaluator'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import type { Question } from '@/entities/question/types'

function mathQuestion(correctAnswer: string): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'Integrals',
    type: 'math_expr',
    difficulty: 'basic',
    prompt: 'Evaluate',
    correctAnswer,
    hints: [],
    sourceRefs: [],
    promptVersion: 'v1',
    createdAt: Date.now(),
  }
}

/**
 * The evaluator is deliberately three-valued. It must never claim a correct
 * answer is wrong, and must never claim a wrong answer is correct. When it
 * cannot decide, it says so.
 */
describe('Mathematical verdicts are three-valued', () => {
  it('only ever returns true, false, or null', () => {
    const samples: Array<[string, string]> = [
      ['x^2/2', '0.5x^2'],
      ['x^3', 'x^2'],
      ['2x = 4', 'x = 2'],
      ['nonsense', 'x^2'],
      ['', 'x^2'],
      ['sin(x)^2 + cos(x)^2', '1'],
      ['x^3/3 + C', 'x^3/3'],
    ]
    for (const [user, expected] of samples) {
      const verdict = compareMath(user, expected).equivalent
      expect([true, false, null]).toContain(verdict)
    }
  })

  it('accepts mathematically equivalent forms', () => {
    expect(compareMath('0.5x²', 'x^2 / 2').equivalent).toBe(true)
    expect(compareMath('(x+1)^2', 'x^2 + 2x + 1').equivalent).toBe(true)
    expect(compareMath('x^3/3 + C', 'x^3/3').equivalent).toBe(true)
  })

  it('rejects genuinely different expressions', () => {
    expect(compareMath('x^3', 'x^2').equivalent).toBe(false)
    expect(compareMath('x + 1', 'x - 1').equivalent).toBe(false)
  })

  it('returns unverified for rearranged equations rather than guessing', () => {
    // These are equivalent equations, but proving it needs a solver.
    // A wrong verdict here would mark a correct student answer as incorrect.
    const result = compareMath('2x = 4', 'x = 2')
    expect(result.equivalent).toBeNull()
    expect(result.note).toMatch(/verify/i)
  })

  it('returns unverified for syntactically invalid input rather than guessing', () => {
    const result = compareMath('¯\\_(ツ)_/¯', 'x^2')
    expect(result.equivalent).toBeNull()
    expect(result.note).toMatch(/verify/i)
  })

  it('treats non-mathematical prose as not equivalent, without crashing', () => {
    // Prose parses as implicit multiplication of symbols, so we can tell it
    // is not equal to x^2 — that is a real `false`, not a guess.
    const result = compareMath('the answer is obvious', 'x^2')
    expect(result.equivalent).toBe(false)
  })

  it('never reports a correct answer as incorrect', () => {
    const equivalentPairs: Array<[string, string]> = [
      ['x^2/2', '0.5x^2'],
      ['2x', 'x + x'],
      ['x*x', 'x^2'],
      ['sqrt(x)', 'x^(1/2)'],
    ]
    for (const [user, expected] of equivalentPairs) {
      expect(compareMath(user, expected).equivalent).not.toBe(false)
    }
  })

  it('propagates the three-state verdict through answer evaluation', () => {
    const q = mathQuestion('x^3/3 + C')
    expect(evaluateDeterministic(q, 'x^3/3').isCorrect).toBe(true)
    expect(evaluateDeterministic(q, 'x^2/2').isCorrect).toBe(false)

    const unverifiable = evaluateDeterministic(mathQuestion('2x = 4'), 'x = 2')
    expect(unverifiable.isCorrect).toBeNull()
    expect(unverifiable.method).toBe('math_equivalent')
    expect(unverifiable.note).toMatch(/verify/i)
  })

  it('marks unverified answers so they are excluded from scoring', () => {
    // The scorer treats `null` separately from `false` — verified in
    // tests/quiz/scoring.test.ts. Here we only assert the contract holds.
    const evaluation = evaluateDeterministic(mathQuestion('2x = 4'), 'x = 2')
    expect(evaluation.isCorrect).toBeNull()
    expect(evaluation.confidence).toBe(0)
  })
})
