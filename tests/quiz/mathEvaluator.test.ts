import { describe, expect, it } from 'vitest'
import {
  compareMath,
  normalizeExpression,
  numericEquivalent,
  parseNumeric,
  splitEquation,
  stripIntegrationConstant,
} from '@/infrastructure/math/expressionEvaluator'

describe('normalizeExpression', () => {
  it('converts unicode superscripts to caret notation', () => {
    expect(normalizeExpression('0.5x²')).toBe('0.5x^2')
    expect(normalizeExpression('x³ + 2')).toBe('x^3 + 2')
  })

  it('converts unicode operators', () => {
    expect(normalizeExpression('2 × 3')).toBe('2 * 3')
    expect(normalizeExpression('6 ÷ 2')).toBe('6 / 2')
    expect(normalizeExpression('π')).toBe('pi')
  })

  it('normalises unicode minus', () => {
    expect(normalizeExpression('x − 1')).toBe('x - 1')
  })
})

describe('compareMath — equivalent forms', () => {
  it('x^2 / 2 equals 0.5x²', () => {
    const r = compareMath('0.5x²', 'x^2 / 2')
    expect(r.equivalent).toBe(true)
  })

  it('x^3/3 + C equals x^3/3 (integration constant)', () => {
    const r = compareMath('x^3/3 + C', 'x^3/3')
    expect(r.equivalent).toBe(true)
    expect(r.note).toMatch(/constant/i)
  })

  it('(x+1)^2 equals x^2 + 2x + 1', () => {
    const r = compareMath('(x+1)^2', 'x^2 + 2x + 1')
    expect(r.equivalent).toBe(true)
  })

  it('2x + 3 equals 3 + 2x', () => {
    const r = compareMath('3 + 2x', '2x + 3')
    expect(r.equivalent).toBe(true)
  })

  it('implicit multiplication is understood', () => {
    const r = compareMath('2x', '2*x')
    expect(r.equivalent).toBe(true)
  })

  it('trig identity: sin^2 + cos^2 equals 1', () => {
    const r = compareMath('sin(x)^2 + cos(x)^2', '1')
    expect(r.equivalent).toBe(true)
  })

  it('equations compare side by side', () => {
    const r = compareMath('x^2 = 4', '4 = x^2')
    expect(r.equivalent).toBe(true)
  })

  it('rearranged equations are reported as unverified, not wrong', () => {
    const r = compareMath('2x = 4', 'x = 2')
    // These are equivalent equations, but we cannot prove it without solving,
    // so the honest answer is "unverified".
    expect(r.equivalent).toBeNull()
    expect(r.note).toMatch(/verify/i)
  })

  it('equations with one matching side and one different side are wrong', () => {
    const r = compareMath('x^2 = 5', 'x^2 = 4')
    expect(r.equivalent).toBe(false)
  })
})

describe('compareMath — non-equivalent forms', () => {
  it('x^2 does not equal x^3', () => {
    expect(compareMath('x^3', 'x^2').equivalent).toBe(false)
  })

  it('x + 1 does not equal x - 1', () => {
    expect(compareMath('x - 1', 'x + 1').equivalent).toBe(false)
  })

  it('2x does not equal x', () => {
    expect(compareMath('x', '2x').equivalent).toBe(false)
  })
})

describe('compareMath — unverifiable input', () => {
  it('returns null for unparseable input', () => {
    const r = compareMath('!!! not math !!!', 'x^2')
    expect(r.equivalent).toBeNull()
    expect(r.note).toMatch(/verify/i)
  })

  it('returns false for an empty answer', () => {
    const r = compareMath('', 'x^2')
    expect(r.equivalent).toBe(false)
  })

  it('returns null for free-variable mismatch that cannot be sampled', () => {
    // Different variables: sampling assigns independent values, so it will
    // find a mismatch and report false — that's acceptable and deterministic.
    const r = compareMath('y', 'x')
    expect(r.equivalent).toBe(false)
  })
})

