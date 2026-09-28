import { describe, expect, it } from 'vitest'
import {
  hasStudentWork,
  matchHomeworkQuestions,
  matchRetiredCandidates,
} from '@/entities/homework/matching'

const q = (prompt: string, number: string, chunkIds: string[]) => ({ prompt, number, chunkIds })

describe('matchHomeworkQuestions', () => {
  it('matches by content regardless of order', () => {
    const existing = [q('Find the derivative of x^2.', '1', ['a']), q('Evaluate the integral of 2x.', '2', ['b'])]
    const incoming = [q('Evaluate the integral of 2x.', '2', ['b']), q('Find the derivative of x^2.', '1', ['a'])]

    const { pairs, unmatchedNew, unmatchedOld } = matchHomeworkQuestions(incoming, existing)
    expect(unmatchedNew).toEqual([])
    expect(unmatchedOld).toEqual([])
    const map = new Map(pairs.map((p) => [p.newIndex, p.oldIndex]))
    expect(map.get(0)).toBe(1)
    expect(map.get(1)).toBe(0)
  })

  it('matches a reworded question by number + shared source', () => {
    const { pairs, unmatchedNew, unmatchedOld } = matchHomeworkQuestions(
      [q('Find d/dx of 3x^2.', '2', ['b'])],
      [q('Differentiate 3x^2.', '2', ['b'])],
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.reason).toBe('number-and-source')
    expect(unmatchedNew).toEqual([])
    expect(unmatchedOld).toEqual([])
  })

  it('reports removed and added questions instead of guessing', () => {
    const { pairs, unmatchedNew, unmatchedOld } = matchHomeworkQuestions(
      [q('Old question one.', '1', ['a']), q('A brand new question.', '3', ['c'])],
      [q('Old question one.', '1', ['a']), q('Old question two.', '2', ['b'])],
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.newIndex).toBe(0)
    expect(pairs[0]!.oldIndex).toBe(0)
    expect(unmatchedNew).toEqual([1])
    expect(unmatchedOld).toEqual([1])
  })

  it('never assigns one old question to two new ones', () => {
    const { pairs, unmatchedNew } = matchHomeworkQuestions(
      [q('Same prompt.', '1', ['a']), q('Same prompt.', '1', ['a'])],
      [q('Same prompt.', '1', ['a'])],
    )
    expect(pairs).toHaveLength(1)
    expect(unmatchedNew).toEqual([1])
  })

  it('does not match unrelated questions', () => {
    const { pairs } = matchHomeworkQuestions(
      [q('Prove the mean value theorem.', '5', ['z'])],
      [q('Compute 2 + 2.', '1', ['a'])],
    )
    expect(pairs).toHaveLength(0)
  })
})

describe('matchRetiredCandidates', () => {
  it('restores when a retired row is the unique reliable candidate', () => {
    const incoming = [q('Alpha beta gamma.', '1', ['a'])]
    const retired = [q('Alpha beta gamma.', '1', ['a']), q('Completely unrelated topic.', '9', ['z'])]

    const { pairs, ambiguousNew } = matchRetiredCandidates(incoming, [0], retired)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.newIndex).toBe(0)
    expect(pairs[0]!.oldIndex).toBe(0)
    expect(ambiguousNew).toEqual([])
  })

  it('refuses to restore when two retired rows are plausible', () => {
    const incoming = [q('Alpha beta gamma.', '1', ['a'])]
    const retired = [q('Alpha beta gamma.', '1', ['a']), q('Alpha beta gamma!', '2', ['a'])]

    const { pairs, ambiguousNew } = matchRetiredCandidates(incoming, [0], retired)
    expect(pairs).toHaveLength(0)
    expect(ambiguousNew).toEqual([0])
  })

  it('refuses to share one retired row between two new questions', () => {
    const incoming = [q('Alpha beta gamma.', '1', ['a']), q('Alpha beta gamma!', '2', ['a'])]
    const retired = [q('Alpha beta gamma.', '1', ['a'])]

    const { pairs } = matchRetiredCandidates(incoming, [0, 1], retired)
    expect(pairs).toHaveLength(0)
  })

  it('only considers the eligible new questions', () => {
    const incoming = [q('Alpha beta gamma.', '1', ['a'])]
    const retired = [q('Alpha beta gamma.', '1', ['a'])]
    expect(matchRetiredCandidates(incoming, [], retired).pairs).toHaveLength(0)
  })

  it('does not restore on a bare shared-passage overlap', () => {
    const incoming = [q('Completely different.', '1', ['shared'])]
    const retired = [q('Differentiate 3x^2.', '2', ['shared'])]
    expect(matchRetiredCandidates(incoming, [0], retired).pairs).toHaveLength(0)
  })

  it('does not restore on a shared number + passage without text evidence', () => {
    const incoming = [q('Completely different topic.', '1', ['shared'])]
    const retired = [q('Another unrelated question.', '1', ['shared'])]
    expect(matchRetiredCandidates(incoming, [0], retired).pairs).toHaveLength(0)
  })

  it('restores a reworded question when the text still overlaps', () => {
    const incoming = [q('Find the derivative of the function.', '1', ['b'])]
    const retired = [q('Find the derivative of the function carefully.', '1', ['a'])]
    const { pairs } = matchRetiredCandidates(incoming, [0], retired)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.oldIndex).toBe(0)
  })
})

describe('hasStudentWork', () => {
  it('detects any student input', () => {
    expect(hasStudentWork({})).toBe(false)
    expect(hasStudentWork({ draftText: '   ' })).toBe(false)
    expect(hasStudentWork({ draftText: 'x' })).toBe(true)
    expect(hasStudentWork({ messages: [{}] })).toBe(true)
    expect(hasStudentWork({ revealedHints: 1 })).toBe(true)
    expect(hasStudentWork({ solutionRevealed: true })).toBe(true)
  })
})
