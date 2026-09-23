import { describe, expect, it } from 'vitest'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION } from '@/entities/tutorVisualization/types'

describe('normalizeVisualizations — valid drafts', () => {
  it('keeps a function graph and stamps schema version + placement', () => {
    const { visualizations } = normalizeVisualizations({
      visualizations: [{ type: 'function_2d', expressions: [{ latex: 'y = 2x + 1' }] }],
    })

    expect(visualizations).toHaveLength(1)
    const viz = visualizations[0]!
    expect(viz.type).toBe('function_2d')
    expect(viz.schemaVersion).toBe(TUTOR_VISUALIZATION_SCHEMA_VERSION)
    expect(viz.placement).toEqual({ scope: 'lesson' })
    expect(viz.id).toBe('function_2d-0')
  })

  it('keeps every expression of a system so they share one plane', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'equation_2d',
        expressions: [{ latex: 'x + y = 6' }, { latex: 'x - y = 2' }],
      },
    ])
    const viz = visualizations[0]
    expect(viz?.type).toBe('equation_2d')
    if (viz?.type !== 'equation_2d') throw new Error('expected equation')
    expect(viz.expressions.map((e) => e.latex)).toEqual(['x + y = 6', 'x - y = 2'])
  })

  it('keeps an inequality and its relation', () => {
    const { visualizations } = normalizeVisualizations([
      { type: 'inequality_2d', expressions: [{ latex: 'y >= 2x - 1' }] },
    ])
    const viz = visualizations[0]
    if (viz?.type !== 'inequality_2d') throw new Error('expected inequality')
    expect(viz.expressions[0]!.relation).toBe('>=')
  })

  it('keeps structured numeric points, not strings', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'points_2d',
        points: [
          { x: -2, y: 3 },
          { x: 0, y: 1, label: 'A' },
          { x: 2, y: 5 },
        ],
      },
    ])
    const viz = visualizations[0]
    if (viz?.type !== 'points_2d') throw new Error('expected points')
    expect(viz.points).toEqual([
      { x: -2, y: 3 },
      { x: 0, y: 1, label: 'A' },
      { x: 2, y: 5 },
    ])
  })

  it('accepts a table with connectPoints', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'table_2d',
        connectPoints: true,
        points: [
          { x: 0, y: 1 },
          { x: 1, y: 3 },
        ],
      },
    ])
    const viz = visualizations[0]
    if (viz?.type !== 'table_2d') throw new Error('expected table')
    expect(viz.connect).toBe(true)
  })

  it('accepts a bare array as well as the wrapped object', () => {
    const { visualizations } = normalizeVisualizations([
      { type: 'function_2d', expressions: [{ latex: 'y = x' }] },
    ])
    expect(visualizations).toHaveLength(1)
  })
})

describe('normalizeVisualizations — validation and safety', () => {
  it('rejects an unsupported type', () => {
    const { visualizations, rejected } = normalizeVisualizations([
      { type: 'surface_3d', expressions: [{ latex: 'z = x + y' }] },
    ])
    expect(visualizations).toHaveLength(0)
    expect(rejected[0]?.reason).toBe('unsupported-type')
  })

  it('drops a visualization whose only expression is unsupported maths', () => {
    const { visualizations, rejected } = normalizeVisualizations([
      { type: 'function_2d', expressions: [{ latex: 'y = x^2' }] },
    ])
    expect(visualizations).toHaveLength(0)
    expect(rejected[0]?.reason).toBe('no-valid-expressions')
  })

  it('keeps valid expressions and drops invalid ones', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'equation_2d',
        expressions: [{ latex: 'y = x^2' }, { latex: 'y = 2x + 1' }],
      },
    ])
    const viz = visualizations[0]
    if (viz?.type !== 'equation_2d') throw new Error('expected equation')
    expect(viz.expressions.map((e) => e.latex)).toEqual(['y = 2x + 1'])
  })

  it('rejects NaN and Infinity points', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'points_2d',
        points: [
          { x: Number.NaN, y: 1 },
          { x: 2, y: Number.POSITIVE_INFINITY },
          { x: 1, y: 2 },
        ],
      },
    ])
    const viz = visualizations[0]
    if (viz?.type !== 'points_2d') throw new Error('expected points')
    expect(viz.points).toEqual([{ x: 1, y: 2 }])
  })

  it('drops an invalid viewport but keeps the visualization', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'function_2d',
        viewport: { xMin: 5, xMax: -5, yMin: -1, yMax: 1 },
        expressions: [{ latex: 'y = x' }],
      },
    ])
    expect(visualizations).toHaveLength(1)
    expect(visualizations[0]!.viewport).toBeUndefined()
  })

  it('caps the number of visualizations', () => {
    const drafts = Array.from({ length: 10 }, () => ({
      type: 'function_2d',
      expressions: [{ latex: 'y = x' }],
    }))
    const { visualizations } = normalizeVisualizations(drafts, { maxVisualizations: 3 })
    expect(visualizations).toHaveLength(3)
  })

  it('treats injected markup as inert data', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'points_2d',
        caption: '<script>window.__pwned = true</script>',
        points: [{ x: 0, y: 0 }],
      },
    ])
    // It is stored as a plain string; the React renderer escapes it. No code
    // is ever executed during normalization.
    expect(typeof visualizations[0]!.caption).toBe('string')
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('rejects expressions that try to inject HTML/SVG/JS', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'function_2d',
        expressions: [
          { latex: '<svg onload="alert(1)"></svg>' },
          { latex: '<script>alert(1)</script>' },
          { latex: 'javascript:alert(1)' },
        ],
      },
    ])
    expect(visualizations).toHaveLength(0)
  })

  it('strips hidden reasoning from captions', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'function_2d',
        caption: '<think>let me decide</think>Graph of a line',
        expressions: [{ latex: 'y = x' }],
      },
    ])
    expect(visualizations[0]!.caption).toBe('Graph of a line')
  })

  it('returns an empty result for garbage input', () => {
    expect(normalizeVisualizations(undefined).visualizations).toEqual([])
    expect(normalizeVisualizations('nope').visualizations).toEqual([])
    expect(normalizeVisualizations({ visualizations: 'nope' }).visualizations).toEqual([])
  })
})

