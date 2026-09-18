import { describe, expect, it } from 'vitest'
import {
  computeMastery,
  decideNextDifficulty,
  difficultyWeight,
  nextStreaks,
  stepDifficulty,
} from '@/services/adaptiveDifficulty'
import type { MasteryObservation } from '@/entities/knowledgeMastery/types'

function result(isCorrect: boolean | null, difficulty: 'beginner' | 'basic' | 'intermediate' | 'advanced' | 'challenge' = 'basic') {
  return { isCorrect, difficulty }
}

describe('difficulty helpers', () => {
  it('orders difficulties', () => {
    expect(stepDifficulty('basic', +1)).toBe('intermediate')
    expect(stepDifficulty('basic', -1)).toBe('beginner')
  })

  it('clamps at the ends', () => {
    expect(stepDifficulty('beginner', -1)).toBe('beginner')
    expect(stepDifficulty('challenge', +1)).toBe('challenge')
  })

  it('weights harder questions more', () => {
    expect(difficultyWeight('challenge')).toBeGreaterThan(difficultyWeight('beginner'))
  })
})

describe('decideNextDifficulty', () => {
  it('does not move with fewer than 2 graded answers', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'basic',
      recentResults: [result(true)],
      consecutiveCorrect: 1,
      consecutiveWrong: 0,
      knowledgePointMastery: 0.5,
    })
    expect(decision.difficulty).toBe('basic')
    expect(decision.changed).toBe(false)
    expect(decision.reason).toMatch(/at least 2/i)
  })

  it('does not demote on a single wrong answer among several', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'intermediate',
      recentResults: [result(true), result(true), result(false), result(true)],
      consecutiveCorrect: 0,
      consecutiveWrong: 1,
      knowledgePointMastery: 0.7,
    })
    // One wrong answer must never lower the level.
    expect(decision.difficulty).not.toBe('basic')
  })

  it('does not demote when a single wrong answer follows two correct ones', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'advanced',
      recentResults: [result(true), result(true), result(false)],
      consecutiveCorrect: 0,
      consecutiveWrong: 1,
      knowledgePointMastery: 0.75,
    })
    expect(decision.difficulty).not.toBe('intermediate')
  })

  it('raises after two consecutive correct with good accuracy', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'basic',
      recentResults: [result(true), result(true)],
      consecutiveCorrect: 2,
      consecutiveWrong: 0,
      knowledgePointMastery: 0.7,
    })
    expect(decision.difficulty).toBe('intermediate')
    expect(decision.changed).toBe(true)
    expect(decision.reason).toMatch(/consecutive correct/i)
  })

  it('lowers after two consecutive wrong with low accuracy', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'intermediate',
      recentResults: [result(false), result(false)],
      consecutiveCorrect: 0,
      consecutiveWrong: 2,
      knowledgePointMastery: 0.3,
    })
    expect(decision.difficulty).toBe('basic')
    expect(decision.changed).toBe(true)
    expect(decision.reason).toMatch(/consecutive wrong/i)
  })

  it('does not promote on a lucky streak when overall accuracy is poor', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'intermediate',
      recentResults: [result(false), result(false), result(false), result(true), result(true)],
      consecutiveCorrect: 2,
      consecutiveWrong: 0,
      knowledgePointMastery: 0.4,
    })
    // Accuracy is 40%, below the 60% promotion threshold.
    expect(decision.difficulty).not.toBe('advanced')
  })

  it('ignores unverified answers when computing accuracy', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'basic',
      recentResults: [result(null), result(true), result(true)],
      consecutiveCorrect: 2,
      consecutiveWrong: 0,
      knowledgePointMastery: 0.6,
    })
    expect(decision.metrics.sampleSize).toBe(2)
    expect(decision.difficulty).toBe('intermediate')
  })

  it('uses the composite score when streaks are neutral', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'basic',
      recentResults: [result(true), result(true), result(true), result(false)],
      consecutiveCorrect: 1,
      consecutiveWrong: 0,
      knowledgePointMastery: 0.85,
    })
    expect(decision.metrics.composite).not.toBeNull()
    expect(decision.difficulty).toBe('intermediate')
  })

  it('never exceeds challenge', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'challenge',
      recentResults: [result(true), result(true), result(true)],
      consecutiveCorrect: 3,
      consecutiveWrong: 0,
      knowledgePointMastery: 1,
    })
    expect(decision.difficulty).toBe('challenge')
    expect(decision.changed).toBe(false)
  })

  it('never drops below beginner', () => {
    const decision = decideNextDifficulty({
      currentDifficulty: 'beginner',
      recentResults: [result(false), result(false)],
      consecutiveCorrect: 0,
      consecutiveWrong: 2,
      knowledgePointMastery: 0,
    })
    expect(decision.difficulty).toBe('beginner')
  })
})

describe('computeMastery', () => {
  const obs = (isCorrect: boolean | null, difficulty: MasteryObservation['difficulty']): MasteryObservation => ({
    at: Date.now(),
    isCorrect,
    difficulty,
    questionType: 'short_answer',
  })

  it('returns 0 with no observations', () => {
    expect(computeMastery([])).toBe(0)
  })

  it('returns 1 when everything is correct', () => {
    expect(computeMastery([obs(true, 'basic'), obs(true, 'basic')])).toBeCloseTo(1, 5)
  })

  it('returns 0 when everything is wrong', () => {
    expect(computeMastery([obs(false, 'basic'), obs(false, 'basic')])).toBeCloseTo(0, 5)
  })

  it('returns ~0.5 for an even split', () => {
    expect(computeMastery([obs(true, 'basic'), obs(false, 'basic')])).toBeCloseTo(0.5, 1)
  })

  it('weights recent observations more heavily', () => {
    const improving = computeMastery([obs(false, 'basic'), obs(false, 'basic'), obs(true, 'basic'), obs(true, 'basic')])
    const worsening = computeMastery([obs(true, 'basic'), obs(true, 'basic'), obs(false, 'basic'), obs(false, 'basic')])
    expect(improving).toBeGreaterThan(worsening)
  })

  it('excludes unverified observations', () => {
    const withUnverified = computeMastery([obs(true, 'basic'), obs(null, 'basic')])
    const withoutUnverified = computeMastery([obs(true, 'basic')])
    expect(withUnverified).toBeCloseTo(withoutUnverified, 5)
  })

  it('counts correct answers on harder questions more', () => {
    const hardCorrect = computeMastery([obs(false, 'beginner'), obs(true, 'challenge')])
    const easyCorrect = computeMastery([obs(true, 'beginner'), obs(false, 'challenge')])
    expect(hardCorrect).toBeGreaterThan(easyCorrect)
  })
})

describe('nextStreaks', () => {
  it('increments correct streak', () => {
    expect(nextStreaks(true, 1, 0)).toEqual({ consecutiveCorrect: 2, consecutiveWrong: 0 })
  })
  it('increments wrong streak', () => {
    expect(nextStreaks(false, 0, 1)).toEqual({ consecutiveCorrect: 0, consecutiveWrong: 2 })
  })
  it('leaves streaks untouched for unverified answers', () => {
    expect(nextStreaks(null, 3, 0)).toEqual({ consecutiveCorrect: 3, consecutiveWrong: 0 })
  })
})