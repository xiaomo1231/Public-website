import { describe, expect, it } from 'vitest'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import { splitHomeworkSubparts } from '@/entities/homework/splitQuestion'
import { locateQuestionExcerpt } from '@/entities/homework/sourceGrounding'

describe('homework reading', () => {
  it('separates flattened subparts without changing their equations', () => {
    const text = 'For each subset of R² decide: (a) V = {x | x = 1}. (b) V = {x | x = 2}.'
    const formatted = formatHomeworkQuestion(text)
    expect(formatted).toContain('$\\mathbb{R}^{2}$')
    expect(formatted).toContain('\n\n(a) V = {x | x = 1}.\n\n(b) V = {x | x = 2}.')
  })

  it('splits a long multipart question for bounded generation', () => {
    const parts = splitHomeworkSubparts('For each subset decide: (a) x = 1 (b) x = 2')
    expect(parts).toHaveLength(2)
    expect(parts[1]?.prompt).toContain('For each subset decide:')
    expect(parts[1]?.prompt).toContain('(b) x = 2')
  })

  it('locates a numbered question despite PDF formula line breaks', () => {
    const chunk = 'Problem 5: A different exercise.\nProblem 6: Consider R\n2\n(a) x = 1\n(b) x = 2\nProblem 7: Next exercise.'
    const excerpt = locateQuestionExcerpt(chunk, 'Consider the real vector space R²...', '6')
    expect(excerpt).toContain('Problem 6:')
    expect(excerpt).not.toContain('Problem 5:')
    expect(excerpt).not.toContain('Problem 7:')
  })
})
