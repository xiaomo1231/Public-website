import { describe, expect, it } from 'vitest'
import { scoreQuiz } from '@/services/quizService'
import type { Quiz } from '@/entities/quiz/types'
import type { QuestionAttempt, QuestionEvaluation } from '@/entities/questionAttempt/types'

function evaluation(isCorrect: boolean | null): QuestionEvaluation {
  return { isCorrect, method: isCorrect === null ? 'unverified' : 'exact', confidence: 1 }
}

function attempt(
  questionId: string,
  isCorrect: boolean | null,
  opts: { difficulty?: string; knowledgePoint?: string } = {},
): QuestionAttempt {
  return {
    id: `a-${questionId}`,
    projectId: 'p1',
    questionId,
    knowledgePoint: opts.knowledgePoint ?? 'Derivatives',
    questionType: 'numeric',
    difficulty: opts.difficulty ?? 'basic',
    userAnswer: 'x',
    evaluation: evaluation(isCorrect),
    hintsUsed: 0,
    createdAt: Date.now(),
  }
}

function makeQuiz(questionIds: string[]): Quiz {
  return {
    id: 'q1',
    projectId: 'p1',
    title: 'Test quiz',
    config: { mode: 'topic', count: questionIds.length, difficulty: 'adaptive', types: ['numeric'] },
    questionIds,
    status: 'completed',
    difficultyPlan: [],
    startedAt: Date.now(),
    promptVersion: 'v1',
  }
}

describe('scoreQuiz', () => {
  it('computes correct / wrong / unverified counts', () => {
    const quiz = makeQuiz(['q1', 'q2', 'q3', 'q4'])
    const score = scoreQuiz(quiz, [
      attempt('q1', true),
      attempt('q2', true),
      attempt('q3', false),
      attempt('q4', null),
    ])
    expect(score.correct).toBe(2)
    expect(score.wrong).toBe(1)
    expect(score.unverified).toBe(1)
    expect(score.total).toBe(4)
  })

  it('computes percentage from gradable answers only', () => {
    const quiz = makeQuiz(['q1', 'q2', 'q3', 'q4'])
    const score = scoreQuiz(quiz, [
      attempt('q1', true),
      attempt('q2', true),
      attempt('q3', false),
      attempt('q4', null),
    ])
    // 2 correct of 3 gradable = 67%
    expect(score.percentage).toBe(67)
  })

  it('returns 0% when nothing is gradable', () => {
    const quiz = makeQuiz(['q1', 'q2'])
    const score = scoreQuiz(quiz, [attempt('q1', null), attempt('q2', null)])
    expect(score.percentage).toBe(0)
    expect(score.unverified).toBe(2)
  })

  it('counts unanswered questions as unverified', () => {
    const quiz = makeQuiz(['q1', 'q2', 'q3'])
    const score = scoreQuiz(quiz, [attempt('q1', true)])
    expect(score.unverified).toBe(2)
    expect(score.total).toBe(3)
  })

  it('breaks down results by difficulty', () => {
    const quiz = makeQuiz(['q1', 'q2', 'q3'])
    const score = scoreQuiz(quiz, [
      attempt('q1', true, { difficulty: 'basic' }),
      attempt('q2', false, { difficulty: 'basic' }),
      attempt('q3', true, { difficulty: 'advanced' }),
    ])
    expect(score.byDifficulty.basic).toEqual({ correct: 1, wrong: 1, unverified: 0, total: 2 })
    expect(score.byDifficulty.advanced).toEqual({ correct: 1, wrong: 0, unverified: 0, total: 1 })
  })

  it('breaks down results by knowledge point', () => {
    const quiz = makeQuiz(['q1', 'q2', 'q3'])
    const score = scoreQuiz(quiz, [
      attempt('q1', true, { knowledgePoint: 'Derivative' }),
      attempt('q2', false, { knowledgePoint: 'Chain Rule' }),
      attempt('q3', false, { knowledgePoint: 'Chain Rule' }),
    ])
    const chain = score.byKnowledgePoint.find((k) => k.knowledgePoint === 'Chain Rule')
    expect(chain).toEqual({ knowledgePoint: 'Chain Rule', correct: 0, wrong: 2, unverified: 0, total: 2 })
  })

  it('flags weak knowledge points below 60% accuracy', () => {
    const quiz = makeQuiz(['q1', 'q2', 'q3'])
    const score = scoreQuiz(quiz, [
      attempt('q1', true, { knowledgePoint: 'Derivative' }),
      attempt('q2', false, { knowledgePoint: 'Chain Rule' }),
      attempt('q3', false, { knowledgePoint: 'Chain Rule' }),
    ])
    expect(score.weakKnowledgePoints).toContain('Chain Rule')
    expect(score.weakKnowledgePoints).not.toContain('Derivative')
  })

  it('sorts knowledge points weakest first', () => {
    const quiz = makeQuiz(['q1', 'q2'])
    const score = scoreQuiz(quiz, [
      attempt('q1', true, { knowledgePoint: 'Strong' }),
      attempt('q2', false, { knowledgePoint: 'Weak' }),
    ])
    expect(score.byKnowledgePoint[0]!.knowledgePoint).toBe('Weak')
  })

  it('handles an empty quiz', () => {
    const score = scoreQuiz(makeQuiz([]), [])
    expect(score.total).toBe(0)
    expect(score.percentage).toBe(0)
    expect(score.byKnowledgePoint).toEqual([])
  })
})