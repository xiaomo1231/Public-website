import { describe, expect, it } from 'vitest'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import { dedupeGraphEdges, layoutGraph, resolveGraphLayout } from '@/entities/tutorVisualization/graph'
import type { GraphVisualization } from '@/entities/tutorVisualization/types'
import { VISUALIZATION_LIMITS } from '@/entities/tutorVisualization/limits'

function graphViz(draft: unknown): GraphVisualization {
  const viz = normalizeVisualizations([draft]).visualizations[0]
  if (viz?.type !== 'graph_2d') throw new Error('expected graph_2d')
  return viz
}

const LAYOUT_INPUT = {
  width: 640,
  height: 400,
  pad: { left: 46, right: 16, top: 16, bottom: 30 },
}

describe('normalizeVisualizations — graph_2d', () => {
  it('accepts nodes, edges and graph kind', () => {
    const viz = graphViz({
      type: 'graph_2d',
      graphKind: 'undirected',
      layout: 'circular',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [{ source: 'a', target: 'b', weight: 3 }],
    })
    expect(viz.graphKind).toBe('undirected')
    expect(viz.layout).toBe('circular')
    expect(viz.nodes).toHaveLength(2)
    expect(viz.edges).toHaveLength(1)
    expect(viz.edges[0]).toMatchObject({ source: 'a', target: 'b', weight: 3 })
  })

  it('drops duplicate node ids and dangling edges', () => {
    const viz = graphViz({
      type: 'graph_2d',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'Again' },
        { id: 'b', label: 'B' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'missing' },
      ],
    })
    expect(viz.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(viz.edges).toHaveLength(1)
  })

  it('collapses an undirected A—B / B—A duplicate but keeps directed both ways', () => {
    const undirected = graphViz({
      type: 'graph_2d',
      graphKind: 'undirected',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    })
    expect(undirected.edges).toHaveLength(1)

    const directed = graphViz({
      type: 'graph_2d',
      graphKind: 'directed',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    })
    expect(directed.edges).toHaveLength(2)
  })

  it('keeps self-loops and drops a non-finite weight only', () => {
    const viz = graphViz({
      type: 'graph_2d',
      nodes: [{ id: 'a', label: 'A' }],
      edges: [
        { source: 'a', target: 'a', label: 'loop' },
        { source: 'a', target: 'a', weight: Number.POSITIVE_INFINITY },
      ],
    })
    expect(viz.edges.length).toBeGreaterThanOrEqual(1)
    for (const edge of viz.edges) {
      if (edge.weight !== undefined) expect(Number.isFinite(edge.weight)).toBe(true)
    }
  })

  it('caps the node count at the configured maximum', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }))
    const viz = graphViz({ type: 'graph_2d', nodes })
    expect(viz.nodes).toHaveLength(VISUALIZATION_LIMITS.maxGraphNodes)
  })

  it('rejects a graph with no valid nodes', () => {
    const result = normalizeVisualizations([{ type: 'graph_2d', nodes: [], edges: [] }])
    expect(result.visualizations).toHaveLength(0)
    expect(result.rejected[0]?.reason).toBe('no-valid-nodes')
  })

  it('drops prototype-polluting node ids', () => {
    const viz = graphViz({
      type: 'graph_2d',
      nodes: [
        { id: '__proto__', label: 'bad' },
        { id: 'ok', label: 'OK' },
      ],
      edges: [{ source: '__proto__', target: 'ok' }],
    })
    expect(viz.nodes.map((node) => node.id)).toEqual(['ok'])
    expect(viz.edges).toHaveLength(0)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('falls back to circular when the bipartite partition is invalid', () => {
    const invalid = graphViz({
      type: 'graph_2d',
      layout: 'bipartite',
      nodes: [
        { id: 'a', label: 'A', partition: 'left' },
        { id: 'b', label: 'B', partition: 'left' },
      ],
      edges: [{ source: 'a', target: 'b' }],
    })
    expect(invalid.layout).toBe('circular')

    const valid = graphViz({
      type: 'graph_2d',
      layout: 'bipartite',
      nodes: [
        { id: 'a', label: 'A', partition: 'left' },
        { id: 'b', label: 'B', partition: 'right' },
      ],
      edges: [{ source: 'a', target: 'b' }],
    })
    expect(valid.layout).toBe('bipartite')
  })

  it('falls back to circular for a cyclic or rootless hierarchical request', () => {
    const cyclic = graphViz({
      type: 'graph_2d',
      graphKind: 'directed',
      layout: 'hierarchical',
      rootId: 'a',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
      ],
    })
    expect(cyclic.layout).toBe('circular')

    const noRoot = graphViz({
      type: 'graph_2d',
      graphKind: 'directed',
      layout: 'hierarchical',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [{ source: 'a', target: 'b' }],
    })
    expect(noRoot.layout).toBe('circular')

    const tree = graphViz({
      type: 'graph_2d',
      graphKind: 'directed',
      layout: 'hierarchical',
      rootId: 'a',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ],
    })
    expect(tree.layout).toBe('hierarchical')
  })

  it('treats injected labels as inert plain text', () => {
    const viz = graphViz({
      type: 'graph_2d',
      nodes: [{ id: 'a', label: '<script>window.__pwned = true</script>' }],
      edges: [],
    })
    expect(typeof viz.nodes[0]?.label).toBe('string')
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})

