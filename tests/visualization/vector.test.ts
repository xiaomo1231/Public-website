import { describe, expect, it } from 'vitest'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION } from '@/entities/tutorVisualization/types'
import type { VectorsVisualization } from '@/entities/tutorVisualization/types'
import {
  addVectors,
  approxEqualVector,
  computeVectorViewport,
  cross2,
  isCollinear,
  isZeroVector,
  scaleVector,
  spanCoefficients,
  vectorEnd,
  vectorStart,
} from '@/entities/tutorVisualization/vector'
import { VISUALIZATION_LIMITS } from '@/entities/tutorVisualization/limits'

function vectorsViz(draft: unknown): VectorsVisualization {
  const viz = normalizeVisualizations([draft]).visualizations[0]
  if (viz?.type !== 'vectors_2d') throw new Error('expected vectors_2d')
  return viz
}

describe('vector maths', () => {
  it('computes endpoints locally from start + components', () => {
    expect(vectorEnd({ id: 'v', x: 2, y: 3 })).toEqual({ x: 2, y: 3 })
    expect(vectorEnd({ id: 'v', x: 2, y: 3, start: { x: 1, y: 1 } })).toEqual({ x: 3, y: 4 })
    expect(vectorStart({ id: 'v', x: 2, y: 3 })).toEqual({ x: 0, y: 0 })
  })

  it('adds, scales and compares vectors', () => {
    expect(addVectors({ x: 1, y: 2 }, { x: 3, y: -1 })).toEqual({ x: 4, y: 1 })
    expect(scaleVector({ x: 2, y: -3 }, 2)).toEqual({ x: 4, y: -6 })
    expect(approxEqualVector({ x: 1, y: 2 }, { x: 1.0000001, y: 2 })).toBe(true)
    expect(approxEqualVector({ x: 1, y: 2 }, { x: 1.1, y: 2 })).toBe(false)
  })

  it('detects zero and collinear vectors', () => {
    expect(isZeroVector({ x: 0, y: 0 })).toBe(true)
    expect(isZeroVector({ x: 1, y: 0 })).toBe(false)
    expect(cross2({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1)
    expect(isCollinear({ x: 1, y: 2 }, { x: 2, y: 4 })).toBe(true)
    expect(isCollinear({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false)
  })

  it('solves and rejects a span', () => {
    expect(spanCoefficients({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 3, y: 2 })).toEqual({ s: 3, t: 2 })
    expect(spanCoefficients({ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 2 })).toBeNull()
  })

  it('computes a viewport containing the origin and every endpoint', () => {
    const viewport = computeVectorViewport([
      { id: 'a', x: 5, y: 2 },
      { id: 'b', x: -3, y: 4, start: { x: 1, y: 1 } },
    ])
    expect(viewport.xMin).toBeLessThanOrEqual(-3)
    expect(viewport.xMax).toBeGreaterThanOrEqual(5)
    expect(viewport.yMin).toBeLessThanOrEqual(0)
    expect(viewport.yMax).toBeGreaterThanOrEqual(4)
    expect(viewport.xMin).toBeLessThan(0)
    expect(viewport.xMax).toBeGreaterThan(0)
  })
})

describe('normalizeVisualizations — vectors_2d', () => {
  it('accepts components, labels, roles and the operation', () => {
    const viz = vectorsViz({
      type: 'vectors_2d',
      caption: 'Two vectors',
      operation: 'display',
      vectors: [
        { x: 2, y: 1, label: 'v' },
        { x: 1, y: 3, label: 'w', role: 'basis', highlighted: true },
      ],
    })
    expect(viz.schemaVersion).toBe(TUTOR_VISUALIZATION_SCHEMA_VERSION)
    expect(viz.operation).toBe('display')
    expect(viz.vectors).toHaveLength(2)
    expect(viz.vectors[0]).toMatchObject({ x: 2, y: 1, label: 'v' })
    expect(viz.vectors[1]).toMatchObject({ x: 1, y: 3, role: 'basis', highlighted: true })
  })

  it('drops non-finite components and starts', () => {
    const viz = vectorsViz({
      type: 'vectors_2d',
      vectors: [
        { x: Number.NaN, y: 1 },
        { x: 1, y: 2, start: { x: Number.POSITIVE_INFINITY, y: 0 } },
        { x: 3, y: 4 },
      ],
    })
    expect(viz.vectors).toHaveLength(1)
    expect(viz.vectors[0]).toMatchObject({ x: 3, y: 4 })
  })

  it('drops zero-length vectors and rejects an all-zero diagram', () => {
    const viz = vectorsViz({
      type: 'vectors_2d',
      vectors: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    })
    expect(viz.vectors).toHaveLength(1)

    const rejected = normalizeVisualizations([
      { type: 'vectors_2d', vectors: [{ x: 0, y: 0 }] },
    ])
    expect(rejected.visualizations).toHaveLength(0)
    expect(rejected.rejected[0]?.reason).toBe('no-valid-vectors')
  })

  it('caps the vector count and sanitizes labels', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ x: i + 1, y: 1 }))
    expect(vectorsViz({ type: 'vectors_2d', vectors: many }).vectors).toHaveLength(
      VISUALIZATION_LIMITS.maxVectors,
    )
    const viz = vectorsViz({
      type: 'vectors_2d',
      vectors: [{ x: 1, y: 1, label: 'x'.repeat(120) }],
    })
    expect(viz.vectors[0]?.label?.length).toBeLessThanOrEqual(VISUALIZATION_LIMITS.maxLabelLength)
  })

  it('falls back to the display operation for an unknown value', () => {
    expect(vectorsViz({ type: 'vectors_2d', operation: 'rotate', vectors: [{ x: 1, y: 0 }] }).operation).toBe(
      'display',
    )
  })

  it('re-derives a wrong addition result locally', () => {
    const viz = vectorsViz({
      type: 'vectors_2d',
      operation: 'addition',
      vectors: [
        { x: 1, y: 0, role: 'vector' },
        { x: 0, y: 1, role: 'vector' },
        { x: 5, y: 5, role: 'result' },
      ],
    })
    const result = viz.vectors.find((vector) => vector.role === 'result')
    expect(result).toMatchObject({ x: 1, y: 1 })
  })

  it('keeps a correct addition result', () => {
    const viz = vectorsViz({
      type: 'vectors_2d',
      operation: 'addition',
      vectors: [
        { x: 2, y: 3, role: 'vector' },
        { x: -1, y: 2, role: 'vector' },
        { x: 1, y: 5, role: 'result' },
      ],
    })
    expect(viz.vectors.find((vector) => vector.role === 'result')).toMatchObject({ x: 1, y: 5 })
  })

  it('drops a non-collinear scalar-multiplication result', () => {
    const viz = vectorsViz({
      type: 'vectors_2d',
      operation: 'scalar_multiplication',
      vectors: [
        { x: 1, y: 0, role: 'vector' },
        { x: 0, y: 1, role: 'result' },
      ],
    })
    expect(viz.vectors).toHaveLength(1)
  })

  it('verifies a linear-combination result against the basis span', () => {
    const valid = vectorsViz({
      type: 'vectors_2d',
      operation: 'linear_combination',
      vectors: [
        { x: 1, y: 0, role: 'basis' },
        { x: 0, y: 1, role: 'basis' },
        { x: 3, y: 2, role: 'result' },
      ],
    })
    expect(valid.vectors).toHaveLength(3)

    const dependent = vectorsViz({
      type: 'vectors_2d',
      operation: 'linear_combination',
      vectors: [
        { x: 1, y: 0, role: 'basis' },
        { x: 2, y: 0, role: 'basis' },
        { x: 3, y: 2, role: 'result' },
      ],
    })
    expect(dependent.vectors).toHaveLength(2)
  })

  it('keeps a stable input order', () => {
    const viz = vectorsViz({
      type: 'vectors_2d',
      vectors: [
        { x: 3, y: 0, label: 'a' },
        { x: 2, y: 0, label: 'b' },
        { x: 1, y: 0, label: 'c' },
      ],
    })
    expect(viz.vectors.map((vector) => vector.label)).toEqual(['a', 'b', 'c'])
  })
})
