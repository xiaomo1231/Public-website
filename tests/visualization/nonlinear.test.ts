import { describe, expect, it } from 'vitest'
import {
  FUNCTION_LIMITS,
  normalizeFunctionDomain,
  parseExplicitFunction,
  sampleFunction,
} from '@/entities/tutorVisualization/nonlinear'
import type { VisualizationViewport } from '@/entities/tutorVisualization/types'

const VP: VisualizationViewport = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }

function evalAt(expr: string, x: number): number {
  const parsed = parseExplicitFunction(expr)
  if (!parsed) throw new Error(`expected ${expr} to parse`)
  return parsed.evaluate(x)
}

describe('parseExplicitFunction — accepted families', () => {
  it('parses a quadratic and evaluates it', () => {
    expect(evalAt('x^2 + 2x + 1', 3)).toBe(16)
    expect(evalAt('x^2 - 4', -2)).toBe(0)
    expect(evalAt('2x^2', 3)).toBe(18)
  })

  it('parses sine and cosine with amplitude/frequency/phase/offset', () => {
    expect(evalAt('sin(x)', Math.PI / 2)).toBeCloseTo(1, 10)
    expect(evalAt('cos(x)', 0)).toBe(1)
    expect(evalAt('2*sin(3x - 1) + 4', 1 / 3)).toBeCloseTo(4, 10)
    expect(evalAt('3*cos(2x) - 1', 0)).toBeCloseTo(2, 10)
  })

  it('parses exponentials, including the constant e', () => {
    expect(evalAt('exp(-0.5x)', 0)).toBe(1)
    expect(evalAt('3*exp(-x) + 1', 0)).toBe(4)
    expect(evalAt('e^x', 1)).toBeCloseTo(Math.E, 10)
    expect(evalAt('e^(-x^2)', 0)).toBe(1)
  })

  it('parses logarithms and square roots', () => {
    expect(evalAt('ln(x)', Math.E)).toBeCloseTo(1, 10)
    expect(evalAt('log(x + 1)', 0)).toBe(0)
    expect(evalAt('sqrt(2x + 4)', 0)).toBe(2)
    expect(evalAt('sqrt(x)', 9)).toBe(3)
  })

  it('parses reciprocals', () => {
    expect(evalAt('1/(x + 1)', 1)).toBe(0.5)
    expect(evalAt('2/(x + 1) - 3', 0)).toBe(-1)
  })

  it('accepts constants and safe real exponents', () => {
    expect(evalAt('pi', 0)).toBeCloseTo(Math.PI, 10)
    expect(evalAt('2*pi', 0)).toBeCloseTo(2 * Math.PI, 10)
    expect(evalAt('x^0.5', 9)).toBeCloseTo(3, 10)
    expect(evalAt('x^(1 + 1)', 4)).toBe(16)
  })
})

describe('parseExplicitFunction — whitelist and limits', () => {
  it.each([
    '',
    '   ',
    'y',
    'a*x',
    'sin(y)',
    'tan(x)',
    'abs(x)',
    'x!',
    'a=1',
    'f(x)=x',
    'x.y',
    '[1,2]',
    'x^x',
    '2^x',
    'x^7',
    'x^3',
    'x^-1',
    'x^(2^3)',
    '1e400',
    '\\sin(x)',
  ])('rejects %s', (expression) => {
    expect(parseExplicitFunction(expression)).toBeNull()
  })

  it('rejects expressions over the length limit', () => {
    expect(parseExplicitFunction('x'.repeat(FUNCTION_LIMITS.maxLength + 1))).toBeNull()
  })

  it('rejects expressions over the node limit', () => {
    const long = Array.from({ length: 100 }, () => 'x').join('+')
    expect(parseExplicitFunction(long)).toBeNull()
  })

  it('rejects expressions over the depth limit', () => {
    const deep = '('.repeat(20) + 'x' + ')'.repeat(20)
    expect(parseExplicitFunction(deep)).toBeNull()
  })

  it('honours custom limits', () => {
    const limits = { ...FUNCTION_LIMITS, maxNodes: 3 }
    expect(parseExplicitFunction('x + x + x + x', limits)).toBeNull()
    expect(parseExplicitFunction('x + x', limits)).not.toBeNull()
  })
})

