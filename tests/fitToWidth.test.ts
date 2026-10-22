import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import katex from 'katex'
import { breakDisplayLatex, hasTopLevelBreaks, topLevelBreaks } from '@/shared/lib/mathBreak'
import {
  breakBudget,
  fitRatio,
  HARD_MIN_SCALE,
  INITIAL_DISPLAY_STAGE,
  INITIAL_SCALE_STAGE,
  INITIAL_STEP_PAIR_STAGE,
  nextDisplayStage,
  nextStepPairStage,
  PRINT_FIT,
  SCREEN_FIT,
  shrinkStep,
  type DisplayStage,
} from '@/shared/lib/fitToWidth'

const renders = (latex: string) =>
  katex.renderToString(latex, { displayMode: true, throwOnError: true, strict: false })

describe('top-level breaks of a display formula', () => {
  it('finds relations and binary + / − only at the top level', () => {
    const latex = 'a = b + c'
    expect(topLevelBreaks(latex)).toEqual([
      { index: 2, kind: 'rel' },
      { index: 6, kind: 'bin' },
    ])
  })

  it('never splits inside braces, \\frac, \\left…\\right, brackets or matrices', () => {
    expect(topLevelBreaks('\\frac{a+b}{c-d} = e')).toEqual([{ index: 16, kind: 'rel' }])
    expect(topLevelBreaks('\\left( a + b = c \\right) \\le 2')).toEqual([
      { index: 25, kind: 'rel' },
    ])
    expect(topLevelBreaks('f(x - 1) = [a + b]')!.map((b) => b.kind)).toEqual(['rel'])
    const matrix = '\\begin{bmatrix} 1 & -2 \\\\ 3 & 4 \\end{bmatrix} = A'
    expect(topLevelBreaks(matrix)!.map((b) => b.kind)).toEqual(['rel'])
    expect(topLevelBreaks('\\sqrt{x^2 + y^2} = r')!.map((b) => b.kind)).toEqual(['rel'])
  })

  it('treats signs as unary after relations, operators, ^ and _', () => {
    expect(topLevelBreaks('-a + b')).toEqual([{ index: 3, kind: 'bin' }])
    expect(topLevelBreaks('x = -1')).toEqual([{ index: 2, kind: 'rel' }])
    expect(topLevelBreaks('2 \\cdot -3')).toEqual([])
    expect(topLevelBreaks('x^-1 + 2')!.map((b) => b.kind)).toEqual(['bin'])
    expect(topLevelBreaks('a \\not= b')).toEqual([{ index: 2, kind: 'rel' }])
    expect(topLevelBreaks('a <= b')).toEqual([{ index: 2, kind: 'rel' }])
  })

  it('refuses formulas that are already multi-line, aligned, tagged or carry text', () => {
    expect(topLevelBreaks('a = b \\\\ c = d')).toBeNull()
    expect(topLevelBreaks('a &= b')).toBeNull()
    expect(topLevelBreaks('x = 1 \\quad y = 2')).toBeNull()
    expect(topLevelBreaks('x = 1, y = 2')).toBeNull()
    expect(topLevelBreaks('x = 1 \\text{ if } y = 2')).toBeNull()
    expect(topLevelBreaks('a = b \\tag{1}')).toBeNull()
    expect(topLevelBreaks('(a = b')).toBeNull()
    expect(hasTopLevelBreaks('\\boxed{x = 1 + 2}')).toBe(false)
  })
})

