import { describe, expect, it } from 'vitest'
import {
  matchAnswersToQuestions,
  normalizeAnswerNumber,
  parseAnswerEntries,
} from '@/entities/homework/answerMatching'

/** Professor answer-key labels (synthetic answer keys, not real material). */
describe('extraction regression — answer labels', () => {
  it('stray-exponent-line: `2)(20 s) = …` after an open `(… m/s` is not answer 2', () => {
    const entries = parseAnswerEntries([
      {
        id: 'a1',
        pageNumber: 1,
        text: [
          '1. Take up as positive. The ball rises for t = v/g = 1.2 s.',
          '2. The speed after 10 s is',
          'v = 0 + (0.75 m/s',
          '2)(10 s) = 7.5 m/s,',
          'so the distance is 37.5 m.',
          '3. The tension is T = mg = 19.6 N.',
        ].join('\n'),
      },
    ])
    expect(entries.map((entry) => entry.number)).toEqual(['1', '2', '3'])
    expect(entries[1]!.text).toContain('2)(10 s) = 7.5 m/s')
    const match = matchAnswersToQuestions(
      ['1', '2', '3'].map((number) => ({ id: `q${number}`, number })),
      entries,
    )
    expect(match.assignments.map((assignment) => assignment.status)).toEqual([
      'matched',
      'matched',
      'matched',
    ])
  })

  it('operator-continuation: a bare number after a line ending in an operator continues it', () => {
    const entries = parseAnswerEntries([{ id: 'a1', text: '1. a = 3 +\n2) = 5 m\n2. b = 4' }])
    expect(entries.map((entry) => entry.number)).toEqual(['1', '2'])
  })

  it('out-of-sequence-repeat: an earlier number repeated later is body text', () => {
    const entries = parseAnswerEntries([
      { id: 'a1', text: '1. first\n2. second\n1. step one of the second answer\n3. third' },
    ])
    expect(entries.map((entry) => entry.number)).toEqual(['1', '2', '3'])
    // A repeat of the latest number is still a duplicate the student reviews.
    expect(
      parseAnswerEntries([{ id: 'a2', text: '1. nine\n1. ten' }]).map((entry) => entry.number),
    ).toEqual(['1', '1'])
  })

  it('advanced-problem-labels: "Advanced Problem 2.1" and "Problem 2.2" keep dotted numbers', () => {
    const entries = parseAnswerEntries([
      {
        id: 'a1',
        text: [
          'Advanced Problem 2.1',
          'λ = h/p = 0.15 nm',
          'Advanced Problem 2.1 (Cont.)',
          'so E = 8.3 keV',
          'Problem 2.2: n = 3',
          'Advanced Problem 2.3 – the ion has 18 electrons',
        ].join('\n'),
      },
    ])
    expect(entries.map((entry) => entry.number)).toEqual(['2.1', '2.2', '2.3'])
    expect(entries[0]!.text).toContain('so E = 8.3 keV')
  })

  it('question-side-labels: question numbers in any label form match answer numbers', () => {
    expect(normalizeAnswerNumber('Advanced Problem 2.1')).toBe('2.1')
    expect(normalizeAnswerNumber('Problem 2.1.')).toBe('2.1')
    expect(normalizeAnswerNumber('02.1')).toBe('2.1')
    expect(normalizeAnswerNumber('Q3')).toBe('3')
    expect(normalizeAnswerNumber('第3题')).toBe('3')
    const entries = parseAnswerEntries([
      { id: 'a1', text: 'Advanced Problem 2.1\nanswer one\nAdvanced Problem 2.2\nanswer two' },
    ])
    const match = matchAnswersToQuestions(
      [
        { id: 'q1', number: 'Advanced Problem 2.1' },
        { id: 'q2', number: '2.2' },
      ],
      entries,
    )
    expect(match.assignments.map((assignment) => assignment.status)).toEqual(['matched', 'matched'])
  })

  it('dotted-bare-labels: `2.1)` is a label, `1.5416 Å` is not', () => {
    const entries = parseAnswerEntries([
      { id: 'a1', text: '2.1) λ =\n1.5416 Å is used\n2.2) n = 3' },
    ])
    expect(entries.map((entry) => entry.number)).toEqual(['2.1', '2.2'])
  })
})
