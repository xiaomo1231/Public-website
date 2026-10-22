import { describe, expect, it } from 'vitest'
import {
  homeworkQuestionOrigin,
  professorPracticeOrigin,
  quizQuestionOrigin,
  rubricSourceOf,
} from '@/entities/question/origin'

const ref = { documentId: 'd', documentName: 'Book.pdf', chunkId: 'c1' }

describe('question origin', () => {
  it('quiz questions are AI-written, grounded only when they cite course passages', () => {
    expect(quizQuestionOrigin({ sourceRefs: [ref] })).toEqual({ kind: 'ai', grounded: true })
    expect(quizQuestionOrigin({ sourceRefs: [] })).toEqual({ kind: 'ai', grounded: false })
    expect(quizQuestionOrigin({ origin: 'ai_without_source', sourceRefs: [ref] })).toEqual({
      kind: 'ai',
      grounded: false,
    })
  })

  it('professor practice questions are originals', () => {
    expect(professorPracticeOrigin()).toEqual({ kind: 'original' })
  })

  it('homework: assignment questions are originals, practice-set questions adapted or new', () => {
    expect(homeworkQuestionOrigin({})).toEqual({ kind: 'original' })
    expect(
      homeworkQuestionOrigin({ practice: { origin: 'ai', sourceQuestionId: 'q1' } }).kind,
    ).toBe('adapted')
    expect(homeworkQuestionOrigin({ practice: { origin: 'local' } }).kind).toBe('adapted')
    expect(homeworkQuestionOrigin({ practice: { origin: 'ai' } })).toEqual({
      kind: 'ai',
      grounded: false,
    })
  })
})

describe('rubric source', () => {
  it('unknown sources read as platform, never as the professor', () => {
    expect(rubricSourceOf(undefined)).toBe('platform')
    expect(rubricSourceOf('platform')).toBe('platform')
    expect(rubricSourceOf('professor')).toBe('professor')
    expect(rubricSourceOf('bogus' as never)).toBe('platform')
  })

  it('a caller that knows the points come from the professor answer can say so', () => {
    expect(rubricSourceOf(undefined, 'professor')).toBe('professor')
    expect(rubricSourceOf('platform', 'professor')).toBe('platform')
  })
})
