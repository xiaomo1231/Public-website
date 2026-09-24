import { describe, expect, it } from 'vitest'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import {
  applyVennOperation,
  computeVennRegions,
  dedupeElements,
} from '@/entities/tutorVisualization/setOperations'
import type { VennSet, VennVisualization } from '@/entities/tutorVisualization/types'
import { VISUALIZATION_LIMITS } from '@/entities/tutorVisualization/limits'

const A: VennSet = { id: 'a', label: 'A', elements: ['1', '2', '3'] }
const B: VennSet = { id: 'b', label: 'B', elements: ['3', '4', '5'] }

function vennViz(draft: unknown): VennVisualization {
  const viz = normalizeVisualizations([draft]).visualizations[0]
  if (viz?.type !== 'venn_2d') throw new Error('expected venn_2d')
  return viz
}

describe('venn set maths', () => {
  it('splits two sets into disjoint regions', () => {
    const regions = computeVennRegions([A, B])
    expect(regions.A).toEqual(['1', '2'])
    expect(regions.AB).toEqual(['3'])
    expect(regions.B).toEqual(['4', '5'])
  })

  it('computes union, intersection, difference and symmetric difference', () => {
    const regions = computeVennRegions([A, B])
    // Result order is the deterministic region order: A, then B, then A∩B.
    expect(applyVennOperation('union', [A, B], regions, ['a', 'b']).result).toEqual([
      '1',
      '2',
      '4',
      '5',
      '3',
    ])
    expect(applyVennOperation('intersection', [A, B], regions, ['a', 'b']).result).toEqual(['3'])
    expect(applyVennOperation('difference', [A, B], regions, ['a', 'b']).result).toEqual(['1', '2'])
    expect(
      applyVennOperation('symmetric_difference', [A, B], regions, ['a', 'b']).result,
    ).toEqual(['1', '2', '4', '5'])
  })

  it('computes a complement within a universe', () => {
    const universe = ['1', '2', '3', '4', '5', '6']
    const regions = computeVennRegions([A, B], universe)
    expect(regions.outside).toEqual(['6'])
    expect(applyVennOperation('complement', [A, B], regions, ['a']).result).toEqual([
      '4',
      '5',
      '6',
    ])
  })

  it('splits three sets into seven regions plus outside', () => {
    const C: VennSet = { id: 'c', label: 'C', elements: ['3', '5', '7'] }
    const regions = computeVennRegions([A, B, C])
    expect(regions.A).toEqual(['1', '2'])
    expect(regions.AB).toEqual([])
    expect(regions.ABC).toEqual(['3'])
    expect(regions.BC).toEqual(['5'])
    expect(regions.C).toEqual(['7'])
  })

  it('dedupes deterministically preserving first occurrence', () => {
    expect(dedupeElements(['b', 'a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('keeps region order stable', () => {
    const regions = computeVennRegions([A, B])
    expect(applyVennOperation('union', [A, B], regions, ['a', 'b']).result).toEqual(
      applyVennOperation('union', [A, B], regions, ['a', 'b']).result,
    )
  })
})

describe('normalizeVisualizations — venn_2d', () => {
  it('accepts two sets and an operation', () => {
    const viz = vennViz({
      type: 'venn_2d',
      operation: 'intersection',
      operands: ['a', 'b'],
      sets: [
        { id: 'a', label: 'A', elements: ['1', '2', '3'] },
        { id: 'b', label: 'B', elements: ['3', '4', '5'] },
      ],
    })
    expect(viz.sets).toHaveLength(2)
    expect(viz.operation).toBe('intersection')
    expect(viz.operands).toEqual(['a', 'b'])
  })

  it('rejects fewer than two sets', () => {
    const result = normalizeVisualizations([
      { type: 'venn_2d', operation: 'union', sets: [{ id: 'a', label: 'A', elements: ['1'] }] },
    ])
    expect(result.visualizations).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('too-few-sets')
  })

  it('rejects a complement without a universe', () => {
    const result = normalizeVisualizations([
      {
        type: 'venn_2d',
        operation: 'complement',
        sets: [
          { id: 'a', label: 'A', elements: ['1'] },
          { id: 'b', label: 'B', elements: ['2'] },
        ],
      },
    ])
    expect(result.visualizations).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('complement-needs-universe')
  })

  it('drops unknown operands and defaults to every set', () => {
    const viz = vennViz({
      type: 'venn_2d',
      operation: 'union',
      operands: ['missing'],
      sets: [
        { id: 'a', label: 'A', elements: ['1'] },
        { id: 'b', label: 'B', elements: ['2'] },
      ],
    })
    expect(viz.operands).toEqual(['a', 'b'])
  })

  it('dedupes elements, caps counts and sanitizes labels', () => {
    const viz = vennViz({
      type: 'venn_2d',
      operation: 'display',
      sets: [
        { id: 'a', label: 'x'.repeat(120), elements: ['1', '1', '2', '3'] },
        { id: 'b', label: 'B', elements: Array.from({ length: 30 }, (_, i) => String(i)) },
      ],
    })
    expect(viz.sets[0]?.elements).toEqual(['1', '2', '3'])
    expect(viz.sets[0]?.label.length).toBeLessThanOrEqual(VISUALIZATION_LIMITS.maxLabelLength)
    expect(viz.sets[1]?.elements.length).toBeLessThanOrEqual(VISUALIZATION_LIMITS.maxSetElements)
  })

  it('drops prototype-polluting set ids', () => {
    const viz = vennViz({
      type: 'venn_2d',
      operation: 'union',
      sets: [
        { id: '__proto__', label: 'bad', elements: ['x'] },
        { id: 'a', label: 'A', elements: ['1'] },
        { id: 'b', label: 'B', elements: ['2'] },
      ],
    })
    expect(viz.sets.map((set) => set.id)).toEqual(['a', 'b'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('treats injected elements as inert plain text', () => {
    const viz = vennViz({
      type: 'venn_2d',
      operation: 'display',
      sets: [
        { id: 'a', label: 'A', elements: ['<script>window.__pwned = true</script>'] },
        { id: 'b', label: 'B', elements: ['2'] },
      ],
    })
    expect(typeof viz.sets[0]?.elements[0]).toBe('string')
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})