describe('normalizeVisualizations — nonlinear functions (Phase 2)', () => {
  it('accepts a nonlinear function_2d with an expression', () => {
    const { visualizations } = normalizeVisualizations([
      { type: 'function_2d', expressions: [{ latex: 'y = x^2', expression: 'x^2' }] },
    ])
    const viz = visualizations[0]
    if (viz?.type !== 'function_2d') throw new Error('expected function_2d')
    expect(viz.expressions[0]).toMatchObject({ latex: 'y = x^2', relation: '=', expression: 'x^2' })
  })

  it('keeps a valid domain and drops an invalid one', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'function_2d',
        expressions: [
          { latex: 'y = 1/x', expression: '1/x', domain: { min: 1, max: 4 } },
          { latex: 'y = sin(x)', expression: 'sin(x)', domain: { min: 5, max: -5 } },
        ],
      },
    ])
    const viz = visualizations[0]
    if (viz?.type !== 'function_2d') throw new Error('expected function_2d')
    expect(viz.expressions[0]?.domain).toEqual({ min: 1, max: 4 })
    expect(viz.expressions[1]?.domain).toBeUndefined()
    expect(viz.expressions[1]?.expression).toBe('sin(x)')
  })

  it('drops an unsupported nonlinear expression', () => {
    const { visualizations, rejected } = normalizeVisualizations([
      { type: 'function_2d', expressions: [{ latex: 'y = tan(x)', expression: 'tan(x)' }] },
    ])
    expect(visualizations).toHaveLength(0)
    expect(rejected[0]?.reason).toBe('no-valid-expressions')
  })

  it('ignores an expression on a non-equality relation', () => {
    const { visualizations } = normalizeVisualizations([
      { type: 'function_2d', expressions: [{ latex: 'y > x^2', relation: '>', expression: 'x^2' }] },
    ])
    expect(visualizations).toHaveLength(0)
  })

  it('never treats equation_2d expressions as nonlinear', () => {
    const { visualizations } = normalizeVisualizations([
      { type: 'equation_2d', expressions: [{ latex: 'y = x^2', expression: 'x^2' }] },
    ])
    expect(visualizations).toHaveLength(0)
  })

  it('keeps a mixed linear + nonlinear function_2d', () => {
    const { visualizations } = normalizeVisualizations([
      {
        type: 'function_2d',
        expressions: [
          { latex: 'y = 2x + 1' },
          { latex: 'y = x^2', expression: 'x^2' },
        ],
      },
    ])
    const viz = visualizations[0]
    if (viz?.type !== 'function_2d') throw new Error('expected function_2d')
    expect(viz.expressions).toHaveLength(2)
    expect(viz.expressions[0]?.expression).toBeUndefined()
    expect(viz.expressions[1]?.expression).toBe('x^2')
  })
})
