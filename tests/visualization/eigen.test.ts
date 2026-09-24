import { describe, expect, it } from 'vitest'
import {
  computeEigenViewport,
  matchEigenCandidate,
  solveEigen,
  verifyEigenPair,
} from '@/entities/tutorVisualization/eigen'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION } from '@/entities/tutorVisualization/types'
import type { Eigen2DVisualization } from '@/entities/tutorVisualization/types'
import { VISUALIZATION_LIMITS } from '@/entities/tutorVisualization/limits'

function eigenViz(draft: unknown): Eigen2DVisualization {
  const viz = normalizeVisualizations([draft]).visualizations[0]
  if (viz?.type !== 'eigen_2d') throw new Error('expected eigen_2d')
  return viz
}

describe('solveEigen — 2×2 real matrices', () => {
  it('solves two distinct positive eigenvalues', () => {
    const result = solveEigen({ a: 2, b: 1, c: 1, d: 2 })
    if (!result.ok) throw new Error('expected a solution')
    expect(result.pairs.map((pair) => pair.value)).toEqual([3, 1])
    expect(result.defective).toBe(false)
    expect(result.fullEigenspace).toBe(false)
    // Eigenvectors are unit length and have the expected direction.
    for (const [pair, expected] of [
      [result.pairs[0]!, { x: 1, y: 1 }],
      [result.pairs[1]!, { x: 1, y: -1 }],
    ] as const) {
      expect(Math.hypot(pair.vector.x, pair.vector.y)).toBeCloseTo(1, 12)
      expect(pair.vector.x).toBeCloseTo(expected.x / Math.SQRT2, 12)
      expect(pair.vector.y).toBeCloseTo(expected.y / Math.SQRT2, 12)
      // Av = λv, computed locally.
      expect(pair.transformed.x).toBeCloseTo(pair.value * pair.vector.x, 12)
      expect(pair.transformed.y).toBeCloseTo(pair.value * pair.vector.y, 12)
    }
  })

  it('solves one positive and one negative eigenvalue', () => {
    const result = solveEigen({ a: 0, b: 1, c: 1, d: 0 })
    if (!result.ok) throw new Error('expected a solution')
    expect(result.pairs.map((pair) => pair.value)).toEqual([1, -1])
    expect(result.pairs[1]!.transformed.x).toBeCloseTo(-result.pairs[1]!.vector.x, 12)
  })

  it('handles a zero eigenvalue', () => {
    const result = solveEigen({ a: 0, b: 0, c: 0, d: 1 })
    if (!result.ok) throw new Error('expected a solution')
    const zero = result.pairs.find((pair) => pair.value === 0)!
    expect(zero.transformed).toEqual({ x: 0, y: 0 })
    expect(Math.hypot(zero.vector.x, zero.vector.y)).toBeCloseTo(1, 12)
  })

  it('treats a scalar matrix as the whole plane', () => {
    const identity = solveEigen({ a: 1, b: 0, c: 0, d: 1 })
    if (!identity.ok) throw new Error('expected a solution')
    expect(identity.fullEigenspace).toBe(true)
    expect(identity.defective).toBe(false)
    expect(identity.pairs.map((pair) => pair.value)).toEqual([1, 1])
    expect(identity.pairs.map((pair) => pair.vector)).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ])

    const zero = solveEigen({ a: 0, b: 0, c: 0, d: 0 })
    if (!zero.ok) throw new Error('expected a solution')
    expect(zero.fullEigenspace).toBe(true)
    expect(zero.pairs.every((pair) => pair.value === 0)).toBe(true)
  })

  it('returns a single direction for a defective matrix', () => {
    const result = solveEigen({ a: 2, b: 1, c: 0, d: 2 })
    if (!result.ok) throw new Error('expected a solution')
    expect(result.defective).toBe(true)
    expect(result.fullEigenspace).toBe(false)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]!.value).toBe(2)
    expect(result.pairs[0]!.vector).toEqual({ x: 1, y: 0 })
  })

  it('refuses a matrix with complex eigenvalues', () => {
    const result = solveEigen({ a: 0, b: -1, c: 1, d: 0 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected no solution')
    expect(result.reason).toBe('complex-eigenvalues')
  })

  it('rejects a non-finite or out-of-range matrix', () => {
    const nonFinite = solveEigen({ a: Number.NaN, b: 0, c: 0, d: 1 })
    expect(nonFinite.ok).toBe(false)
    if (!nonFinite.ok) expect(nonFinite.reason).toBe('non-finite')

    const huge = solveEigen({ a: 1e6, b: 0, c: 0, d: 1 })
    expect(huge.ok).toBe(false)
    if (!huge.ok) expect(huge.reason).toBe('out-of-range')
  })

  it('is deterministic and uses a stable sign', () => {
    const matrix = { a: 4, b: 2, c: 1, d: 3 }
    expect(solveEigen(matrix)).toEqual(solveEigen(matrix))
    const first = solveEigen(matrix)
    if (!first.ok) throw new Error('expected a solution')
    // The larger-magnitude component is always made positive.
    for (const pair of first.pairs) {
      expect(pair.vector.x > 0 || (pair.vector.x === 0 && pair.vector.y > 0)).toBe(true)
    }
  })
})

