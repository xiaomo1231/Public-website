import { describe, expect, it } from 'vitest'
import {
  buildAnswerLines,
  isSingleUnnumberedEntry,
  matchAnswersToQuestions,
  normalizeAnswerNumber,
  parseAnswerEntries,
  revalidateStoredEntries,
  segmentsToAnswerEntries,
  summarizeAnswerEntries,
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

describe('parseAnswerEntries — labelled formats', () => {
  it('recognizes Solution / Answer / Sol / Ans labels', () => {
    const entries = parseAnswerEntries([
      { id: 'p1', text: 'Solution 1\nx = 2\nSolution 2:\ny = 3\nSol 3)\nz = 4' },
    ])
    expect(entries.map((e) => e.number)).toEqual(['1', '2', '3'])
    expect(entries.map((e) => e.text)).toEqual(['x = 2', 'y = 3', 'z = 4'])
  })

  it('recognizes Problem / Question / Q / Ex labels when no answer label exists', () => {
    const entries = parseAnswerEntries([
      { id: 'c1', text: 'Problem 1\nFirst\nProblem 2\nSecond\nEx3 third' },
    ])
    expect(entries.map((e) => e.number)).toEqual(['1', '2', '3'])
  })

  it('does not double-count a Problem heading followed by its Solution', () => {
    const entries = parseAnswerEntries([
      {
        id: 'c1',
        text: 'Problem 1\nCompute A\nSolution 1\nA = 5\nProblem 2\nCompute B\nSolution 2\nB = 6',
      },
    ])
    // The leading "Problem 1" is kept as one unnumbered entry; the numbered
    // answers are 1 and 2, and the trailing problem statement is trimmed.
    expect(entries.map((e) => e.number)).toEqual([undefined, '1', '2'])
    const numbered = entries.filter((e) => e.number)
    expect(numbered.map((e) => e.text)).toEqual(['A = 5', 'B = 6'])
  })

  it('keeps a numbered step inside a labelled answer from becoming a new entry', () => {
    const entries = parseAnswerEntries([
      { id: 'c1', text: 'Solution 1\n1. First step\n2. Second step\nSolution 2\nDone' },
    ])
    expect(entries.map((e) => e.number)).toEqual(['1', '2'])
    expect(entries[0]!.text).toContain('First step')
  })

  it('parses a number whose body is on the next line', () => {
    const entries = parseAnswerEntries([{ id: 'c1', text: '1.\nCompute\n2.\nMultiply' }])
    expect(entries.map((e) => e.number)).toEqual(['1', '2'])
    expect(entries.map((e) => e.text)).toEqual(['Compute', 'Multiply'])
  })

  it('does not tear a prose line that merely starts with a label word', () => {
    const entries = parseAnswerEntries([
      { id: 'c1', text: 'Question 2 asks for the area.\nSo the answer is 7.' },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.number).toBeUndefined()
  })

  it('does not treat decimals or section numbers as markers', () => {
    const entries = parseAnswerEntries([
      { id: 'c1', text: 'The value is\n2.5 exactly\nand 1.1 too' },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.number).toBeUndefined()
  })

  it('records the real page numbers each entry spans', () => {
    const entries = parseAnswerEntries([
      { id: 'c1', text: '1. first', pageNumber: 1 },
      { id: 'c2', text: 'still first\n2. second', pageNumber: 2 },
    ])
    expect(entries[0]!.pageNumbers).toEqual([1, 2])
    expect(entries[1]!.pageNumbers).toEqual([2])
  })
})

describe('segmentsToAnswerEntries', () => {
  const lines = buildAnswerLines([
    { id: 'c1', text: 'a\nb', pageNumber: 1 },
    { id: 'c2', text: 'c', pageNumber: 2 },
  ])

  it('builds entries from a student division with real provenance', () => {
    const entries = segmentsToAnswerEntries(lines, [0, 2], { 0: '1', 2: '2' })
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ number: '1', text: 'a\nb', chunkIds: ['c1'], pageNumbers: [1] })
    expect(entries[1]).toMatchObject({ number: '2', text: 'c', chunkIds: ['c2'], pageNumbers: [2] })
  })

  it('leaves an entry unnumbered when its number is blank', () => {
    const entries = segmentsToAnswerEntries(lines, [0], { 0: '' })
    expect(entries[0]!.number).toBeUndefined()
  })
})

describe('summarizeAnswerEntries', () => {
  it('flags a single unnumbered fragment as unsplit', () => {
    expect(summarizeAnswerEntries(parseAnswerEntries([{ id: 'c1', text: 'one blob' }]))).toMatchObject({
      total: 1,
      numbered: 0,
      unnumbered: 1,
      unsplit: true,
    })
    expect(isSingleUnnumberedEntry(parseAnswerEntries([{ id: 'c1', text: 'one blob' }]))).toBe(true)
  })
})

describe('revalidateStoredEntries', () => {
  const chunks = [
    { id: 'c1', text: 'a', pageNumber: 1 },
    { id: 'c2', text: 'b', pageNumber: 2 },
  ]

  it('drops entries with unknown chunk ids and recomputes pages', () => {
    const valid = revalidateStoredEntries(
      [
        { number: '1', text: 'kept', chunkIds: ['c2'] },
        { number: '2', text: 'ghost', chunkIds: ['missing'] },
        { number: '3', text: '   ', chunkIds: ['c1'] },
      ],
      chunks,
    )
    expect(valid).toEqual([
      { number: '1', text: 'kept', chunkIds: ['c2'], pageNumbers: [2] },
    ])
  })

  it('returns null when nothing is usable', () => {
    expect(revalidateStoredEntries([], chunks)).toBeNull()
    expect(revalidateStoredEntries([{ text: 'x', chunkIds: ['nope'] }], chunks)).toBeNull()
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
