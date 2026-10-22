import { describe, expect, it } from 'vitest'
import {
  matchAnswersToQuestions,
  matchContinuationLabel,
  parseAnswerEntries,
  type AnswerSourceChunk,
} from '@/entities/homework/answerMatching'

/** One chunk per page, lines as given (synthetic text). */
function pages(...texts: string[][]): AnswerSourceChunk[] {
  return texts.map((lines, index) => ({
    id: `c${index + 1}`,
    text: lines.join('\n'),
    pageNumber: index + 1,
  }))
}

const QUESTIONS = [
  { id: 'q1', number: '1' },
  { id: 'q2', number: '2' },
  { id: 'q3', number: '3' },
]

describe('problem-level answer matching: layout families', () => {
  it('"Problem 2 (continued)" after another problem joins problem 2', () => {
    const entries = parseAnswerEntries(
      pages(
        ['Problem 1', 'x = 4.', 'Problem 2', 'First half of the work: a = 3.'],
        ['Problem 3', 'y = 7.', 'Problem 2 (continued)', 'Second half: b = 5.'],
      ),
    )
    expect(entries.map((entry) => entry.number)).toEqual(['1', '2', '3'])
    const two = entries.find((entry) => entry.number === '2')!
    expect(two.text).toContain('First half')
    expect(two.text).toContain('Second half')
    expect(two.pageNumbers).toEqual([1, 2])
    const result = matchAnswersToQuestions(QUESTIONS, entries)
    expect(result.assignments.every((item) => item.status === 'matched')).toBe(true)
  })

  it('reads continuation labels in several forms', () => {
    expect(matchContinuationLabel('Problem 4 (cont.)')?.number).toBe('4')
    expect(matchContinuationLabel("Solution 2 cont'd: more")?.rest).toBe('more')
    expect(matchContinuationLabel('Q3（续）')?.number).toBe('3')
    expect(matchContinuationLabel('Problem 4 continues the idea')).toBeNull()
  })

  it('a running page header with a problem label is not a new answer', () => {
    const entries = parseAnswerEntries(
      pages(
        ['Problem 2', 'The first page of a long answer: x = 1.', 'and more work = 2.'],
        ['Problem 2', 'The second page: y = 3.', 'Problem 3', 'z = 4.'],
      ),
    )
    expect(entries.map((entry) => entry.number)).toEqual(['2', '3'])
    expect(entries[0]!.text).toContain('The second page')
  })

  it('answers in a different order and a missing problem', () => {
    const entries = parseAnswerEntries(
      pages(['Solution 3: z = 9.', 'Solution 1: x = 2.'], ['Problem Set 4 2', 'more for 1 = 2']),
    )
    const result = matchAnswersToQuestions(QUESTIONS, entries)
    const status = Object.fromEntries(
      result.assignments.map((item) => [item.questionId, item.status]),
    )
    expect(status).toEqual({ q1: 'matched', q2: 'none', q3: 'matched' })
    // The page header line stays in the answer it interrupts (it is removed
    // before prompting by cleanProfessorAnswerText), never a new answer.
    expect(entries.map((entry) => entry.number)).toEqual(['3', '1'])
  })

  it('two separate answers with the same number still need review (strict one-to-one)', () => {
    const entries = parseAnswerEntries(
      pages(
        ['Solution 1: x = 2.', 'Solution 2: first.'],
        ['Solution 3: z.', 'Solution 2: another.'],
      ),
    )
    const result = matchAnswersToQuestions(QUESTIONS, entries)
    expect(result.assignments.find((item) => item.questionId === 'q2')!.status).toBe('needs_review')
  })
})
