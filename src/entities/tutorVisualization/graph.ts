import type { GraphEdge, GraphLayoutKind, GraphNode } from './types'
import type { Vec2 } from './vector'

/**
 * A small, deterministic, local graph layout.
 *
 * The model never supplies coordinates: it supplies nodes, edges and a layout
 * *hint*. Every position is computed here, the same input always yields the
 * same coordinates, and an infeasible request falls back to a circular layout
 * instead of failing or inventing geometry.
 */

export interface GraphLayoutInput {
  nodes: GraphNode[]
  edges: GraphEdge[]
  layout: GraphLayoutKind
  rootId?: string
  width: number
  height: number
  pad: { left: number; right: number; top: number; bottom: number }
}

export interface PlacedNode {
  id: string
  label: string
  highlighted: boolean
  x: number
  y: number
  radius: number
}

export interface PlacedEdge {
  source: string
  target: string
  directed: boolean
  highlighted: boolean
  selfLoop: boolean
  from: Vec2
  to: Vec2
  labelX: number
  labelY: number
  label?: string
  weight?: number
}

export interface GraphLayout {
  layout: GraphLayoutKind
  nodes: PlacedNode[]
  edges: PlacedEdge[]
}

interface Area {
  x0: number
  y0: number
  width: number
  height: number
}

function adjacency(nodes: GraphNode[], edges: GraphEdge[], directed: boolean): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const node of nodes) map.set(node.id, [])
  for (const edge of edges) {
    map.get(edge.source)?.push(edge.target)
    if (!directed) map.get(edge.target)?.push(edge.source)
  }
  return map
}

function levelsFromRoot(
  nodes: GraphNode[],
  edges: GraphEdge[],
  directed: boolean,
  rootId: string,
): Map<string, number> | null {
  if (!nodes.some((node) => node.id === rootId)) return null
  const adj = adjacency(nodes, edges, directed)
  const level = new Map<string, number>([[rootId, 0]])
  const queue = [rootId]
  while (queue.length > 0) {
    const current = queue.shift()!
    const next = level.get(current)! + 1
    for (const neighbour of adj.get(current) ?? []) {
      if (level.has(neighbour)) continue
      level.set(neighbour, next)
      queue.push(neighbour)
    }
  }
  if (level.size !== nodes.length) return null // disconnected
  return level
}

/** Validate that a hierarchical layout can represent the graph faithfully. */
function isHierarchicalFeasible(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string | undefined,
  directed: boolean,
): boolean {
  if (!rootId) return false
  const level = levelsFromRoot(nodes, edges, directed, rootId)
  if (!level) return false
  for (const edge of edges) {
    const a = level.get(edge.source)
    const b = level.get(edge.target)
    if (a === undefined || b === undefined) return false
    // Directed: every edge must go exactly one level forward. Undirected: every
    // edge must connect adjacent levels (a same-level or skipping edge means a
    // cycle or a non-tree, so the layered picture would be a lie).
    if (directed) {
      if (b !== a + 1) return false
    } else if (Math.abs(b - a) !== 1) {
      return false
    }
  }
  return true
}

function isBipartiteFeasible(nodes: GraphNode[], edges: GraphEdge[]): boolean {
  if (!nodes.every((node) => node.partition === 'left' || node.partition === 'right')) return false
  const hasLeft = nodes.some((node) => node.partition === 'left')
  const hasRight = nodes.some((node) => node.partition === 'right')
  if (!hasLeft || !hasRight) return false
  const partition = new Map(nodes.map((node) => [node.id, node.partition]))
  // An edge inside one partition contradicts the bipartite declaration.
  return edges.every((edge) => partition.get(edge.source) !== partition.get(edge.target))
}

/**
 * The layout actually used. Falls back to `circular` when the requested layout
 * cannot represent the graph without changing its meaning.
 */
export function resolveGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  requested: GraphLayoutKind,
  directed: boolean,
  rootId?: string,
): GraphLayoutKind {
  if (requested === 'bipartite' && isBipartiteFeasible(nodes, edges)) return 'bipartite'
  if (requested === 'hierarchical' && isHierarchicalFeasible(nodes, edges, rootId, directed)) {
    return 'hierarchical'
  }
  return 'circular'
}

function circularPositions(nodes: GraphNode[], area: Area, radius: number): Map<string, Vec2> {
  const positions = new Map<string, Vec2>()
  const cx = area.x0 + area.width / 2
  const cy = area.y0 + area.height / 2
  const n = nodes.length
  if (n === 1) {
    positions.set(nodes[0]!.id, { x: cx, y: cy })
    return positions
  }
  if (n === 2) {
    const r = Math.min(area.width / 2 - radius, area.height / 2 - radius)
    positions.set(nodes[0]!.id, { x: cx - r, y: cy })
    positions.set(nodes[1]!.id, { x: cx + r, y: cy })
    return positions
  }
  const r = Math.max(radius + 6, Math.min(area.width, area.height) / 2 - radius - 4)
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    positions.set(nodes[i]!.id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  }
  return positions
}

