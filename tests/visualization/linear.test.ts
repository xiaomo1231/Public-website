import { describe, expect, it } from 'vitest'
import {
  computeAutoViewport,
  fitViewport,
  isStrictRelation,
  lineIntersection,
  niceTickStep,
  normalizeLatexMath,
  normalizeViewport,
  parseRelationLatex,
  shadeDirection,
  toLine,
} from '@/entities/tutorVisualization/linear'

/**
 * The maths is the part that must be exactly right. A wrong line is worse than
 * no line, so every case here is either a known-correct geometry or an
 * explicitly unsupported expression that must return `null`.
 */

function slope(latex: string): { m: number; b: number } | null {
  const parsed = parseRelationLatex(latex)
  if (!parsed || parsed.line.kind !== 'slope') return null
  return { m: parsed.line.m, b: parsed.line.b }
}

describe('parseRelationLatex — functions', () => {
  it.each([
    ['y = x', 1, 0],
    ['y = -x', -1, 0],
    ['y = 2x + 1', 2, 1],
    ['y = -2x + 3', -2, 3],
    ['y = 3', 0, 3],
    ['y = x - 4', 1, -4],
    ['y = 2(x + 1)', 2, 2],
    ['y = \\frac{1}{2}x + 1', 0.5, 1],
    ['y=-x+3', -1, 3],
  ])('%s → slope %d, intercept %d', (latex, m, b) => {
    expect(slope(latex as string)).toEqual({ m, b })
  })
})

describe('parseRelationLatex — equations and lines', () => {
  it('handles a vertical line', () => {
    const parsed = parseRelationLatex('x = 2')
    expect(parsed?.line).toEqual({ kind: 'vertical', x: 2 })
  })

  it('handles a horizontal line written as an equation', () => {
    const parsed = parseRelationLatex('y = 3')
    expect(parsed?.line).toEqual({ kind: 'slope', m: 0, b: 3 })
  })

  it('rearranges a standard-form equation', () => {
    // 2x + y = 4  →  y = -2x + 4
    expect(slope('2x + y = 4')).toEqual({ m: -2, b: 4 })
  })

  it('rearranges both variables to one side', () => {
    // x + y = 6  →  y = -x + 6
    expect(slope('x + y = 6')).toEqual({ m: -1, b: 6 })
    // x - y = 2  →  y = x - 2
    expect(slope('x - y = 2')).toEqual({ m: 1, b: -2 })
  })

  it('solves a system intersection exactly', () => {
    const first = parseRelationLatex('x + y = 6')
    const second = parseRelationLatex('x - y = 2')
    expect(first && second).toBeTruthy()
    expect(lineIntersection(first!.form, second!.form)).toEqual({ x: 4, y: 2 })
  })

  it('solves a vertical/horizontal intersection', () => {
    const first = parseRelationLatex('x = 2')
    const second = parseRelationLatex('y = 3')
    expect(lineIntersection(first!.form, second!.form)).toEqual({ x: 2, y: 3 })
  })

  it('returns null for parallel lines', () => {
    const first = parseRelationLatex('y = x + 1')
    const second = parseRelationLatex('y = x - 4')
    expect(lineIntersection(first!.form, second!.form)).toBeNull()
  })
})

describe('parseRelationLatex — inequalities', () => {
  it('keeps the relation and shades above for y >= 2x - 1', () => {
    const parsed = parseRelationLatex('y >= 2x - 1')
    expect(parsed?.relation).toBe('>=')
    expect(shadeDirection(parsed!.form, parsed!.relation)).toBe('above')
    expect(isStrictRelation(parsed!.relation)).toBe(false)
  })

  it('understands LaTeX \\ge and \\le', () => {
    const ge = parseRelationLatex('y \\ge 2x - 1')
    expect(ge?.relation).toBe('>=')
    const le = parseRelationLatex('y \\le -x + 3')
    expect(le?.relation).toBe('<=')
    expect(shadeDirection(le!.form, le!.relation)).toBe('below')
  })

  it('shades below and is strict for y < -x + 3', () => {
    const parsed = parseRelationLatex('y < -x + 3')
    expect(parsed?.relation).toBe('<')
    expect(shadeDirection(parsed!.form, parsed!.relation)).toBe('below')
    expect(isStrictRelation(parsed!.relation)).toBe(true)
  })

  it('shades left/right for a vertical inequality', () => {
    const right = parseRelationLatex('x > 2')
    expect(shadeDirection(right!.form, right!.relation)).toBe('right')
    const left = parseRelationLatex('x \\le -1')
    expect(shadeDirection(left!.form, left!.relation)).toBe('left')
  })
})

