import { describe, expect, it } from 'vitest'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import {
  applyMatrix,
  computeTransform,
  computeTransformViewport,
  determinant,
} from '@/entities/tutorVisualization/transform'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION } from '@/entities/tutorVisualization/types'
import type { TransformVisualization } from '@/entities/tutorVisualization/types'
import { VISUALIZATION_LIMITS } from '@/entities/tutorVisualization/limits'

function transformViz(draft: unknown): TransformVisualization {
  const viz = normalizeVisualizations([draft]).visualizations[0]
  if (viz?.type !== 'transform_2d') throw new Error('expected transform_2d')
  return viz
}

describe('transform maths', () => {
  it('applies a matrix and computes the determinant', () => {
    expect(applyMatrix({ a: 2, b: 0, c: 0, d: 1 }, { x: 1, y: 1 })).toEqual({ x: 2, y: 1 })
    expect(determinant({ a: 2, b: 0, c: 0, d: 1 })).toBe(2)
    expect(determinant({ a: 0, b: 1, c: 1, d: 0 })).toBe(-1)
    expect(determinant({ a: 1, b: 0, c: 0, d: 0 })).toBe(0)
  })

  it('computes the basis, unit square, area and orientation', () => {
    const transform = computeTransform({ a: 2, b: 0, c: 0, d: 1 }, [{ id: 'v0', x: 1, y: 1 }])
    expect(transform.determinant).toBe(2)
    expect(transform.areaScale).toBe(2)
    expect(transform.orientationFlipped).toBe(false)
    expect(transform.degenerate).toBe(false)
    expect(transform.basis[0]?.transformed).toEqual({ x: 2, y: 0 })
    expect(transform.basis[1]?.transformed).toEqual({ x: 0, y: 1 })
    expect(transform.transformedSquare).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ])
    expect(transform.vectors[0]?.transformed).toEqual({ x: 2, y: 1 })
  })

  it('flags a reflection and a degenerate transformation', () => {
    expect(computeTransform({ a: 0, b: 1, c: 1, d: 0 }, []).orientationFlipped).toBe(true)
    const degenerate = computeTransform({ a: 1, b: 0, c: 0, d: 0 }, [])
    expect(degenerate.degenerate).toBe(true)
    expect(degenerate.areaScale).toBe(0)
  })

  it('computes a viewport containing the origin and both squares', () => {
    const viewport = computeTransformViewport({ a: 2, b: 0, c: 0, d: 1 }, [{ id: 'v', x: 1, y: 1 }])
    expect(viewport.xMin).toBeLessThanOrEqual(0)
    expect(viewport.xMax).toBeGreaterThanOrEqual(2)
    expect(viewport.yMin).toBeLessThanOrEqual(0)
    expect(viewport.yMax).toBeGreaterThanOrEqual(1)
  })

  it('is deterministic', () => {
    const matrix = { a: 1, b: 2, c: 3, d: 4 }
    expect(computeTransform(matrix, [{ id: 'v', x: 1, y: 2 }])).toEqual(
      computeTransform(matrix, [{ id: 'v', x: 1, y: 2 }]),
    )
  })
})

describe('normalizeVisualizations — transform_2d', () => {
  it('accepts a matrix and vectors with default flags', () => {
    const viz = transformViz({
      type: 'transform_2d',
      matrix: { a: 2, b: 0, c: 0, d: 1 },
      vectors: [{ x: 1, y: 1, label: 'v' }],
    })
    expect(viz.schemaVersion).toBe(TUTOR_VISUALIZATION_SCHEMA_VERSION)
    expect(viz.matrix).toEqual({ a: 2, b: 0, c: 0, d: 1 })
    expect(viz.vectors[0]).toMatchObject({ x: 1, y: 1, label: 'v' })
    expect(viz.showBasis).toBe(true)
    expect(viz.showUnitSquare).toBe(true)
    expect(viz.showGrid).toBe(true)
    expect(viz.showArea).toBe(true)
  })

  it('rejects a missing or non-finite matrix', () => {
    expect(normalizeVisualizations([{ type: 'transform_2d' }]).visualizations).toHaveLength(0)
    expect(
      normalizeVisualizations([
        { type: 'transform_2d', matrix: { a: Number.NaN, b: 0, c: 0, d: 1 } },
      ]).visualizations,
    ).toHaveLength(0)
  })

  it('rejects an out-of-range matrix', () => {
    const result = normalizeVisualizations([
      { type: 'transform_2d', matrix: { a: 1e6, b: 0, c: 0, d: 1 } },
    ])
    expect(result.visualizations).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('matrix-out-of-range')
  })

  it('caps the vector count and drops non-finite vectors', () => {
    const vectors = Array.from({ length: 10 }, (_, index) => ({ x: index + 1, y: 1 }))
    const viz = transformViz({ type: 'transform_2d', matrix: { a: 1, b: 0, c: 0, d: 1 }, vectors })
    expect(viz.vectors).toHaveLength(VISUALIZATION_LIMITS.maxTransformVectors)

    const filtered = transformViz({
      type: 'transform_2d',
      matrix: { a: 1, b: 0, c: 0, d: 1 },
      vectors: [{ x: Number.NaN, y: 1 }, { x: 1, y: 1 }],
    })
    expect(filtered.vectors).toHaveLength(1)
  })

  it('accepts a degenerate transformation', () => {
    const viz = transformViz({ type: 'transform_2d', matrix: { a: 1, b: 0, c: 0, d: 0 } })
    expect(viz.matrix).toEqual({ a: 1, b: 0, c: 0, d: 0 })
    expect(viz.vectors).toHaveLength(0)
  })

  it('defaults an invalid flag to true and honours false', () => {
    expect(
      transformViz({ type: 'transform_2d', matrix: { a: 1, b: 0, c: 0, d: 1 }, showGrid: 'no' })
        .showGrid,
    ).toBe(true)
    expect(
      transformViz({ type: 'transform_2d', matrix: { a: 1, b: 0, c: 0, d: 1 }, showGrid: false })
        .showGrid,
    ).toBe(false)
  })
})