describe('verifyEigenPair & matchEigenCandidate', () => {
  const matrix = { a: 2, b: 1, c: 1, d: 2 }

  it('accepts a true eigenpair and rejects a wrong value or vector', () => {
    expect(verifyEigenPair(matrix, 3, { x: 1, y: 1 })).toBe(true)
    expect(verifyEigenPair(matrix, 3, { x: 1, y: -1 })).toBe(false)
    expect(verifyEigenPair(matrix, 5, { x: 1, y: 1 })).toBe(false)
    expect(verifyEigenPair(matrix, 3, { x: 0, y: 0 })).toBe(false)
    expect(verifyEigenPair(matrix, 3, { x: Number.NaN, y: 1 })).toBe(false)
  })

  it('matches a candidate that is a multiple or the opposite sign', () => {
    const solved = solveEigen(matrix)
    if (!solved.ok) throw new Error('expected a solution')
    expect(matchEigenCandidate({ value: 3, vector: { x: 2, y: 2 } }, solved.pairs)).toBe(0)
    expect(matchEigenCandidate({ value: 3, vector: { x: -1, y: -1 } }, solved.pairs)).toBe(0)
    expect(matchEigenCandidate({ value: 1, vector: { x: 5, y: -5 } }, solved.pairs)).toBe(1)
    expect(matchEigenCandidate({ value: 9, vector: { x: 1, y: 1 } }, solved.pairs)).toBeNull()
    expect(matchEigenCandidate({ value: 3, vector: { x: 0, y: 0 } }, solved.pairs)).toBeNull()
  })
})

describe('computeEigenViewport', () => {
  it('contains the origin, the eigen-directions and their images', () => {
    const solved = solveEigen({ a: 2, b: 1, c: 1, d: 2 })
    if (!solved.ok) throw new Error('expected a solution')
    const viewport = computeEigenViewport(solved.pairs, true)
    expect(viewport.xMin).toBeLessThanOrEqual(-1)
    expect(viewport.xMax).toBeGreaterThanOrEqual(1)
    expect(viewport.yMin).toBeLessThanOrEqual(-1)
    expect(viewport.yMax).toBeGreaterThanOrEqual(1)
    for (const value of Object.values(viewport)) expect(Number.isFinite(value)).toBe(true)
  })
})

