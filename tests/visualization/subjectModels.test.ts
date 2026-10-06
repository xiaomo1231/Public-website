import { describe, expect, it } from 'vitest'
import {
  derivativeOf,
  integrate,
  parseFormula,
  polynomialText,
  riemannSum,
  taylorCoefficients,
} from '@/entities/tutorVisualization/formula'
import {
  equivalentResistance,
  forceFacts,
  motionFacts,
  opticsFacts,
  solveCircuit,
  type CircuitNode,
} from '@/entities/tutorVisualization/physics'
import {
  apparentConstants,
  concentrationAt,
  confidenceInterval,
  fitArrhenius,
  halfLife,
  linearFit,
  populationAt,
  populationFacts,
  regressionBands,
  slopePValue,
} from '@/entities/tutorVisualization/models'
import { buildBst, sortFrames } from '@/entities/tutorVisualization/algorithms'

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('formulas with parameters', () => {
  it('evaluates only the declared symbols', () => {
    const f = parseFormula('x(t) = A*cos(omega*t + phi)', ['t', 'A', 'omega', 'phi'])!
    near(f.evaluate({ t: 0, A: 2, omega: 1, phi: 0 }), 2)
    expect(parseFormula('A*cos(w*t)', ['t', 'A'])).toBeNull()
    expect(parseFormula('import("fs")', ['x'])).toBeNull()
    expect(parseFormula('x\\cdot 2', ['x'])).toBeNull()
  })

  it('differentiates symbolically', () => {
    const f = parseFormula('x^3 - 2x', ['x'])!
    near(derivativeOf(f, 'x')!.evaluate({ x: 2 }), 10)
    const g = parseFormula('Vmax*S/(Km + S)', ['S', 'Vmax', 'Km'])!
    near(derivativeOf(g, 'S')!.evaluate({ S: 0, Vmax: 10, Km: 2 }), 5)
  })

  it('builds Taylor polynomials', () => {
    const coefficients = taylorCoefficients(parseFormula('exp(x)', ['x'])!, 'x', 0, 4)!
    coefficients.forEach((c, k) => near(c, 1 / [1, 1, 2, 6, 24][k]!, 1e-9))
    const sine = taylorCoefficients(parseFormula('sin(x)', ['x'])!, 'x', 0, 5)!
    near(sine[1]!, 1)
    near(sine[3]!, -1 / 6)
    expect(polynomialText([1, 0, -0.5], 0, 'x', String)).toBe('1 − 0.5x^2')
  })

  it('integrates and forms Riemann sums', () => {
    near(integrate((x) => x * x, 0, 3), 9, 1e-9)
    const { sum } = riemannSum((x) => x * x, 0, 3, 3, 'left')
    near(sum, 5)
    near(riemannSum((x) => x * x, 0, 3, 3, 'right').sum, 14)
    near(riemannSum((x) => x, 0, 2, 4, 'trapezoid').sum, 2)
  })
})

describe('physics', () => {
  it('finds the net force and equilibrium', () => {
    const balanced = forceFacts([
      { label: 'G', magnitude: 10, angle: 270 },
      { label: 'N', magnitude: 10, angle: 90 },
    ])
    expect(balanced.balanced).toBe(true)
    const incline = forceFacts(
      [
        { label: 'mg', magnitude: 19.6, angle: 270 },
        { label: 'N', magnitude: 19.6 * Math.cos(Math.PI / 6), angle: 120 },
      ],
      2,
      30,
    )
    near(incline.acceleration!, 4.9, 1e-3)
    near(incline.alongIncline!, -9.8, 1e-3)
    near(incline.perpendicularToIncline!, 0, 1e-9)
  })

  it('computes displacement and distance with a reversal', () => {
    const facts = motionFacts(0, 10, [{ duration: 4, acceleration: -5 }])
    near(facts.displacement, 0)
    near(facts.distance, 20)
    near(facts.finalVelocity, -10)
  })

  it('solves the thin lens and mirror equations', () => {
    const lens = opticsFacts('converging_lens', 10, 30, 2)
    near(lens.imageDistance, 15)
    near(lens.magnification, -0.5)
    expect(lens.real && !lens.upright && !lens.enlarged).toBe(true)
    const magnifier = opticsFacts('converging_lens', 10, 5, 1)
    near(magnifier.imageDistance, -10)
    expect(magnifier.real).toBe(false)
    expect(opticsFacts('converging_lens', 10, 10, 1).atInfinity).toBe(true)
    const convex = opticsFacts('convex_mirror', 20, 20, 1)
    near(convex.imageDistance, -10)
    expect(convex.upright).toBe(true)
  })

  it('solves series–parallel circuits', () => {
    const network: CircuitNode = {
      kind: 'series',
      items: [
        { kind: 'resistor', label: 'R1', resistance: 4 },
        { kind: 'parallel', items: [{ kind: 'resistor', label: 'R2', resistance: 6 }, { kind: 'resistor', label: 'R3', resistance: 3 }] },
      ],
    }
    near(equivalentResistance(network), 6)
    const readings = solveCircuit(network, 12)
    near(readings.find((r) => r.label === 'R1')!.current, 2)
    near(readings.find((r) => r.label === 'R2')!.voltage, 4)
    near(readings.find((r) => r.label === 'R3')!.current, 4 / 3)
  })
})

