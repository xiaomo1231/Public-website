import { describe, expect, it } from 'vitest'
import {
  effectiveShares,
  rebalanceShares,
  roundToTotal,
  suggestWeights,
  urgencyFactor,
} from '@/entities/studyPlan/weights'

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

describe('exam weights', () => {
  it('suggested shares are whole numbers that sum to 100', () => {
    const shares = suggestWeights([
      { examId: 'a', daysLeft: 3, difficulty: 0.8, mastery: 0.2, topicCount: 30 },
      { examId: 'b', daysLeft: 20, difficulty: 0.3, mastery: 0.7, topicCount: 8 },
      { examId: 'c', daysLeft: 40, difficulty: 0.5, mastery: null, topicCount: 12 },
    ])
    expect(sum(shares.map((s) => s.share))).toBe(100)
    for (const s of shares) expect(Number.isInteger(s.share)).toBe(true)
    expect(shares[0]!.reasons.some((r) => r.kind === 'days' && r.level === 'urgent')).toBe(true)
    expect(shares[2]!.reasons.some((r) => r.kind === 'no_mastery')).toBe(true)
  })

  it('a closer exam gets a larger share, all else equal', () => {
    const [near, far] = suggestWeights([
      { examId: 'near', daysLeft: 5, difficulty: 0.5, mastery: 0.5, topicCount: 10 },
      { examId: 'far', daysLeft: 30, difficulty: 0.5, mastery: 0.5, topicCount: 10 },
    ])
    expect(near!.share).toBeGreaterThan(far!.share)
    expect(urgencyFactor(1)).toBeGreaterThan(urgencyFactor(10))
  })

  it('moving a slider rebalances unlocked exams in proportion and keeps 100', () => {
    const next = rebalanceShares(
      {
        a: { share: 40, locked: false },
        b: { share: 40, locked: false },
        c: { share: 20, locked: false },
      },
      'a',
      70,
    )
    expect(next.a!.share).toBe(70)
    expect(next.b!.share).toBe(20)
    expect(next.c!.share).toBe(10)
    expect(sum(Object.values(next).map((s) => s.share))).toBe(100)
  })

  it('locked exams keep their share; the slider cannot take it', () => {
    const next = rebalanceShares(
      {
        a: { share: 30, locked: false },
        b: { share: 50, locked: true },
        c: { share: 20, locked: false },
      },
      'a',
      90,
    )
    expect(next.b!.share).toBe(50)
    expect(next.a!.share).toBe(50) // at most 100 − locked
    expect(next.c!.share).toBe(0)
    expect(sum(Object.values(next).map((s) => s.share))).toBe(100)
  })

  it('effective shares rescale saved sliders when an exam is added', () => {
    const suggested = suggestWeights([
      { examId: 'a', daysLeft: 10, difficulty: 0.5, mastery: 0.5, topicCount: 10 },
      { examId: 'b', daysLeft: 10, difficulty: 0.5, mastery: 0.5, topicCount: 10 },
    ])
    // Saved sliders cover every exam: used, scaled to 100.
    const kept = effectiveShares(suggested, {
      a: { share: 60, locked: true },
      b: { share: 30, locked: false },
    })
    expect(kept.a!.share).toBe(60)
    expect(kept.b!.share).toBe(40)
    // A new exam without a slider: back to the suggestion.
    const fresh = effectiveShares(suggested, { a: { share: 90, locked: false } })
    expect(sum(Object.values(fresh).map((s) => s.share))).toBe(100)
    expect(roundToTotal([1, 1, 1], 100)).toEqual([34, 33, 33])
  })
})
