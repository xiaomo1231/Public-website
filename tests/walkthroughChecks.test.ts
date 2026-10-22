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
import {
  checkHasConflict,
  checkLinearSystems,
  involvesRowReduction,
  isAmbiguousLegacyCheck,
} from '@/entities/homework/walkthroughChecks'
import type { LinearSystemCheck } from '@/entities/homework/walkthrough'
import { prompts } from '@/infrastructure/ai/prompts'
import * as HomeworkWalkthroughV1 from '@/infrastructure/ai/prompts/homework-walkthrough/v1'
import * as HomeworkWalkthroughV7 from '@/infrastructure/ai/prompts/homework-walkthrough/v7'
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
    expect(
      [
        '3',
        '-2',
        '0.5',
        '19/5',
        '-22/5',
        '\\frac{19}{5}',
        '-\\tfrac{1}{10}',
        '\\tfrac12',
        '−4',
        7,
      ].map((raw) => {
        const value = parseRational(raw)
        return value ? formatRational(value) : null
      }),
    ).toEqual(['3', '-2', '1/2', '19/5', '-22/5', '19/5', '-1/10', '1/2', '-4', '7'])
    expect(parseRational('x')).toBeNull()
    expect(parseRational('1/0')).toBeNull()
    expect(parseMatrix([['1', '2'], ['3']])).toBeNull()
  })

  it('reduces HW3 problem 1 to the RREF in the handout, with a free variable', () => {
    const reduced = rref(
      parseMatrix([
        [1, 2, 3, 4, 10],
        [2, 3, 5, 6, 14],
        [3, 4, 6, 8, 18],
      ])!,
    )
    expect(show(reduced)).toEqual([
      ['1', '0', '0', '0', '-2'],
      ['0', '1', '0', '2', '6'],
      ['0', '0', '1', '0', '0'],
    ])
    expect(solutionKind(reduced)).toBe('infinite')
  })

  it('keeps fractions exact and spots inconsistent systems', () => {
    const c = rref(
      parseMatrix([
        [1, 0, 2, 3, 4],
        [0, 1, 0, 4, 5],
        [3, 2, 1, 0, 1],
      ])!,
    )
    expect(show(c)).toEqual([
      ['1', '0', '0', '-19/5', '-22/5'],
      ['0', '1', '0', '4', '5'],
      ['0', '0', '1', '17/5', '21/5'],
    ])
    const a = rref(
      parseMatrix([
        [1, 2, 0, 3],
        [0, 1, 3, 4],
        [4, 0, 2, 1],
        [0, 1, 1, 2],
      ])!,
    )
    expect(solutionKind(a)).toBe('none')
    expect(
      solutionKind(
        rref(
          parseMatrix([
            [0, 1, 2],
            [2, 0, 1],
          ])!,
        ),
      ),
    ).toBe('unique')
  })

  it('compares RREFs ignoring zero rows and writes LaTeX', () => {
    const left = parseMatrix([
      [1, 0, 2],
      [0, 0, 0],
    ])!
    expect(sameReducedMatrix(left, parseMatrix([[1, 0, 2]])!)).toBe(true)
    expect(sameReducedMatrix(left, parseMatrix([[1, 0, 3]])!)).toBe(false)
    expect(matrixToLatex(parseMatrix([['1', '-19/5']])!)).toBe(
      '\\left[\\begin{array}{c|c} 1&-\\tfrac{19}{5} \\end{array}\\right]',
    )
  })
})