describe('normalizeVisualizations — eigen_2d', () => {
  it('computes the eigenpairs locally and stamps the schema version', () => {
    const viz = eigenViz({
      type: 'eigen_2d',
      matrix: { a: 2, b: 1, c: 1, d: 2 },
      eigenpairs: [
        { value: 3, vector: { x: 1, y: 1 }, label: 'v₁' },
        { value: 1, vector: { x: 1, y: -1 }, label: 'v₂' },
      ],
    })
    expect(viz.schemaVersion).toBe(TUTOR_VISUALIZATION_SCHEMA_VERSION)
    expect(viz.matrix).toEqual({ a: 2, b: 1, c: 1, d: 2 })
    expect(viz.eigenpairs.map((pair) => pair.value)).toEqual([3, 1])
    // Candidate labels are attached to the matching local pair.
    expect(viz.eigenpairs[0]?.label).toBe('v₁')
    expect(viz.eigenpairs[1]?.label).toBe('v₂')
    expect(viz.fullEigenspace).toBe(false)
    expect(viz.defective).toBe(false)
    expect(viz.showUnitCircle).toBe(true)
    expect(viz.showTransform).toBe(true)
  })

  it('computes eigenpairs even without AI candidates', () => {
    const viz = eigenViz({ type: 'eigen_2d', matrix: { a: 2, b: 1, c: 1, d: 2 } })
    expect(viz.eigenpairs.map((pair) => pair.value)).toEqual([3, 1])
    expect(viz.eigenpairs.every((pair) => pair.label === undefined)).toBe(true)
  })

  it('never trusts a candidate that disagrees with local maths', () => {
    // A bogus candidate must not become a label; the local result wins.
    const viz = eigenViz({
      type: 'eigen_2d',
      matrix: { a: 2, b: 1, c: 1, d: 2 },
      eigenpairs: [
        { value: 3, vector: { x: 1, y: 1 }, label: 'good' },
        { value: 99, vector: { x: 1, y: 0 }, label: 'bad' },
      ],
    })
    expect(viz.eigenpairs[0]?.label).toBe('good')
    expect(viz.eigenpairs[1]?.label).toBeUndefined()
  })

  it('rejects the diagram when every candidate contradicts the matrix', () => {
    const result = normalizeVisualizations([
      {
        type: 'eigen_2d',
        matrix: { a: 2, b: 1, c: 1, d: 2 },
        eigenpairs: [{ value: 99, vector: { x: 1, y: 0 } }],
      },
    ])
    expect(result.visualizations).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('eigen-candidates-inconsistent')
  })

  it('rejects a matrix with complex eigenvalues', () => {
    const result = normalizeVisualizations([
      { type: 'eigen_2d', matrix: { a: 0, b: -1, c: 1, d: 0 } },
    ])
    expect(result.visualizations).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('complex-eigenvalues')
  })

  it('rejects a missing or out-of-range matrix', () => {
    expect(normalizeVisualizations([{ type: 'eigen_2d' }]).visualizations).toHaveLength(0)
    const result = normalizeVisualizations([
      { type: 'eigen_2d', matrix: { a: 1e6, b: 0, c: 0, d: 1 } },
    ])
    expect(result.visualizations).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('matrix-out-of-range')
  })

  it('accepts a defective and a scalar matrix', () => {
    const defective = eigenViz({ type: 'eigen_2d', matrix: { a: 2, b: 1, c: 0, d: 2 } })
    expect(defective.defective).toBe(true)
    expect(defective.eigenpairs).toHaveLength(1)

    const scalar = eigenViz({ type: 'eigen_2d', matrix: { a: 3, b: 0, c: 0, d: 3 } })
    expect(scalar.fullEigenspace).toBe(true)
    expect(scalar.eigenpairs).toHaveLength(2)
  })

  it('honours the presentation flags', () => {
    const viz = eigenViz({
      type: 'eigen_2d',
      matrix: { a: 2, b: 1, c: 1, d: 2 },
      showUnitCircle: false,
      showTransform: false,
    })
    expect(viz.showUnitCircle).toBe(false)
    expect(viz.showTransform).toBe(false)
  })

  it('caps the number of AI candidates it reads', () => {
    const candidates = Array.from({ length: 10 }, () => ({ value: 3, vector: { x: 1, y: 1 } }))
    const viz = eigenViz({
      type: 'eigen_2d',
      matrix: { a: 2, b: 1, c: 1, d: 2 },
      eigenpairs: candidates,
    })
    expect(viz.eigenpairs).toHaveLength(2)
    expect(VISUALIZATION_LIMITS.maxEigenCandidates).toBeGreaterThan(0)
  })
})