describe('breakDisplayLatex', () => {
  it('aligns a chain at its relations, one per line when the budget is short', () => {
    const latex = 'a = b + c = d + e'
    const broken = breakDisplayLatex(latex, 10)!
    expect(broken).toBe('\\begin{aligned}a &= b + c \\\\ &= d + e\\end{aligned}')
    expect(() => renders(broken)).not.toThrow()
  })

  it('continues a long right-hand side at top-level + / − with an indent', () => {
    const latex = 'S = \\frac{1}{2} + \\frac{1}{3} + \\frac{1}{4} - \\frac{1}{5}'
    const broken = breakDisplayLatex(latex, 30)!
    expect(broken).toContain('&\\quad')
    expect(broken).toContain('\\frac{1}{2}')
    // No break inside a fraction: every \frac keeps its two groups.
    expect(broken.match(/\\frac\{1\}\{\d\}/g)).toHaveLength(4)
    expect(() => renders(broken)).not.toThrow()
  })

  it('breaks a long sum without relations into left-aligned lines', () => {
    const broken = breakDisplayLatex('x_1 + x_2 + x_3 + x_4 + x_5 + x_6', 12)!
    expect(broken.startsWith('\\begin{aligned}&x_1')).toBe(true)
    expect(() => renders(broken)).not.toThrow()
  })

  it('keeps matrices, \\left…\\right and \\boxed whole', () => {
    const latex =
      '\\begin{bmatrix} 1 & -2 \\\\ 3 & 4 \\end{bmatrix} = \\left( \\begin{matrix} a + b \\end{matrix} \\right) + C'
    const broken = breakDisplayLatex(latex, 10)!
    // The long left side stays whole on its own line; the chain aligns below it.
    expect(broken).toContain('\\begin{bmatrix} 1 & -2 \\\\ 3 & 4 \\end{bmatrix} \\\\ &= \\left(')
    expect(broken).toContain('\\left( \\begin{matrix} a + b \\end{matrix} \\right)')
    expect(() => renders(broken)).not.toThrow()
    expect(breakDisplayLatex('\\boxed{x = 1 + 2 + 3}', 4)).toBeNull()
  })

  it('returns null when everything fits on one line', () => {
    expect(breakDisplayLatex('a = b + c', 100)).toBeNull()
    expect(breakDisplayLatex('a', 1)).toBeNull()
  })

  it('derives the line length from the measured ratio', () => {
    expect(breakBudget('a'.repeat(100), 0.5)).toBe(47)
    expect(breakBudget('abc', 0.1)).toBe(12)
  })
})

