import { describe, expect, it } from 'vitest'
import {
  formatRational,
  matrixToLatex,
  parseMatrix,
  parseRational,
  rref,
  sameReducedMatrix,
  solutionKind,
} from '@/infrastructure/math/rref'
import { checkLinearSystems, involvesRowReduction } from '@/entities/homework/walkthroughChecks'
import { describeAnchor, findAnchorOffset, locateAnchor } from '@/shared/lib/textAnchor'
import {
  planWalkthrough,
  questionSectionHash,
  walkthroughLanguage,
  type HomeworkWalkthrough,
} from '@/entities/homework/walkthrough'
import type { HomeworkQuestion } from '@/entities/homework/types'

const show = (matrix: ReturnType<typeof rref>) => matrix.map((row) => row.map(formatRational))

describe('exact row reduction', () => {
  it('reads integers, decimals, fractions and LaTeX fractions', () => {
    expect(['3', '-2', '0.5', '19/5', '-22/5', '\\frac{19}{5}', '-\\tfrac{1}{10}', '\\tfrac12', '−4', 7].map((raw) => {
      const value = parseRational(raw)
      return value ? formatRational(value) : null
    })).toEqual(['3', '-2', '1/2', '19/5', '-22/5', '19/5', '-1/10', '1/2', '-4', '7'])
    expect(parseRational('x')).toBeNull()
    expect(parseRational('1/0')).toBeNull()
    expect(parseMatrix([['1', '2'], ['3']])).toBeNull()
  })

  it('reduces HW3 problem 1 to the RREF in the handout, with a free variable', () => {
    const reduced = rref(parseMatrix([[1, 2, 3, 4, 10], [2, 3, 5, 6, 14], [3, 4, 6, 8, 18]])!)
    expect(show(reduced)).toEqual([
      ['1', '0', '0', '0', '-2'],
      ['0', '1', '0', '2', '6'],
      ['0', '0', '1', '0', '0'],
    ])
    expect(solutionKind(reduced)).toBe('infinite')
  })

  it('keeps fractions exact and spots inconsistent systems', () => {
    const c = rref(parseMatrix([[1, 0, 2, 3, 4], [0, 1, 0, 4, 5], [3, 2, 1, 0, 1]])!)
    expect(show(c)).toEqual([
      ['1', '0', '0', '-19/5', '-22/5'],
      ['0', '1', '0', '4', '5'],
      ['0', '0', '1', '17/5', '21/5'],
    ])
    const a = rref(parseMatrix([[1, 2, 0, 3], [0, 1, 3, 4], [4, 0, 2, 1], [0, 1, 1, 2]])!)
    expect(solutionKind(a)).toBe('none')
    expect(solutionKind(rref(parseMatrix([[0, 1, 2], [2, 0, 1]])!))).toBe('unique')
  })

  it('compares RREFs ignoring zero rows and writes LaTeX', () => {
    const left = parseMatrix([[1, 0, 2], [0, 0, 0]])!
    expect(sameReducedMatrix(left, parseMatrix([[1, 0, 2]])!)).toBe(true)
    expect(sameReducedMatrix(left, parseMatrix([[1, 0, 3]])!)).toBe(false)
    expect(matrixToLatex(parseMatrix([['1', '-19/5']])!)).toBe('\\left[\\begin{array}{c|c} 1&-\\tfrac{19}{5} \\end{array}\\right]')
  })
})

describe('checking the walkthrough arithmetic', () => {
  it('confirms a right RREF, flags a wrong one, and skips what it cannot read', () => {
    const checks = checkLinearSystems([
      { label: '1', augmented: [['1', '2', '3', '4', '10'], ['2', '3', '5', '6', '14'], ['3', '4', '6', '8', '18']], rref: [['1', '0', '0', '0', '-2'], ['0', '1', '0', '2', '6'], ['0', '0', '1', '0', '0']], solution: 'infinite' },
      { label: '2(c)', augmented: [[1, 0, 2, 3, 4], [0, 1, 0, 4, 5], [3, 2, 1, 0, 1]], rref: [['1', '0', '0', '-19/5', '-22/5'], ['0', '1', '0', '4', '5'], ['0', '0', '1', '17/5', '22/5']], solution: 'infinite' },
      { label: '2(e)', augmented: [[0, 1, 2], [2, 0, 1]], rref: [[1, 0, '1/2'], [0, 1, 2]], solution: 'infinite' },
      { label: 'bad', augmented: [['a', 'b']], rref: [['1', '0']] },
    ])
    expect(checks.map((check) => [check.label, check.rrefMatches, check.kindMatches])).toEqual([
      ['1', true, true],
      ['2(c)', false, true],
      ['2(e)', true, false],
    ])
    expect(checks[1]!.computedRref).toContain('\\tfrac{21}{5}')
    expect(checks[2]!.computedKind).toBe('unique')
  })

  it('recognises questions that involve row reduction', () => {
    expect(involvesRowReduction('By forming the augmented matrix and using the Reduced Row Echelon Form (RREF), solve')).toBe(true)
    expect(involvesRowReduction('用初等行变换解线性方程组')).toBe(true)
    expect(involvesRowReduction('Find the derivative of x^2.')).toBe(false)
  })
})

