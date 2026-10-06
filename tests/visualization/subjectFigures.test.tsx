import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import {
  looksLikeAlgorithmText,
  looksLikeCalculusFigureText,
  looksLikeFormulaText,
  looksLikePhysicsFigureText,
} from '@/entities/tutorVisualization/graphable'
import type { TutorVisualization } from '@/entities/tutorVisualization/types'
import type { Subject } from '@/entities/project/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'

function one(draft: Record<string, unknown>): TutorVisualization | string {
  const result = normalizeVisualizations({ visualizations: [draft] })
  return result.visualizations[0] ?? result.rejected[0]!.reason
}

function draw(draft: Record<string, unknown>) {
  const value = one(draft)
  if (typeof value === 'string') throw new Error(value)
  return render(<TutorVisualizationFigure visualization={value} />)
}

describe('formula explorer', () => {
  const oscillator = {
    type: 'formula_2d',
    variable: 't',
    curves: [{ expression: 'x(t) = A*cos(omega*t + phi)' }],
    params: [
      { name: 'A', value: 2, min: 0.5, max: 5, unit: 'm' },
      { name: 'omega', value: 3, min: 1, max: 10 },
      { name: 'phi', value: 0, min: -3.14, max: 3.14 },
    ],
    domain: { min: 0, max: 10 },
  }

  it('accepts a formula that uses only its parameters', () => {
    expect(one(oscillator)).toMatchObject({ type: 'formula_2d', variable: 't', params: [{ name: 'A' }, { name: 'omega' }, { name: 'phi' }] })
    expect(one({ ...oscillator, curves: [{ expression: 'A*cos(w*t)' }] })).toBe('invalid-formula-expression')
    expect(one({ ...oscillator, params: [{ name: 'pi', value: 1, min: 0, max: 2 }] })).toBe('invalid-formula-parameter')
    expect(one({ ...oscillator, curves: [{ expression: 'sqrt(-1 - t^2)' }] })).toBe('formula-not-drawable')
  })

  it('lets the student move the sliders and reset', () => {
    draw(oscillator)
    const slider = screen.getAllByRole('slider')[0]!
    fireEvent.change(slider, { target: { value: '4' } })
    expect(screen.getByText('Dashed: the curve with the lesson’s values.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText(/Drag a slider/)).toBeInTheDocument()
  })
})

describe('calculus figures', () => {
  it('shows the tangent slope from the symbolic derivative', () => {
    draw({ type: 'tangent_2d', expression: 'x^2', domain: { min: -3, max: 3 }, point: 1 })
    expect(screen.getByText("f′(1) = 2")).toBeInTheDocument()
  })

  it('shows a Riemann sum against the integral and switches rules', () => {
    draw({ type: 'riemann_2d', expression: 'x^2', a: 0, b: 3, n: 3, method: 'left' })
    expect(screen.getByText('Sum (n = 3) = 5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Right' }))
    expect(screen.getByText('Sum (n = 3) = 14')).toBeInTheDocument()
  })

  it('builds the Taylor polynomial of the chosen order', () => {
    draw({ type: 'taylor_2d', expression: 'exp(x)', center: 0, order: 2, domain: { min: -2, max: 2 } })
    expect(screen.getByText(/1 \+ x \+ 0\.5x\^2/)).toBeInTheDocument()
    expect(one({ type: 'taylor_2d', expression: 'abs(x)', center: 0, domain: { min: -1, max: 1 } })).toBe('taylor-not-differentiable')
  })
})

describe('physics figures', () => {
  it('draws forces and finds equilibrium on an incline', () => {
    draw({
      type: 'forces_2d',
      forces: [
        { label: 'mg', magnitude: 20, angle: 270 },
        { label: 'N', magnitude: 17.32, angle: 120 },
        { label: 'f', magnitude: 10, angle: 30 },
      ],
      incline: 30,
      mass: 2,
    })
    expect(screen.getByText('Net force 0 — the body is in equilibrium.')).toBeInTheDocument()
  })

  it('computes motion facts', () => {
    draw({ type: 'motion_2d', x0: 0, v0: 10, segments: [{ duration: 4, acceleration: -5 }] })
    expect(screen.getByText('Displacement 0 m')).toBeInTheDocument()
    expect(screen.getByText('Distance 20 m')).toBeInTheDocument()
  })

  it('solves a lens and responds to the object-distance slider', () => {
    draw({ type: 'optics_2d', element: 'converging_lens', focalLength: 10, objectDistance: 30, objectHeight: 2 })
    expect(screen.getByText(/real、inverted、reduced|real, inverted, reduced/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } })
    expect(screen.getByText(/virtual, upright, enlarged/)).toBeInTheDocument()
  })

  it('solves a series–parallel circuit', () => {
    draw({
      type: 'circuit_2d',
      voltage: 12,
      network: {
        kind: 'series',
        items: [
          { kind: 'resistor', label: 'R1', resistance: 4 },
          { kind: 'parallel', items: [{ kind: 'resistor', label: 'R2', resistance: 6 }, { kind: 'resistor', label: 'R3', resistance: 3 }] },
        ],
      },
    })
    expect(screen.getByRole('table', { name: /Voltage, current and power/ })).toBeInTheDocument()
    expect(screen.getByText('I = 2 A')).toBeInTheDocument()
    expect(one({ type: 'circuit_2d', voltage: 12, network: { kind: 'series', items: [{ kind: 'resistor', resistance: -1 }] } })).toBe('invalid-circuit')
  })
})

