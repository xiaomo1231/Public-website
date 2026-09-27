import { describe, expect, it } from 'vitest'
import { parseExplicitFunction } from '@/entities/tutorVisualization/nonlinear'
import {
  FUNCTION_TYPE_BY_ID,
  defaultsForType,
  pickInitialFunctionType,
  type FunctionTypeId,
} from '@/widgets/dashboard/functionTypes'

/**
 * The families are the contract between the sliders and the drawn curve: each
 * must compile with the lesson visualizer's own parser and evaluate to the
 * value its printed formula promises.
 */
function evaluateAt(id: FunctionTypeId, values: Record<string, number>, x: number): number {
  const parsed = parseExplicitFunction(FUNCTION_TYPE_BY_ID[id].buildExpression(values))
  expect(parsed, `${id} expression must parse`).not.toBeNull()
  return parsed!.evaluate(x)
}

describe('function families', () => {
  it('picks the initial family uniformly and clamps out-of-range input', () => {
    expect(pickInitialFunctionType(0)).toBe('linear')
    expect(pickInitialFunctionType(0.24)).toBe('linear')
    expect(pickInitialFunctionType(0.25)).toBe('quadratic')
    expect(pickInitialFunctionType(0.5)).toBe('cubic')
    expect(pickInitialFunctionType(0.999)).toBe('sine')
    expect(pickInitialFunctionType(1)).toBe('sine')
    expect(pickInitialFunctionType(-3)).toBe('linear')
  })

  it('every family parses with its default coefficients', () => {
    for (const def of Object.values(FUNCTION_TYPE_BY_ID)) {
      const parsed = parseExplicitFunction(def.buildExpression(defaultsForType(def.id)))
      expect(parsed, `${def.id} defaults must parse`).not.toBeNull()
    }
  })

  it('evaluates the linear family correctly', () => {
    // f(x) = 2x - 3 → f(2) = 1
    expect(evaluateAt('linear', { a: 2, b: -3 }, 2)).toBeCloseTo(1, 10)
  })

  it('evaluates the quadratic family correctly', () => {
    // f(x) = x² - 2x + 1 → f(3) = 4
    expect(evaluateAt('quadratic', { a: 1, b: -2, c: 1 }, 3)).toBeCloseTo(4, 10)
  })

  it('evaluates the cubic family correctly (no unsafe exponent)', () => {
    // f(x) = 0.5x³ + x² - 2x → f(2) = 4
    expect(evaluateAt('cubic', { a: 0.5, b: 1, c: -2 }, 2)).toBeCloseTo(4, 10)
  })

  it('evaluates the sine family correctly', () => {
    // f(x) = 2·sin(x) → f(π/2) = 2
    expect(evaluateAt('sine', { A: 2, w: 1, phi: 0 }, Math.PI / 2)).toBeCloseTo(2, 10)
    // f(x) = 2·sin(x + π/2) = 2·cos(x) → f(0) = 2
    expect(evaluateAt('sine', { A: 2, w: 1, phi: Math.PI / 2 }, 0)).toBeCloseTo(2, 10)
  })

  it('prints a formula that matches the coefficients (zero terms dropped)', () => {
    expect(FUNCTION_TYPE_BY_ID.linear.formatFormula({ a: 2, b: -3 })).toBe('f(x) = 2·x − 3')
    expect(FUNCTION_TYPE_BY_ID.quadratic.formatFormula({ a: 1, b: -2, c: 3 })).toBe(
      'f(x) = x² − 2·x + 3',
    )
    expect(FUNCTION_TYPE_BY_ID.cubic.formatFormula({ a: -0.5, b: 1, c: 0 })).toBe(
      'f(x) = −0.5·x³ + x²',
    )
    expect(FUNCTION_TYPE_BY_ID.sine.formatFormula({ A: 2, w: 1, phi: 0 })).toBe('f(x) = 2·sin(x)')
  })
})