describe('finding a passage again', () => {
  it('prefers the occurrence whose surroundings match', () => {
    const full = 'R2 → R2 − 2R1 first. Later again R2 → R2 − 2R1 here.'
    const anchor = { text: 'R2 → R2 − 2R1', prefix: 'Later again ', suffix: ' here.' }
    expect(findAnchorOffset(full, anchor)).toBe(full.lastIndexOf('R2 → R2'))
    expect(findAnchorOffset(full, { ...anchor, text: 'missing' })).toBe(-1)
  })

  it('describes a DOM selection and locates it after the page re-renders', () => {
    const root = document.createElement('section')
    root.innerHTML = '<p>Swap <b>R1</b> and R2.</p><p>Then scale R2.</p>'
    document.body.appendChild(root)
    const range = document.createRange()
    const second = root.querySelectorAll('p')[1]!.firstChild!
    range.setStart(second, 5)
    range.setEnd(second, 13)
    const anchor = describeAnchor(root, range)!
    expect(anchor).toEqual({ text: 'scale R2', prefix: 'Swap R1 and R2.Then ', suffix: '.' })

    // Re-rendered with different markup but the same words.
    root.innerHTML = '<div>Swap R1 and R2.</div><div>Then <i>scale</i> R2.</div>'
    const found = locateAnchor(root, anchor)!
    expect(found.toString()).toBe('scale R2')
    root.innerHTML = '<p>All new text.</p>'
    expect(locateAnchor(root, anchor)).toBeNull()
    root.remove()
  })
})

describe('walkthrough plan', () => {
  const question = (id: string, prompt: string): HomeworkQuestion =>
    ({ id, prompt, number: id, sourceRefs: [], answerStatus: undefined } as unknown as HomeworkQuestion)

  it('follows the question-language preference', () => {
    expect(walkthroughLanguage(undefined, 'en')).toBe('zh_terms')
    expect(walkthroughLanguage('en', 'zh')).toBe('en')
    expect(walkthroughLanguage('source', 'en')).toBe('en')
    expect(walkthroughLanguage('source', 'mixed')).toBe('zh_terms')
  })

  it('marks only what changed, plus the opening and summary', () => {
    const questions = [question('1', 'Solve A.'), question('2', 'Solve B.')]
    const empty = planWalkthrough(questions, undefined, 'zh_terms', 'v')
    expect(empty.map((entry) => [entry.id, entry.needsWork])).toEqual([
      ['overview', true],
      ['q:1', true],
      ['q:2', true],
      ['summary', true],
    ])
    const stored: HomeworkWalkthrough = {
      id: 's:zh_terms',
      projectId: 'p',
      setId: 's',
      language: 'zh_terms',
      createdAt: 1,
      updatedAt: 1,
      sections: empty.map((entry) => ({ id: entry.id, kind: entry.kind, title: '', body: 'x', status: 'ready' as const, inputHash: entry.inputHash, generatedAt: 1 })),
    }
    expect(planWalkthrough(questions, stored, 'zh_terms', 'v').every((entry) => !entry.needsWork)).toBe(true)
    const changed = planWalkthrough([questions[0]!, question('2', 'Solve B again.')], stored, 'zh_terms', 'v')
    expect(changed.filter((entry) => entry.needsWork).map((entry) => entry.id)).toEqual(['overview', 'q:2', 'summary'])
    expect(changed.find((entry) => entry.id === 'q:2')!.outdated).toBe(true)
    expect(questionSectionHash(questions[0]!, 'zh_terms', 'v')).not.toBe(questionSectionHash(questions[0]!, 'en', 'v'))
  })
})
