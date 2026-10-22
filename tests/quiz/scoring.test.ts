import { describe, expect, it } from 'vitest'
import { scoreQuiz } from '@/services/quizService'
import { knowledgeStatPercent, type Quiz } from '@/entities/quiz/types'
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
    config: {
      mode: 'topic',
      count: questionIds.length,
      difficulty: 'adaptive',
      types: ['numeric'],
    },
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
    expect(chain).toEqual({
      knowledgePoint: 'Chain Rule',
      correct: 0,
      wrong: 2,
      unverified: 0,
      total: 2,
      points: 0,
    })
  })

  it('judges weak knowledge points on the same basis as the overall score', () => {
    // An oral topic: every answer covers most of its scoring points, so none is
    // fully correct, but the overall score is 80% — not a weak point.
    const quiz = makeQuiz(['q1', 'q2'])
    const partial = (questionId: string): QuestionAttempt => ({
      ...attempt(questionId, false, { knowledgePoint: 'Brachial plexus' }),
      evaluation: {
        isCorrect: false,
        method: 'rubric_ai',
        confidence: 1,
        score: { earned: 4, total: 5 },
      },
    })
    const score = scoreQuiz(quiz, [partial('q1'), partial('q2')])
    expect(score.percentage).toBe(80)
    expect(score.byKnowledgePoint[0]!.points).toBe(1.6)
    expect(knowledgeStatPercent(score.byKnowledgePoint[0]!)).toBe(80)
    expect(score.weakKnowledgePoints).toEqual([])
  })

  it('falls back to the correct count for scores saved without points', () => {
    expect(
      knowledgeStatPercent({ knowledgePoint: 'x', correct: 1, wrong: 1, unverified: 0, total: 2 }),
    ).toBe(50)
    expect(
      knowledgeStatPercent({ knowledgePoint: 'x', correct: 0, wrong: 0, unverified: 1, total: 1 }),
    ).toBeNull()
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

  it('uses the latest attempt per question whatever order the attempts arrive in', () => {
    const quiz = makeQuiz(['q1'])
    const older = { ...attempt('q1', false), id: 'old', createdAt: 1 }
    const newer = { ...attempt('q1', true), id: 'new', createdAt: 2 }
    expect(scoreQuiz(quiz, [newer, older]).correct).toBe(1)
    expect(scoreQuiz(quiz, [older, newer]).correct).toBe(1)
  })

  it('scores an oral quiz by pooled scoring points, like its topic scores', () => {
    const quiz: Quiz = {
      ...makeQuiz(['m', 'f1', 'f2']),
      config: { ...makeQuiz([]).config, mode: 'oral' },
    }
    const rubric = (id: string, earned: number, total: number, disputed = false) => ({
      ...attempt(id, earned === total),
      questionType: 'short_answer',
      evaluation: {
        isCorrect: earned === total,
        method: 'rubric_ai' as const,
        confidence: 0.8,
        score: { earned, total },
        ...(disputed ? { disputed: true } : {}),
      },
    })
    // Main 6/8, follow-ups 1/2 and 0/1 → 7/11 = 64% (not the per-question mean 42%).
    const score = scoreQuiz(quiz, [rubric('m', 6, 8), rubric('f1', 1, 2), rubric('f2', 0, 1)])
    expect(score.percentage).toBe(64)
    expect(score.rubricPoints).toEqual({ earned: 7, total: 11 })
    // A disputed answer leaves both the points and the percentage.
    const disputed = scoreQuiz(quiz, [
      rubric('m', 6, 8, true),
      rubric('f1', 1, 2),
      rubric('f2', 0, 1),
    ])
    expect(disputed.rubricPoints).toEqual({ earned: 1, total: 3 })
    expect(disputed.percentage).toBe(33)
    // Other quizzes carry no rubric points.
    expect(scoreQuiz(makeQuiz(['q1']), [attempt('q1', true)]).rubricPoints).toBeUndefined()
  })
})
