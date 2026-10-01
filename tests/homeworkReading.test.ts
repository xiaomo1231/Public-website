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

  it('typesets a legacy PDF vector arrow and rejoins grounded dimensions in an excerpt', () => {
    const prompt = 'where \u20d7x = (x₁, x₂, x₃) ∈ R³. Show that V is a subspace of R³.'
    expect(formatHomeworkQuestion(prompt)).toContain('$\\vec{x}$')
    expect(formatHomeworkQuestion(prompt)).not.toContain('\u20d7')
    expect(formatHomeworkQuestion('where x\u20d7 = (x₁, x₂)')).toContain('$\\vec{x}$')

    const oldExcerpt = 'Problem 5: V ⊆ R\n3\ndefined by equations.\nwhere \u20d7 x ∈ R\n3\n. Show that V is a subspace of R\n3\n.'
    const formatted = formatHomeworkQuestion(oldExcerpt)
    expect(formatted).toContain('V ⊆ $\\mathbb{R}^{3}$')
    expect(formatted).toContain('$\\vec{x}$ ∈ $\\mathbb{R}^{3}$')
    expect(formatted).toContain('of $\\mathbb{R}^{3}$')
    expect(formatHomeworkQuestion('R\n3. A new numbered item')).toContain('R\n3.')
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