describe('checking the walkthrough arithmetic', () => {
  it('confirms a right RREF, flags a wrong one, and skips what it cannot read', () => {
    const checks = checkLinearSystems([
      {
        label: '1',
        augmented: [
          ['1', '2', '3', '4', '10'],
          ['2', '3', '5', '6', '14'],
          ['3', '4', '6', '8', '18'],
        ],
        rref: [
          ['1', '0', '0', '0', '-2'],
          ['0', '1', '0', '2', '6'],
          ['0', '0', '1', '0', '0'],
        ],
        solution: 'infinite',
      },
      {
        label: '2(c)',
        augmented: [
          [1, 0, 2, 3, 4],
          [0, 1, 0, 4, 5],
          [3, 2, 1, 0, 1],
        ],
        rref: [
          ['1', '0', '0', '-19/5', '-22/5'],
          ['0', '1', '0', '4', '5'],
          ['0', '0', '1', '17/5', '22/5'],
        ],
        solution: 'infinite',
      },
      {
        label: '2(e)',
        augmented: [
          [0, 1, 2],
          [2, 0, 1],
        ],
        rref: [
          [1, 0, '1/2'],
          [0, 1, 2],
        ],
        // Wrong under both readings: [A | b] has a unique solution, A x = 0 infinitely many.
        solution: 'none',
      },
      { label: 'bad', augmented: [['a', 'b']], rref: [['1', '0']] },
    ])
    expect(checks.map((check) => [check.label, check.rrefMatches, check.kindMatches])).toEqual([
      ['1', true, true],
      ['2(c)', false, true],
      ['2(e)', true, false],
    ])
    expect(checks[1]!.computedRref).toContain('\\tfrac{21}{5}')
    expect(checks[2]!.computedKind).toBe('unique')
    expect(checks[2]!.matrix).toContain('{cc|c}')
  })

  // HW4 2(c): B2 = {v1, v3} with v1 = (1,0,0,1), v3 = (1,1,1,3). The model tests
  // independence (α1 v1 + α2 v3 = 0, only the trivial solution) and sends the
  // coefficient matrix [v1 v3] in the old "augmented" field.
  const independence = {
    label: '(c)',
    augmented: [
      ['1', '1'],
      ['0', '1'],
      ['0', '1'],
      ['1', '3'],
    ],
    rref: [
      ['1', '0'],
      ['0', '1'],
      ['0', '0'],
      ['0', '0'],
    ],
    solution: 'unique' as const,
  }

  it('reads an old-shape coefficient matrix of an independence test as A x = 0 (no false 无解)', () => {
    const [check] = checkLinearSystems([independence])
    expect(check).toMatchObject({
      rrefMatches: true,
      kindMatches: true,
      computedKind: 'unique',
      homogeneous: true,
    })
    expect(checkHasConflict(check!)).toBe(false)
    // A dependent set sent the same way: "infinitely many" fits A x = 0.
    const [dependent] = checkLinearSystems([
      {
        label: '(d)',
        augmented: [
          [1, 0, 1],
          [0, 1, 1],
          [1, 1, 2],
        ],
        rref: [
          [1, 0, 1],
          [0, 1, 1],
          [0, 0, 0],
        ],
        solution: 'infinite',
      },
    ])
    expect(checkHasConflict(dependent!)).toBe(false)
  })

  it('hides the conflict a check saved by the old checker reported for that payload', () => {
    const legacy: LinearSystemCheck = {
      label: '(c)',
      rrefMatches: true,
      kindMatches: false,
      claimedKind: 'unique',
      computedKind: 'none',
      computedRref: matrixToLatex(rref(parseMatrix(independence.augmented)!)),
    }
    expect(isAmbiguousLegacyCheck(legacy)).toBe(true)
    expect(checkHasConflict(legacy)).toBe(false)
    // A real old conflict (claim fits neither reading) is still shown.
    const real = { ...legacy, claimedKind: 'infinite' as const }
    expect(checkHasConflict(real)).toBe(true)
  })

  it('checks the new coefficients + rhs shape exactly', () => {
    const checks = checkLinearSystems([
      {
        label: '(c)',
        coefficients: independence.augmented,
        rhs: 'homogeneous',
        rref: independence.rref,
        solution: 'unique',
      },
      // Same with the RREF of [A | 0] and a zero rhs list.
      {
        label: '(c) #2',
        coefficients: independence.augmented,
        rhs: ['0', '0', '0', '0'],
        rref: [
          ['1', '0', '0'],
          ['0', '1', '0'],
        ],
        solution: 'unique',
      },
      // Spanning check with a symbolic right-hand side: skipped, never a conflict.
      {
        label: '(b)',
        coefficients: independence.augmented,
        rhs: ['x', 'y', 'z', 'w'],
        rref: [
          ['1', '0', 'x-y'],
          ['0', '1', 'y'],
        ],
        solution: 'unique',
      },
      // A genuine mismatch, numeric and certain: [A | b] is inconsistent.
      {
        label: '(e)',
        coefficients: independence.augmented,
        rhs: ['1', '0', '0', '0'],
        rref: [
          ['1', '0', '0'],
          ['0', '1', '0'],
          ['0', '0', '1'],
        ],
        solution: 'unique',
      },
    ])
    expect(checks.map((check) => [check.label, check.rrefMatches, check.kindMatches])).toEqual([
      ['(c)', true, true],
      ['(c) #2', true, true],
      ['(e)', true, false],
    ])
    expect(checks[0]!.homogeneous).toBe(true)
    expect(checks[2]!.computedKind).toBe('none')
    expect(checks[2]!.homogeneous).toBeUndefined()
    expect(checks[2]!.matrix).toBe(
      '\\left[\\begin{array}{cc|c} 1&1&1\\\\ 0&1&0\\\\ 0&1&0\\\\ 1&3&0 \\end{array}\\right]',
    )
    expect(checkHasConflict(checks[2]!)).toBe(true)
  })

  it('still flags an old-shape augmented system declared unique that is inconsistent', () => {
    const [check, explicit] = checkLinearSystems([
      {
        label: '(f)',
        augmented: [
          [1, 2, 3],
          [2, 4, 7],
          [1, 1, 1],
        ],
        rref: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        // Coefficient-only it would be A x = 0 with rank 3 = only the trivial
        // solution, so a "unique" claim is ambiguous; "infinite" fits neither.
        solution: 'infinite',
      },
      {
        label: 'flag',
        augmented: independence.augmented,
        homogeneous: true,
        rref: independence.rref,
        solution: 'infinite',
      },
    ])
    expect(check).toMatchObject({ kindMatches: false, computedKind: 'none' })
    expect(checkHasConflict(check!)).toBe(true)
    // Declared homogeneous, the reading is certain: "infinite" for independent columns is flagged.
    expect(explicit).toMatchObject({
      homogeneous: true,
      kindMatches: false,
      computedKind: 'unique',
    })
    expect(checkHasConflict(explicit!)).toBe(true)
  })

  it('reads both payload shapes from a model reply', () => {
    const section = HomeworkWalkthroughV1.normalizeQuestionSection({
      status: 'ready',
      conclusion: 'c',
      body: 'b',
      linearSystems: [
        independence,
        {
          label: '(b)',
          coefficients: [[1]],
          rhs: 'homogeneous',
          rref: [[1]],
          solutionType: 'unique',
        },
      ],
    })
    expect(section).toMatchObject({
      status: 'ready',
      linearSystems: [
        { label: '(c)', augmented: independence.augmented, solution: 'unique' },
        {
          label: '(b)',
          coefficients: [[1]],
          rhs: 'homogeneous',
          homogeneous: true,
          solution: 'unique',
        },
      ],
    })
  })

  it('asks v8 prompts and the import prompt for the unambiguous shape', () => {
    for (const prompt of [
      prompts.homeworkWalkthrough.buildQuestionSystemPrompt({ linearSystems: true }),
      prompts.homeworkWalkthrough.buildPartSystemPrompt({ linearSystems: true }),
      prompts.homeworkWalkthrough.buildVariantSystemPrompt({
        linearSystems: true,
        level: 'detailed',
      }),
      prompts.walkthroughImport.buildSystemPrompt({ checkIssues: true, linearSystems: true }),
    ]) {
      expect(prompt).toContain('"coefficients"')
      expect(prompt).toContain('"homogeneous"')
      expect(prompt).not.toContain('"augmented"')
      expect(prompt).not.toContain('give the full augmented matrix')
    }
    expect(prompts.homeworkWalkthrough.buildPartSystemPrompt({ linearSystems: true })).toContain(
      'in this sub-part, give "coefficients"',
    )
    // Without linear systems the prompts are v7's word for word.
    expect(prompts.homeworkWalkthrough.buildQuestionSystemPrompt({ linearSystems: false })).toBe(
      HomeworkWalkthroughV7.buildQuestionSystemPrompt({ linearSystems: false }),
    )
    expect(prompts.homeworkWalkthrough.CACHE_VERSION).toBe('v1')
  })

  it('recognises questions that involve row reduction', () => {
    expect(
      involvesRowReduction(
        'By forming the augmented matrix and using the Reduced Row Echelon Form (RREF), solve',
      ),
    ).toBe(true)
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
    ({
      id,
      prompt,
      number: id,
      sourceRefs: [],
      answerStatus: undefined,
    }) as unknown as HomeworkQuestion

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
      sections: empty.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        title: '',
        body: 'x',
        status: 'ready' as const,
        inputHash: entry.inputHash,
        generatedAt: 1,
      })),
    }
    expect(
      planWalkthrough(questions, stored, 'zh_terms', 'v').every((entry) => !entry.needsWork),
    ).toBe(true)
    const changed = planWalkthrough(
      [questions[0]!, question('2', 'Solve B again.')],
      stored,
      'zh_terms',
      'v',
    )
    expect(changed.filter((entry) => entry.needsWork).map((entry) => entry.id)).toEqual([
      'overview',
      'q:2',
      'summary',
    ])
    expect(changed.find((entry) => entry.id === 'q:2')!.outdated).toBe(true)
    expect(questionSectionHash(questions[0]!, 'zh_terms', 'v')).not.toBe(
      questionSectionHash(questions[0]!, 'en', 'v'),
    )
  })
})
