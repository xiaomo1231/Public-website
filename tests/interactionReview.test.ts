import { describe, expect, it } from 'vitest'
import { formatPercent, practicedMasteryAverage, toPercent } from '@/shared/lib/percent'
import { joinMeta } from '@/shared/lib/joinMeta'
import { materialGroupStatus } from '@/widgets/documents/materialGroupStatus'
import { formatMoney, moneyDigits } from '@/widgets/settings/usageFormat'
import { splitQuizzes, type Quiz } from '@/entities/quiz/types'

describe('mastery percentages', () => {
  it('round one way everywhere, on the decimal value', () => {
    // 0.615 * 100 is 61.4999… in floating point; shown as 62 everywhere.
    expect(toPercent(0.615)).toBe(62)
    expect(formatPercent(0.615)).toBe('62%')
    expect(toPercent(0.6149)).toBe(61)
    expect(toPercent(1.2)).toBe(100)
    expect(toPercent(Number.NaN)).toBe(0)
  })

  it('averages only practised knowledge points', () => {
    expect(practicedMasteryAverage([])).toBeNull()
    expect(
      practicedMasteryAverage([
        { mastery: 0.5, attempts: 2 },
        { mastery: 0.9, attempts: 1 },
        { mastery: 0, attempts: 0 },
      ]),
    ).toBeCloseTo(0.7)
  })
})

describe('meta lines', () => {
  it('never start, end or double a separator', () => {
    expect(joinMeta(['', 'Calculus', null, '2 days ago', undefined])).toBe('Calculus · 2 days ago')
    expect(joinMeta([false, '  '])).toBe('')
  })
})

describe('material group status', () => {
  it('reports a failed file as failed, not processing', () => {
    expect(materialGroupStatus([])).toEqual({ kind: 'empty' })
    expect(materialGroupStatus([{ status: 'failed' }])).toEqual({ kind: 'failed', failed: 1 })
    expect(materialGroupStatus([{ status: 'ready' }, { status: 'failed' }])).toEqual({
      kind: 'partial',
      failed: 1,
    })
    expect(materialGroupStatus([{ status: 'failed' }, { status: 'processing' }])).toEqual({
      kind: 'processing',
    })
    expect(materialGroupStatus([{ status: 'ready' }])).toEqual({ kind: 'ready' })
  })
})

describe('usage costs', () => {
  it('use one decimal count for a column', () => {
    expect(moneyDigits([1.2, 0.0031])).toBe(4)
    expect(moneyDigits([1.2, 0.5, 0])).toBe(2)
    expect(formatMoney(1.2, 'USD', 'en', 4)).toBe('$1.2000')
    expect(formatMoney(0.0031, 'USD', 'en', 4)).toBe('$0.0031')
    expect(formatMoney(1.2, 'USD', 'en')).toBe('$1.20')
  })
})

describe('quiz landing order', () => {
  const quiz = (id: string, status: Quiz['status'], startedAt: number) =>
    ({ id, status, startedAt }) as Quiz

  it('lists unfinished quizzes apart from finished ones, newest first', () => {
    const { active, finished } = splitQuizzes([
      quiz('a', 'completed', 3),
      quiz('b', 'in_progress', 1),
      quiz('c', 'paused', 2),
      quiz('d', 'failed', 4),
    ])
    expect(active.map((q) => q.id)).toEqual(['c', 'b'])
    expect(finished.map((q) => q.id)).toEqual(['d', 'a'])
  })
})