describe('fit decisions from measured sizes', () => {
  it('scales by the measured ratio, rounded down to fit', () => {
    expect(fitRatio(600, 630)).toBe(0.95)
    expect(fitRatio(600, 300)).toBe(1)
  })

  it('shrinks to fit, then scrolls at the floor (screen) or keeps shrinking (print)', () => {
    expect(shrinkStep(INITIAL_SCALE_STAGE, { available: 300, content: 290 }, SCREEN_FIT)).toBeNull()
    expect(shrinkStep(INITIAL_SCALE_STAGE, { available: 400, content: 500 }, SCREEN_FIT)).toEqual({
      scale: 0.79,
      scroll: false,
    })
    expect(shrinkStep(INITIAL_SCALE_STAGE, { available: 300, content: 600 }, SCREEN_FIT)).toEqual({
      scale: 0.7,
      scroll: true,
    })
    expect(shrinkStep(INITIAL_SCALE_STAGE, { available: 300, content: 600 }, PRINT_FIT)).toEqual({
      scale: 0.49,
      scroll: false,
    })
    expect(
      shrinkStep(INITIAL_SCALE_STAGE, { available: 100, content: 1000 }, PRINT_FIT)!.scale,
    ).toBe(HARD_MIN_SCALE)
    // Already scrolling: nothing more to try.
    expect(
      shrinkStep({ scale: 0.7, scroll: true }, { available: 1, content: 9 }, SCREEN_FIT),
    ).toBeNull()
  })

  it('a display formula: a little too wide is shrunk, not broken', () => {
    const next = nextDisplayStage(
      INITIAL_DISPLAY_STAGE,
      { available: 600, content: 630 },
      { ...SCREEN_FIT, breakable: true },
    )
    expect(next).toEqual({ variant: 'natural', scale: 0.95, scroll: false })
  })

  it('a display formula: break → shrink the lines → wrap → shrink → scroll', () => {
    const options = { ...SCREEN_FIT, breakable: true }
    let stage: DisplayStage = INITIAL_DISPLAY_STAGE
    stage = nextDisplayStage(stage, { available: 300, content: 600 }, options)!
    expect(stage).toMatchObject({ variant: 'broken', scale: 1, budget: 0.49 })
    // The lines are still a little wide: shrink them.
    expect(nextDisplayStage(stage, { available: 300, content: 350 }, options)).toMatchObject({
      variant: 'broken',
      scale: 0.85,
    })
    // Far too wide even broken: wrap at KaTeX's break points instead.
    stage = nextDisplayStage(stage, { available: 300, content: 500 }, options)!
    expect(stage).toEqual({ variant: 'wrap', scale: 1, scroll: false })
    stage = nextDisplayStage(stage, { available: 300, content: 375 }, options)!
    expect(stage).toEqual({ variant: 'wrap', scale: 0.79, scroll: false })
    // Scaled and still too wide (rounding / a wider piece): the floor, with a scroll.
    stage = nextDisplayStage(stage, { available: 300, content: 400 }, options)!
    expect(stage).toEqual({ variant: 'wrap', scale: 0.7, scroll: true })
    expect(nextDisplayStage(stage, { available: 300, content: 400 }, options)).toBeNull()
  })

  it('a display formula that cannot be broken goes straight to shrink / wrap', () => {
    const options = { ...SCREEN_FIT, breakable: false }
    expect(
      nextDisplayStage(INITIAL_DISPLAY_STAGE, { available: 300, content: 400 }, options),
    ).toEqual({ variant: 'natural', scale: 0.74, scroll: false })
    expect(
      nextDisplayStage(INITIAL_DISPLAY_STAGE, { available: 300, content: 900 }, options),
    ).toEqual({ variant: 'wrap', scale: 1, scroll: false })
  })

  it('print never scrolls: a wrapped formula keeps scaling to the hard floor', () => {
    const options = { ...PRINT_FIT, breakable: false }
    const wrap: DisplayStage = { variant: 'wrap', scale: 1, scroll: false }
    expect(nextDisplayStage(wrap, { available: 300, content: 600 }, options)).toEqual({
      variant: 'wrap',
      scale: 0.49,
      scroll: false,
    })
  })

  it('a step card stacks its matrices, then scales them, then scrolls', () => {
    expect(
      nextStepPairStage(INITIAL_STEP_PAIR_STAGE, { available: 400, content: 380 }, SCREEN_FIT),
    ).toBeNull()
    const stacked = nextStepPairStage(
      INITIAL_STEP_PAIR_STAGE,
      { available: 400, content: 520 },
      SCREEN_FIT,
    )!
    expect(stacked).toEqual({ layout: 'stack', scale: 1, scroll: false })
    expect(nextStepPairStage(stacked, { available: 400, content: 450 }, SCREEN_FIT)).toEqual({
      layout: 'stack',
      scale: 0.88,
      scroll: false,
    })
    expect(nextStepPairStage(stacked, { available: 400, content: 900 }, SCREEN_FIT)).toEqual({
      layout: 'stack',
      scale: 0.7,
      scroll: true,
    })
  })
})

describe('fitted reading CSS', () => {
  const css = readFileSync(resolve(__dirname, '../src/shared/styles/globals.css'), 'utf8')

  it('fitted display formulas clip while measured and scroll only in the last stage', () => {
    expect(css).toMatch(/\.katex-host\.katex-fit \.katex-display \{\s*overflow-x: hidden;/)
    expect(css).toMatch(
      /\.katex-host\.katex-fit\[data-fit-scroll\] \.katex-display \{\s*overflow-x: auto;/,
    )
    expect(css).toMatch(/\[data-fit-wrap\] \.katex-display > \.katex[\s\S]*?white-space: normal;/)
  })

  it('nothing forces fitted or walkthrough math onto one line', () => {
    const rules = css.split('}').filter((rule) => /katex-fit|data-walkthrough-body/.test(rule))
    for (const rule of rules) expect(rule).not.toMatch(/white-space:\s*nowrap/)
    const walkthrough = rules.filter((rule) => rule.includes('data-walkthrough-body'))
    for (const rule of walkthrough) expect(rule).not.toMatch(/overflow-x:\s*(auto|scroll)/)
  })
})
