import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  cdf,
  density,
  intervalLabel,
  intervalProbability,
  moments,
  validateParams,
  type DistributionParams,
} from '@/entities/tutorVisualization/distribution'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import { hasGraphableMath } from '@/entities/tutorVisualization/graphable'
import type { DistributionVisualization } from '@/entities/tutorVisualization/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'

const close = (a: number, b: number, eps = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('distribution maths', () => {
  const standard: DistributionParams = { family: 'normal', mu: 0, sigma: 1 }

  it('matches known normal probabilities', () => {
    close(cdf(standard, 0), 0.5)
    close(intervalProbability(standard, { from: -1, to: 1 }), 0.6827)
    close(intervalProbability(standard, { from: -1.96, to: 1.96 }), 0.95)
    close(intervalProbability(standard, { from: 2 }), 0.02275)
  })

  it('sums discrete masses inclusively', () => {
    const binomial: DistributionParams = { family: 'binomial', n: 10, p: 0.5 }
    close(density(binomial, 5), 0.24609)
    close(intervalProbability(binomial, { from: 4, to: 6 }), 0.65625)
    close(intervalProbability(binomial, {}), 1)
    const poisson: DistributionParams = { family: 'poisson', lambda: 2 }
    close(density(poisson, 0), Math.exp(-2))
    close(intervalProbability(poisson, { to: 1 }), 3 * Math.exp(-2))
  })

  it('handles the continuous closed forms', () => {
    close(intervalProbability({ family: 'uniform', a: 0, b: 4 }, { from: 1, to: 2 }), 0.25)
    close(intervalProbability({ family: 'exponential', lambda: 0.5 }, { to: 2 }), 1 - Math.exp(-1))
  })

  it('computes mean and variance locally', () => {
    const binomial = moments({ family: 'binomial', n: 10, p: 0.3 })
    close(binomial.mean, 3)
    close(binomial.variance, 2.1)
    expect(moments({ family: 'exponential', lambda: 2 })).toEqual({ mean: 0.5, variance: 0.25 })
  })

  it('rejects parameters that do not define a distribution', () => {
    expect(validateParams('normal', { mu: 0, sigma: 0 })).toBeNull()
    expect(validateParams('binomial', { n: 2.5, p: 0.5 })).toBeNull()
    expect(validateParams('binomial', { n: 500, p: 0.5 })).toBeNull()
    expect(validateParams('binomial', { n: 10, p: 1.2 })).toBeNull()
    expect(validateParams('uniform', { a: 3, b: 1 })).toBeNull()
    expect(validateParams('poisson', { lambda: '2' })).toBeNull()
  })

  it('labels the interval the way it is written in class', () => {
    expect(intervalLabel({ from: -1, to: 1 })).toBe('P(-1 ≤ X ≤ 1)')
    expect(intervalLabel({ from: 3 })).toBe('P(X ≥ 3)')
    expect(intervalLabel({ to: 2 })).toBe('P(X ≤ 2)')
    expect(intervalLabel({ from: 2, to: 2 })).toBe('P(X = 2)')
    expect(intervalLabel(undefined)).toBeNull()
  })
})

describe('distribution_2d normalisation', () => {
  it('keeps a valid distribution and ignores model-supplied numbers', () => {
    const { visualizations, rejected } = normalizeVisualizations({
      visualizations: [
        {
          type: 'distribution_2d',
          family: 'normal',
          params: { mu: 0, sigma: 1, probability: 0.99 },
          interval: { from: 1, to: -1 },
          caption: 'Standard normal',
        },
      ],
    })
    expect(rejected).toEqual([])
    const viz = visualizations[0] as DistributionVisualization
    expect(viz.params).toEqual({ family: 'normal', mu: 0, sigma: 1 })
    // A reversed interval is put in order.
    expect(viz.interval).toEqual({ from: -1, to: 1 })
  })

  it('snaps a discrete interval to whole numbers', () => {
    const { visualizations } = normalizeVisualizations([
      { type: 'distribution_2d', family: 'binomial', params: { n: 10, p: 0.4 }, interval: { from: 2.5, to: 6.5 } },
    ])
    expect((visualizations[0] as DistributionVisualization).interval).toEqual({ from: 3, to: 6 })
  })

  it('rejects unknown families and bad parameters', () => {
    const { visualizations, rejected } = normalizeVisualizations([
      { type: 'distribution_2d', family: 'gamma', params: { k: 2 } },
      { type: 'distribution_2d', family: 'normal', params: { mu: 0, sigma: -1 } },
    ])
    expect(visualizations).toEqual([])
    expect(rejected.map((r) => r.reason)).toEqual([
      'unsupported-distribution',
      'invalid-distribution-params',
    ])
  })
})

describe('distribution lessons reach the visualization step', () => {
  it('passes the local gate', () => {
    expect(hasGraphableMath('Let X follow a normal distribution with mean 0.')).toBe(true)
    expect(hasGraphableMath('设随机变量 X 服从二项分布 B(10, 0.3)。')).toBe(true)
    expect(hasGraphableMath('Assume $X \\sim N(0, 1)$.')).toBe(true)
  })

  it('is described in the visualization and lesson prompts', () => {
    expect(prompts.visualizationGenerator.buildSystemPrompt()).toContain('distribution_2d')
    expect(prompts.tutorLesson.buildSystemPrompt()).toContain('Probability distributions')
  })
})

describe('distribution figure', () => {
  it('shows the locally computed facts', () => {
    const visualization: DistributionVisualization = {
      id: 'distribution_2d-0',
      schemaVersion: 6,
      placement: { scope: 'lesson' },
      type: 'distribution_2d',
      params: { family: 'normal', mu: 0, sigma: 1 },
      interval: { from: -1, to: 1 },
    }
    render(<TutorVisualizationFigure visualization={visualization} />)
    expect(screen.getByRole('img', { name: /N\(μ = 0, σ = 1\)/ })).toBeInTheDocument()
    expect(screen.getByText('P(-1 ≤ X ≤ 1) = 0.6827')).toBeInTheDocument()
    expect(screen.getByText('Mean 0')).toBeInTheDocument()
    expect(screen.getByText('Variance 1')).toBeInTheDocument()
  })
})