describe('chemistry, biology and statistics models', () => {
  it('follows the integrated rate laws', () => {
    near(concentrationAt(1, 0.1, 1, halfLife(1, 0.1, 1)), 0.5)
    near(concentrationAt(2, 0.5, 2, halfLife(2, 0.5, 2)), 1)
    near(concentrationAt(0, 0.1, 1, halfLife(0, 0.1, 1)), 0.5)
  })

  it('fits the activation energy from data', () => {
    const ea = 50000
    const points = [300, 320, 340, 360].map((t) => ({ t, k: 1e7 * Math.exp(-ea / (8.314462618 * t)) }))
    const fit = fitArrhenius(points)!
    near(fit.ea, ea, 1e-3)
    near(fit.r2!, 1, 1e-9)
  })

  it('applies each inhibition type', () => {
    expect(apparentConstants(10, 2, { type: 'competitive', concentration: 1, ki: 1 })).toEqual({ vmax: 10, km: 4 })
    expect(apparentConstants(10, 2, { type: 'noncompetitive', concentration: 1, ki: 1 })).toEqual({ vmax: 5, km: 2 })
    expect(apparentConstants(10, 2, { type: 'uncompetitive', concentration: 1, ki: 1 })).toEqual({ vmax: 5, km: 1 })
  })

  it('grows populations', () => {
    near(populationAt('exponential', 100, Math.LN2, 1), 200)
    const facts = populationFacts('logistic', 10, 0.5, 1000)
    near(populationAt('logistic', 10, 0.5, facts.inflectionTime!, 1000), 500, 1e-6)
    near(facts.maxGrowthRate!, 125)
  })

  it('fits a regression line with bands and a p-value', () => {
    const fit = linearFit([
      { x: 1, y: 2.1 },
      { x: 2, y: 3.9 },
      { x: 3, y: 6.2 },
      { x: 4, y: 7.8 },
      { x: 5, y: 10.1 },
    ])!
    near(fit.slope, 1.99, 1e-9)
    expect(fit.r2).toBeGreaterThan(0.99)
    expect(slopePValue(fit)!).toBeLessThan(0.001)
    const bands = regressionBands(fit, 3)
    expect(bands.prediction).toBeGreaterThan(bands.confidence)
  })

  it('builds t and z confidence intervals', () => {
    const t = confidenceInterval(50, 10, 25, 0.95, false)
    near(t.critical, 2.064, 2e-3)
    near(t.margin, 4.128, 5e-3)
    const z = confidenceInterval(50, 10, 25, 0.95, true)
    near(z.critical, 1.96, 2e-3)
  })
})

describe('algorithms', () => {
  it('sorts with every algorithm and counts the work', () => {
    const input = [5, 2, 9, 1, 5, 6]
    for (const algorithm of ['bubble', 'insertion', 'selection', 'merge', 'quick'] as const) {
      const frames = sortFrames(algorithm, input)
      expect(frames.at(-1)!.values, algorithm).toEqual([1, 2, 5, 5, 6, 9])
      expect(frames.at(-1)!.sorted).toHaveLength(6)
    }
    // Bubble sort on sorted input stops after one pass: n − 1 comparisons.
    expect(sortFrames('bubble', [1, 2, 3, 4]).at(-1)!.comparisons).toBe(3)
  })

  it('builds a BST with its traversals', () => {
    const bst = buildBst([50, 30, 70, 20, 40, 60, 80, 30])
    expect(bst.inorder).toEqual([20, 30, 40, 50, 60, 70, 80])
    expect(bst.preorder).toEqual([50, 30, 20, 40, 70, 60, 80])
    expect(bst.postorder).toEqual([20, 40, 30, 60, 80, 70, 50])
    expect(bst.levelOrder).toEqual([50, 30, 70, 20, 40, 60, 80])
    expect(bst.height).toBe(2)
    expect(bst.duplicates).toEqual([30])
  })
})