describe('parseRelationLatex — unsupported input', () => {
  it.each([
    'y = x^2',
    'y = \\sin x',
    'y = 1/x',
    'x^2 + y^2 = 4',
    'xy = 1',
    'y = e^x',
    'y = \\sqrt{x}',
    'y = ',
    '= 2x',
    'y = \\frac{a}{',
    '',
    'just prose',
  ])('rejects %s', (latex) => {
    expect(parseRelationLatex(latex)).toBeNull()
  })

  it('rejects non-finite coefficients', () => {
    expect(toLine({ a: 0, b: 1, c: Number.POSITIVE_INFINITY })).toBeNull()
    expect(toLine({ a: Number.NaN, b: 1, c: 0 })).toBeNull()
  })

  it('rejects a degenerate relation with no variables', () => {
    expect(parseRelationLatex('1 = 1')).toBeNull()
  })
})

describe('normalizeLatexMath', () => {
  it('does not mistake \\left for \\le', () => {
    expect(normalizeLatexMath('\\left(x\\right) = 1')).toContain('(x)')
  })

  it('converts spacing and multiplication commands', () => {
    expect(normalizeLatexMath('2 \\cdot x')).toBe('2 * x')
  })
})

describe('viewport handling', () => {
  it('accepts a valid viewport', () => {
    expect(normalizeViewport({ xMin: -5, xMax: 5, yMin: -2, yMax: 2 })).toEqual({
      xMin: -5,
      xMax: 5,
      yMin: -2,
      yMax: 2,
    })
  })

  it.each([
    { xMin: 0, xMax: 0, yMin: -1, yMax: 1 },
    { xMin: 5, xMax: -5, yMin: -1, yMax: 1 },
    { xMin: -1, xMax: 1, yMin: 0, yMax: Number.POSITIVE_INFINITY },
    { xMin: Number.NaN, xMax: 1, yMin: -1, yMax: 1 },
    { xMin: -1e9, xMax: 1e9, yMin: -1, yMax: 1 },
    null,
    'nope',
  ])('rejects an invalid viewport: %o', (raw) => {
    expect(normalizeViewport(raw)).toBeUndefined()
  })

  it('auto-includes explicit points', () => {
    const viewport = computeAutoViewport(
      [],
      [
        { x: -2, y: 3 },
        { x: 12, y: -7 },
      ],
    )
    expect(viewport.xMin).toBeLessThanOrEqual(-2)
    expect(viewport.xMax).toBeGreaterThanOrEqual(12)
    expect(viewport.yMin).toBeLessThanOrEqual(-7)
    expect(viewport.yMax).toBeGreaterThanOrEqual(3)
  })

  it('preserves the unit aspect ratio by only expanding', () => {
    const fitted = fitViewport({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, 1.6)
    const xSpan = fitted.xMax - fitted.xMin
    const ySpan = fitted.yMax - fitted.yMin
    expect(xSpan / ySpan).toBeCloseTo(1.6, 6)
    // Expansion only — the original window is still inside.
    expect(fitted.xMin).toBeLessThanOrEqual(-10)
    expect(fitted.xMax).toBeGreaterThanOrEqual(10)
  })

  it('produces a sensible tick step', () => {
    expect(niceTickStep(20)).toBeGreaterThan(0)
    expect(niceTickStep(0)).toBe(1)
  })
})