describe('graph layout', () => {
  const nodes = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ]

  it('is deterministic', () => {
    const first = layoutGraph({ ...LAYOUT_INPUT, nodes, edges: [], layout: 'circular' })
    const second = layoutGraph({ ...LAYOUT_INPUT, nodes, edges: [], layout: 'circular' })
    expect(second).toEqual(first)
  })

  it('centres a single node and spreads two symmetrically', () => {
    const one = layoutGraph({
      ...LAYOUT_INPUT,
      nodes: [{ id: 'a', label: 'A' }],
      edges: [],
      layout: 'circular',
    })
    const area = {
      cx: LAYOUT_INPUT.pad.left + (LAYOUT_INPUT.width - LAYOUT_INPUT.pad.left - LAYOUT_INPUT.pad.right) / 2,
      cy: LAYOUT_INPUT.pad.top + (LAYOUT_INPUT.height - LAYOUT_INPUT.pad.top - LAYOUT_INPUT.pad.bottom) / 2,
    }
    expect(one.nodes[0]?.x).toBeCloseTo(area.cx, 6)
    expect(one.nodes[0]?.y).toBeCloseTo(area.cy, 6)

    const two = layoutGraph({
      ...LAYOUT_INPUT,
      nodes: nodes.slice(0, 2),
      edges: [],
      layout: 'circular',
    })
    expect(two.nodes[0]!.x).toBeLessThan(two.nodes[1]!.x)
    expect(two.nodes[0]!.y).toBeCloseTo(two.nodes[1]!.y, 6)
  })

  it('places bipartite partitions in two columns', () => {
    const graph = layoutGraph({
      ...LAYOUT_INPUT,
      layout: 'bipartite',
      nodes: [
        { id: 'a', label: 'A', partition: 'left' },
        { id: 'b', label: 'B', partition: 'right' },
        { id: 'c', label: 'C', partition: 'left' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'c', target: 'b' },
      ],
    })
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    expect(byId.get('a')!.x).toBeLessThan(byId.get('b')!.x)
    expect(byId.get('c')!.x).toBeLessThan(byId.get('b')!.x)
    expect(byId.get('a')!.x).toBeCloseTo(byId.get('c')!.x, 6)
  })

  it('places a hierarchy by level', () => {
    const graph = layoutGraph({
      ...LAYOUT_INPUT,
      layout: 'hierarchical',
      rootId: 'a',
      nodes,
      edges: [
        { source: 'a', target: 'b', directed: true },
        { source: 'a', target: 'c', directed: true },
      ],
    })
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    expect(byId.get('a')!.y).toBeLessThan(byId.get('b')!.y)
    expect(byId.get('a')!.y).toBeLessThan(byId.get('c')!.y)
  })

  it('trims edges to the node border and builds self-loops', () => {
    const graph = layoutGraph({
      ...LAYOUT_INPUT,
      layout: 'circular',
      nodes: nodes.slice(0, 2),
      edges: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'a' },
      ],
    })
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    const edge = graph.edges.find((candidate) => !candidate.selfLoop)!
    const source = byId.get(edge.source)!
    expect(Math.hypot(edge.from.x - source.x, edge.from.y - source.y)).toBeCloseTo(source.radius, 4)
    expect(graph.edges.some((candidate) => candidate.selfLoop)).toBe(true)
  })

  it('resolves an infeasible layout to circular', () => {
    expect(resolveGraphLayout(nodes, [], 'bipartite', false)).toBe('circular')
    expect(resolveGraphLayout(nodes, [], 'hierarchical', false)).toBe('circular')
  })
})

describe('dedupeGraphEdges', () => {
  it('collapses undirected duplicates and keeps directed direction', () => {
    const undirected = dedupeGraphEdges(
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
        { source: 'a', target: 'b' },
      ],
      false,
    )
    expect(undirected).toHaveLength(1)

    const directed = dedupeGraphEdges(
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
      true,
    )
    expect(directed).toHaveLength(2)
  })
})