function bipartitePositions(nodes: GraphNode[], area: Area): Map<string, Vec2> {
  const positions = new Map<string, Vec2>()
  const columns: Record<'left' | 'right', GraphNode[]> = { left: [], right: [] }
  for (const node of nodes) columns[node.partition === 'right' ? 'right' : 'left'].push(node)
  const columnX = { left: area.x0 + area.width * 0.28, right: area.x0 + area.width * 0.72 }
  for (const side of ['left', 'right'] as const) {
    const column = columns[side]
    const step = area.height / (column.length + 1)
    column.forEach((node, index) => {
      positions.set(node.id, { x: columnX[side], y: area.y0 + step * (index + 1) })
    })
  }
  return positions
}

function hierarchicalPositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  directed: boolean,
  rootId: string,
  area: Area,
): Map<string, Vec2> {
  const level = levelsFromRoot(nodes, edges, directed, rootId)!
  const byLevel = new Map<number, GraphNode[]>()
  for (const node of nodes) {
    const value = level.get(node.id) ?? 0
    const bucket = byLevel.get(value) ?? []
    bucket.push(node)
    byLevel.set(value, bucket)
  }
  const maxLevel = Math.max(...byLevel.keys(), 0)
  const positions = new Map<string, Vec2>()
  for (const [value, bucket] of byLevel) {
    const y = area.y0 + (area.height * (value + 0.5)) / (maxLevel + 1)
    const step = area.width / (bucket.length + 1)
    bucket.forEach((node, index) => {
      positions.set(node.id, { x: area.x0 + step * (index + 1), y })
    })
  }
  return positions
}

function trimToBorder(from: Vec2, to: Vec2, radius: number): { from: Vec2; to: Vec2 } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length <= 1e-6) return { from, to }
  const ux = dx / length
  const uy = dy / length
  return {
    from: { x: from.x + ux * radius, y: from.y + uy * radius },
    to: { x: to.x - ux * radius, y: to.y - uy * radius },
  }
}

export function layoutGraph(input: GraphLayoutInput): GraphLayout {
  const { nodes, edges, width, height, pad } = input
  const area: Area = {
    x0: pad.left,
    y0: pad.top,
    width: Math.max(10, width - pad.left - pad.right),
    height: Math.max(10, height - pad.top - pad.bottom),
  }
  const radius = Math.max(9, Math.min(20, Math.min(area.width, area.height) * 0.038))
  const directed = input.nodes.length > 0 && edges.some((edge) => edge.directed === true)

  let layout = resolveGraphLayout(nodes, edges, input.layout, directed, input.rootId)
  let positions: Map<string, Vec2>
  try {
    if (layout === 'bipartite') positions = bipartitePositions(nodes, area)
    else if (layout === 'hierarchical') {
      positions = hierarchicalPositions(nodes, edges, directed, input.rootId!, area)
    } else positions = circularPositions(nodes, area, radius)
  } catch {
    layout = 'circular'
    positions = circularPositions(nodes, area, radius)
  }

  const placedNodes: PlacedNode[] = nodes.map((node) => {
    const position = positions.get(node.id) ?? {
      x: area.x0 + area.width / 2,
      y: area.y0 + area.height / 2,
    }
    return {
      id: node.id,
      label: node.label,
      highlighted: node.highlighted === true,
      x: position.x,
      y: position.y,
      radius,
    }
  })
  const byId = new Map(placedNodes.map((node) => [node.id, node]))

  const placedEdges: PlacedEdge[] = []
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue // dangling edge: dropped, never drawn
    const directedEdge = edge.directed === true
    if (source.id === target.id) {
      placedEdges.push({
        source: edge.source,
        target: edge.target,
        directed: directedEdge,
        highlighted: edge.highlighted === true,
        selfLoop: true,
        from: { x: source.x, y: source.y - source.radius },
        to: { x: source.x, y: source.y - source.radius },
        labelX: source.x,
        labelY: source.y - source.radius * 2.6,
        ...(edge.label ? { label: edge.label } : {}),
        ...(edge.weight !== undefined ? { weight: edge.weight } : {}),
      })
      continue
    }
    const trimmed = trimToBorder(
      { x: source.x, y: source.y },
      { x: target.x, y: target.y },
      radius,
    )
    placedEdges.push({
      source: edge.source,
      target: edge.target,
      directed: directedEdge,
      highlighted: edge.highlighted === true,
      selfLoop: false,
      from: trimmed.from,
      to: trimmed.to,
      labelX: (source.x + target.x) / 2,
      labelY: (source.y + target.y) / 2,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.weight !== undefined ? { weight: edge.weight } : {}),
    })
  }

  return { layout, nodes: placedNodes, edges: placedEdges }
}

/** Stable de-duplication: undirected `A—B` and `B—A` collapse; directed does not. */
export function dedupeGraphEdges(edges: GraphEdge[], graphDirected: boolean): GraphEdge[] {
  const seen = new Set<string>()
  const result: GraphEdge[] = []
  for (const edge of edges) {
    const directed = graphDirected || edge.directed === true
    const key = directed
      ? `${edge.source}\u0000${edge.target}`
      : [edge.source, edge.target].sort().join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(edge)
  }
  return result
}