describe('normalizeFunctionDomain', () => {
  it('accepts a finite ordered domain', () => {
    expect(normalizeFunctionDomain({ min: -5, max: 5 })).toEqual({ min: -5, max: 5 })
  })

  it.each([
    { min: 5, max: -5 },
    { min: 0, max: 0 },
    { min: Number.NaN, max: 5 },
    { min: -5, max: Number.POSITIVE_INFINITY },
    { min: -1e9, max: 1e9 },
    null,
    'nope',
  ])('rejects %o', (raw) => {
    expect(normalizeFunctionDomain(raw)).toBeUndefined()
  })
})

describe('sampleFunction', () => {
  it('samples a quadratic as one continuous segment', () => {
    const parsed = parseExplicitFunction('x^2')!
    const { segments } = sampleFunction(parsed.evaluate, VP)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.length).toBeGreaterThan(100)
    for (const point of segments[0]!) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
      expect(point.y).toBeCloseTo(point.x * point.x, 6)
    }
  })

  it('is deterministic for the same input', () => {
    const parsed = parseExplicitFunction('2*sin(3x) + 1')!
    const first = sampleFunction(parsed.evaluate, VP)
    const second = sampleFunction(parsed.evaluate, VP)
    expect(second).toEqual(first)
  })

  it('splits a reciprocal into separate branches without bridging the pole', () => {
    const parsed = parseExplicitFunction('1/x')!
    const { segments } = sampleFunction(parsed.evaluate, VP)
    expect(segments.length).toBeGreaterThanOrEqual(2)
    for (const segment of segments) {
      const xs = segment.map((point) => point.x)
      const hasNegative = xs.some((x) => x < 0)
      const hasPositive = xs.some((x) => x > 0)
      // A single segment must not straddle the asymptote.
      expect(hasNegative && hasPositive).toBe(false)
    }
  })

  it('respects the logarithm domain', () => {
    const parsed = parseExplicitFunction('ln(x)')!
    const { segments } = sampleFunction(parsed.evaluate, VP)
    expect(segments.length).toBeGreaterThan(0)
    for (const segment of segments) {
      for (const point of segment) expect(point.x).toBeGreaterThan(0)
    }
  })

  it('includes the square-root domain endpoint', () => {
    const parsed = parseExplicitFunction('sqrt(x)')!
    const { segments } = sampleFunction(parsed.evaluate, VP)
    expect(segments.length).toBeGreaterThan(0)
    const all = segments.flat()
    expect(Math.min(...all.map((point) => point.x))).toBeGreaterThanOrEqual(0)
  })

  it('never emits non-finite points for an overflowing exponential', () => {
    const parsed = parseExplicitFunction('exp(x)')!
    const wide: VisualizationViewport = { xMin: 0, xMax: 1000, yMin: -10, yMax: 10 }
    const { segments } = sampleFunction(parsed.evaluate, wide)
    for (const segment of segments) {
      for (const point of segment) {
        expect(Number.isFinite(point.x)).toBe(true)
        expect(Number.isFinite(point.y)).toBe(true)
        expect(Math.abs(point.y)).toBeLessThanOrEqual(1e6)
      }
    }
  })

  it('drops a single non-finite sample without breaking the rest', () => {
    const withHole = (x: number): number => (Math.abs(x) < 0.01 ? Number.NaN : x)
    const { segments } = sampleFunction(withHole, VP)
    expect(segments.length).toBe(2)
    for (const segment of segments) {
      for (const point of segment) expect(Number.isFinite(point.y)).toBe(true)
    }
  })

  it('respects the sample cap', () => {
    const parsed = parseExplicitFunction('sin(x)')!
    const { segments } = sampleFunction(parsed.evaluate, VP, undefined, 300)
    const total = segments.reduce((sum, segment) => sum + segment.length, 0)
    expect(total).toBeLessThanOrEqual(300)
  })

  it('restricts sampling to an explicit domain', () => {
    const parsed = parseExplicitFunction('1/x')!
    const { segments } = sampleFunction(parsed.evaluate, VP, { min: 1, max: 4 })
    const xs = segments.flat().map((point) => point.x)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...xs)).toBeLessThanOrEqual(4)
  })

  it('returns nothing when the viewport is outside the domain', () => {
    const parsed = parseExplicitFunction('sqrt(x)')!
    const negative: VisualizationViewport = { xMin: -10, xMax: -1, yMin: -10, yMax: 10 }
    expect(sampleFunction(parsed.evaluate, negative).segments).toEqual([])
  })
})
