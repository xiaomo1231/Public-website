import { describe, expect, it } from 'vitest'
import {
  matchAnswersToQuestions,
  normalizeAnswerNumber,
  parseAnswerEntries,
} from '@/entities/homework/answerMatching'

describe('normalizeAnswerNumber', () => {
  it('canonicalises leading zeros and trailing punctuation', () => {
    expect(normalizeAnswerNumber('01.')).toBe('1')
    expect(normalizeAnswerNumber(' 3) ')).toBe('3')
    expect(normalizeAnswerNumber('4、')).toBe('4')
  })
})

describe('parseAnswerEntries', () => {
  it('parses numbered answers and keeps their chunk provenance', () => {
    const entries = parseAnswerEntries([
      { id: 'c1', text: '1. 9\n2. 42' },
      { id: 'c2', text: '3. x = 2\nwith steps' },
    ])
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ number: '1', text: '9', chunkIds: ['c1'] })
    expect(entries[2]).toMatchObject({ number: '3', chunkIds: ['c2'] })
    expect(entries[2]!.text).toContain('with steps')
  })

  it('keeps an unnumbered document as one entry so it can be assigned manually', () => {
    const entries = parseAnswerEntries([{ id: 'c1', text: 'the answer is 9' }])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.number).toBeUndefined()
    expect(entries[0]!.text).toBe('the answer is 9')
  })
})

describe('matchAnswersToQuestions', () => {
  const entries = parseAnswerEntries([
    { id: 'c1', text: '1. nine\n2. forty-two\n3. two' },
  ])

  it('matches a unique one-to-one number on both sides', () => {
    const result = matchAnswersToQuestions(
      [{ id: 'q1', number: '1' }, { id: 'q2', number: '2' }, { id: 'q3', number: '3' }],
      entries,
    )
    expect(result.assignments.map((a) => a.status)).toEqual(['matched', 'matched', 'matched'])
    expect(result.assignments[1]!.answerIndex).toBe(1)
    expect(result.unmatchedAnswers).toEqual([])
  })

  it('still matches when the answers are in a different order (matched by number)', () => {
    const shuffled = parseAnswerEntries([{ id: 'c1', text: '3. two\n1. nine\n2. forty-two' }])
    const result = matchAnswersToQuestions(
      [{ id: 'q1', number: '1' }, { id: 'q2', number: '2' }],
      shuffled,
    )
    expect(result.assignments.every((a) => a.status === 'matched')).toBe(true)
  })

  it('does not auto-match duplicate answer numbers', () => {
    const dup = parseAnswerEntries([{ id: 'c1', text: '1. nine\n1. ten' }])
    const result = matchAnswersToQuestions([{ id: 'q1', number: '1' }], dup)
    expect(result.assignments[0]).toMatchObject({ status: 'needs_review', reason: 'answer-number-duplicate' })
    expect(result.unmatchedAnswers).toEqual([0, 1])
  })

  it('does not auto-match duplicate question numbers', () => {
    const result = matchAnswersToQuestions(
      [{ id: 'q1', number: '1' }, { id: 'q2', number: '1' }],
      entries,
    )
    expect(result.assignments.every((a) => a.status === 'needs_review')).toBe(true)
    expect(result.assignments[0]!.reason).toBe('question-number-duplicate')
  })

  it('marks a question without a number for review rather than guessing', () => {
    const result = matchAnswersToQuestions([{ id: 'q1' }], entries)
    expect(result.assignments[0]).toMatchObject({ status: 'needs_review', reason: 'question-number-missing' })
  })

  it('reports a question whose answer number is missing as having no answer', () => {
    const result = matchAnswersToQuestions([{ id: 'q1', number: '9' }], entries)
    expect(result.assignments[0]).toMatchObject({ status: 'none', reason: 'answer-number-missing' })
    expect(result.unmatchedAnswers).toEqual([0, 1, 2])
  })

  it('returns every question as none when there are no answers', () => {
    const result = matchAnswersToQuestions([{ id: 'q1', number: '1' }], [])
    expect(result.assignments[0]).toMatchObject({ status: 'none', reason: 'no-answers' })
    expect(result.unmatchedAnswers).toEqual([])
  })
})