describe('numeric parsing and comparison', () => {
  it('parses plain numbers', () => {
    expect(parseNumeric('42')).toBe(42)
    expect(parseNumeric('-3.5')).toBe(-3.5)
  })

  it('parses thousands separators', () => {
    expect(parseNumeric('1,000')).toBe(1000)
  })

  it('parses simple fractions', () => {
    expect(parseNumeric('3/4')).toBe(0.75)
  })

  it('parses scientific notation', () => {
    expect(parseNumeric('2e-3')).toBeCloseTo(0.002)
  })

  it('returns null for symbolic input', () => {
    expect(parseNumeric('x + 1')).toBeNull()
  })

  it('accepts a small relative tolerance', () => {
    expect(numericEquivalent('3.14159', '3.1416')).toBe(true)
    expect(numericEquivalent('3.1', '3.2')).toBe(false)
    expect(numericEquivalent('100', '100.5')).toBe(true)
    expect(numericEquivalent('100', '105')).toBe(false)
  })

  it('uses a relative tolerance for small expected values', () => {
    expect(numericEquivalent('0', '1.8e-5')).toBe(false)
    expect(numericEquivalent('0.000019', '1.8e-5')).toBe(false)
    expect(numericEquivalent('0.0000180', '1.8e-5')).toBe(true)
    expect(numericEquivalent('0.5', '0.501')).toBe(true)
    expect(numericEquivalent('0.4', '0.5')).toBe(false)
    expect(numericEquivalent('0', '0')).toBe(true)
  })

  it('returns null when either side cannot be parsed', () => {
    expect(numericEquivalent('abc', '1')).toBeNull()
    expect(numericEquivalent('1', 'abc')).toBeNull()
  })
})

describe('compareMath — integration constants', () => {
  it('does not drop a trailing c or k term when the reference is not an antiderivative', () => {
    expect(compareMath('a+b', 'a+b+c').equivalent).toBe(false)
    expect(compareMath('x-k', 'x+k').equivalent).toBe(false)
    expect(compareMath('x+k', 'x+k').equivalent).toBe(true)
  })

  it('ignores the constant on both sides when the reference ends with + C', () => {
    expect(compareMath('x^3/3', 'x^3/3 + C').equivalent).toBe(true)
    expect(compareMath('x^3/3 + c', 'x^3/3 + C').equivalent).toBe(true)
    expect(compareMath('x^2/2 + C', 'x^3/3 + C').equivalent).toBe(false)
  })

  it('does not treat C as a constant when the reference uses it as a symbol', () => {
    expect(compareMath('x + C', 'x + 2C').equivalent).toBe(false)
  })
})

describe('helpers', () => {
  it('stripIntegrationConstant detects + C', () => {
    expect(stripIntegrationConstant('x^2 + C')).toEqual({ expr: 'x^2', hadConstant: true })
    expect(stripIntegrationConstant('x^2 - c')).toEqual({ expr: 'x^2', hadConstant: true })
    expect(stripIntegrationConstant('x^2 + 1')).toEqual({ expr: 'x^2 + 1', hadConstant: false })
  })

  it('splitEquation finds the two sides', () => {
    expect(splitEquation('x + 1 = 2')).toEqual(['x + 1', '2'])
    expect(splitEquation('x <= 2')).toBeNull()
    expect(splitEquation('x == 2')).toBeNull()
    expect(splitEquation('no equals')).toBeNull()
  })
})

describe('review fixes', () => {
  it('accepts antiderivatives that differ by a constant when the reference has + C', () => {
    expect(compareMath('sin(x)^2/2 + C', '-cos(x)^2/2 + C').equivalent).toBe(true)
    expect(compareMath('x^2/2 + 5', 'x^2/2 + C').equivalent).toBe(true)
    // A real difference in the variable part is still wrong.
    expect(compareMath('x^3/3 + C', 'x^2/2 + C').equivalent).toBe(false)
    // Without + C in the reference a shifted answer stays wrong.
    expect(compareMath('x^2 + 1', 'x^2').equivalent).toBe(false)
  })

  it('reads superscript signs as one exponent', () => {
    expect(normalizeExpression('x⁻¹')).toBe('x^(-1)')
    expect(normalizeExpression('1.2×10⁻³')).toBe('1.2*10^(-3)')
    expect(compareMath('x⁻¹', '1/x').equivalent).toBe(true)
    expect(compareMath('1.2×10⁻³', '0.0012').equivalent).toBe(true)
  })

  it('reads ln as the natural log and |…| as abs', () => {
    expect(normalizeExpression('ln(x) + |x - 1|')).toBe('log(x) + abs(x - 1)')
    expect(normalizeExpression('||x|-1|')).toBe('abs(abs(x)-1)')
    expect(compareMath('ln(e^2)', '2').equivalent).toBe(true)
    expect(compareMath('|-3|', '3').equivalent).toBe(true)
    // Ambiguous bars are left as typed (not guessed).
    expect(normalizeExpression('|a|b|c|')).toBe('|a|b|c|')
  })

  it('compares plain numbers relatively, even when tiny', () => {
    expect(compareMath('1.6e-19', '3.2e-19').equivalent).toBe(false)
    expect(compareMath('1.6e-19', '1.6e-19 * 1').equivalent).toBe(true)
    expect(compareMath('sin(pi)', '0').equivalent).toBe(true)
    expect(numericEquivalent('1.6e-19', '3.2e-19')).toBe(false)
    expect(numericEquivalent('1.6e-19', '1.605e-19')).toBe(true)
  })
})