describe('statistics, chemistry and biology figures', () => {
  it('fits a regression line', () => {
    draw({ type: 'regression_2d', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6.1 }, { x: 4, y: 7.9 }] })
    expect(screen.getByText(/R² = 0\.99/)).toBeInTheDocument()
    expect(one({ type: 'regression_2d', points: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }] })).toBe('regression-constant-x')
  })

  it('builds a t interval', () => {
    draw({ type: 'confidence_interval_2d', mean: 50, sd: 10, n: 25, level: 0.95 })
    expect(screen.getByText(/95% CI: \[45\.87\d*, 54\.12\d*\]/)).toBeInTheDocument()
  })

  it('shows half-life and the linearised plot', () => {
    draw({ type: 'kinetics_2d', order: 1, k: 0.1, a0: 1 })
    expect(screen.getAllByText(/6\.931/).length).toBeGreaterThan(0)
    expect(screen.getByText(/ln\[A\] = ln\[A\]₀ − kt/)).toBeInTheDocument()
  })

  it('fits Ea from (T, k) data', () => {
    const points = [300, 320, 340].map((t) => ({ t, k: 1e7 * Math.exp(-50000 / (8.314462618 * t)) }))
    draw({ type: 'arrhenius_2d', points })
    expect(screen.getByText(/= 50 kJ\/mol/)).toBeInTheDocument()
  })

  it('applies a competitive inhibitor', () => {
    draw({ type: 'enzyme_2d', vmax: 10, km: 2, inhibitor: { type: 'competitive', concentration: 1, ki: 1 } })
    expect(screen.getByText('Competitive inhibition: Km rises, Vmax unchanged')).toBeInTheDocument()
  })

  it('marks the logistic inflection point', () => {
    draw({ type: 'population_2d', model: 'logistic', n0: 10, r: 0.5, k: 1000 })
    expect(screen.getByText('maximum rate rK/4 = 125')).toBeInTheDocument()
    expect(one({ type: 'population_2d', model: 'logistic', n0: 10, r: 0.5 })).toBe('invalid-population-capacity')
  })
})

describe('algorithm figures', () => {
  it('steps through a sort', () => {
    draw({ type: 'sorting_2d', algorithm: 'bubble', values: [3, 1, 2] })
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(screen.getByText('Compare positions 1 and 0')).toBeInTheDocument()
    expect(one({ type: 'sorting_2d', algorithm: 'bogo', values: [1, 2] })).toBe('invalid-sorting-setup')
  })

  it('lists BST traversals', () => {
    draw({ type: 'bst_2d', keys: [50, 30, 70, 20, 40] })
    expect(screen.getByText('20, 30, 40, 50, 70')).toBeInTheDocument()
    expect(screen.getByText('50, 30, 20, 40, 70')).toBeInTheDocument()
  })
})

describe('prompt families and gates', () => {
  const prompt = (subject: Subject) => prompts.visualizationGenerator.buildSystemPrompt({ subject })

  it('sends each family only to its subjects', () => {
    expect(prompt('physics')).toContain('forces_2d')
    expect(prompt('physics')).not.toContain('sorting_2d')
    expect(prompt('calculus')).toContain('taylor_2d')
    expect(prompt('calculus')).not.toContain('optics_2d')
    expect(prompt('cs')).toContain('bst_2d')
    expect(prompt('chemistry')).toContain('arrhenius_2d')
    expect(prompt('biology')).toContain('population_2d')
    expect(prompt('stats')).toContain('regression_2d')
    for (const subject of ['physics', 'calculus', 'cs', 'linear_algebra'] as const) expect(prompt(subject)).toContain('formula_2d')
  })

  it('recognises lessons worth a figure', () => {
    expect(looksLikePhysicsFigureText('物体放在倾角为 30° 的斜面上，受重力、支持力和摩擦力')).toBe(true)
    expect(looksLikeCalculusFigureText('用黎曼和逼近定积分')).toBe(true)
    expect(looksLikeAlgorithmText('Trace quicksort on the array')).toBe(true)
    expect(looksLikeFormulaText('简谐振动 $x(t) = A\\cos(\\omega t + \\varphi)$')).toBe(true)
    expect(looksLikeFormulaText('只有文字，没有公式')).toBe(false)
  })
})
