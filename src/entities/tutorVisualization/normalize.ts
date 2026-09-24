import { stripThinkBlocks } from '@/infrastructure/ai/responseText'
import {
  PLACEMENT_BLOCKS,
  TUTOR_VISUALIZATION_SCHEMA_VERSION,
  type EigenCandidate,
  type GraphEdge,
  type GraphKind,
  type GraphLayoutKind,
  type GraphNode,
  type Matrix2x2,
  type PlacementBlock,
  type TransformVector,
  type TutorVisualization,
  type TutorVisualizationType,
  type VectorOperation,
  type VectorRole,
  type VennOperation,
  type VennSet,
  type VisualizationDraft,
  type VisualizationExpression,
  type VisualizationPlacement,
  type VisualizationPoint,
  type VisualizationVector,
  type VisualizationViewport,
} from './types'
import { VISUALIZATION_LIMITS } from './limits'
import { normalizeViewport, parseRelationLatex } from './linear'
import { normalizeFunctionDomain, parseExplicitFunction } from './nonlinear'
import { dedupeGraphEdges, resolveGraphLayout } from './graph'
import { computeTransform } from './transform'
import { matchEigenCandidate, solveEigen, verifyEigenPair } from './eigen'
import { VENN_OPERATIONS, applyVennOperation, computeVennRegions, dedupeElements } from './setOperations'
import {
  addVectors,
  approxEqualVector,
  isCollinear,
  isZeroVector,
  scaleVector,
  spanCoefficients,
} from './vector'

/**
 * Turn untrusted model output into stored visualizations.
 *
 * The model is treated exactly like any other untrusted source: every field is
 * type-checked, every relation is re-parsed locally, and anything that cannot
 * be understood is dropped. A rejected visualization never rejects the lesson.
 */

const {
  maxVisualizations: MAX_VISUALIZATIONS,
  maxExpressions: MAX_EXPRESSIONS,
  maxPoints: MAX_POINTS,
  maxVectors: MAX_VECTORS,
  maxGraphNodes: MAX_GRAPH_NODES,
  maxGraphEdges: MAX_GRAPH_EDGES,
  maxTransformVectors: MAX_TRANSFORM_VECTORS,
  maxEigenCandidates: MAX_EIGEN_CANDIDATES,
  maxMatrixElement: MAX_MATRIX_ELEMENT,
  maxTransformCoordinate: MAX_TRANSFORM_COORDINATE,
  maxVennSets: MAX_VENN_SETS,
  maxSetElements: MAX_SET_ELEMENTS,
  maxUniverseElements: MAX_UNIVERSE_ELEMENTS,
  maxElementLength: MAX_ELEMENT_LENGTH,
  maxCaptionLength: MAX_CAPTION_LENGTH,
  maxLabelLength: MAX_LABEL_LENGTH,
  maxIdLength: MAX_ID_LENGTH,
  maxMagnitude: MAX_MAGNITUDE,
} = VISUALIZATION_LIMITS

const ALL_TYPES: readonly TutorVisualizationType[] = [
  'function_2d',
  'equation_2d',
  'inequality_2d',
  'points_2d',
  'table_2d',
  'vectors_2d',
  'graph_2d',
  'transform_2d',
  'venn_2d',
  'eigen_2d',
]

const LINE_TYPES: readonly TutorVisualizationType[] = [
  'function_2d',
  'equation_2d',
  'inequality_2d',
]

const VECTOR_ROLES: readonly VectorRole[] = ['vector', 'basis', 'component', 'result']
const VECTOR_OPERATIONS: readonly VectorOperation[] = [
  'display',
  'addition',
  'scalar_multiplication',
  'linear_combination',
  'basis',
]
const GRAPH_LAYOUTS: readonly GraphLayoutKind[] = ['circular', 'bipartite', 'hierarchical']
/** Keys that must never be used as object keys downstream. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface RejectedVisualization {
  index: number
  reason: string
}

export interface NormalizeResult {
  visualizations: TutorVisualization[]
  rejected: RejectedVisualization[]
}

type Normalized = { ok: true; value: TutorVisualization } | { ok: false; reason: string }

/** Fields shared by every stored visualization. */
interface CommonBase {
  id: string
  schemaVersion: number
  placement: VisualizationPlacement
  caption?: string
}

function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = stripThinkBlocks(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, maxLength)
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= MAX_MAGNITUDE ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && Math.abs(parsed) <= MAX_MAGNITUDE ? parsed : null
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function normalizeExpressions(
  raw: unknown,
  options: { allowFunctions: boolean },
): VisualizationExpression[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const expressions: VisualizationExpression[] = []

  for (const entry of raw) {
    if (expressions.length >= MAX_EXPRESSIONS) break
    const record = asRecord(entry)
    if (!record) continue
    const rawLatex = record.latex
    if (typeof rawLatex !== 'string') continue

    const latex = stripThinkBlocks(rawLatex).trim()
    if (!latex || seen.has(latex)) continue

    const label = sanitizeText(record.label, MAX_LABEL_LENGTH)

    // Nonlinear explicit function (Phase 2): only for `function_2d`, only `=`.
    if (options.allowFunctions && typeof record.expression === 'string') {
      const parsedFunction = parseExplicitFunction(record.expression)
      const isEquality = record.relation === undefined || record.relation === '='
      if (parsedFunction && isEquality) {
        seen.add(latex)
        const domain = normalizeFunctionDomain(record.domain)
        expressions.push({
          latex,
          relation: '=',
          expression: parsedFunction.source,
          ...(label ? { label } : {}),
          ...(domain ? { domain } : {}),
        })
        continue
      }
    }

    // Linear relation (Phase 1).
    const parsed = parseRelationLatex(latex)
    if (!parsed) continue

    seen.add(latex)
    expressions.push({
      latex,
      relation: parsed.relation,
      ...(label ? { label } : {}),
    })
  }

  return expressions
}

function normalizePoints(raw: unknown): VisualizationPoint[] {
  if (!Array.isArray(raw)) return []
  const points: VisualizationPoint[] = []

  for (const entry of raw) {
    if (points.length >= MAX_POINTS) break
    const record = asRecord(entry)
    if (!record) continue
    const x = readNumber(record.x)
    const y = readNumber(record.y)
    if (x === null || y === null) continue
    const label = sanitizeText(record.label, MAX_LABEL_LENGTH)
    points.push({ x, y, ...(label ? { label } : {}) })
  }

  return points
}

function normalizeVectorItem(raw: unknown, index: number): VisualizationVector | null {
  const record = asRecord(raw)
  if (!record) return null
  const x = readNumber(record.x)
  const y = readNumber(record.y)
  if (x === null || y === null) return null
  const vector: VisualizationVector = { id: `v${index}`, x, y }
  const start = asRecord(record.start)
  if (start) {
    const sx = readNumber(start.x)
    const sy = readNumber(start.y)
    if (sx === null || sy === null) return null
    vector.start = { x: sx, y: sy }
  }
  const label = sanitizeText(record.label, MAX_LABEL_LENGTH)
  if (label) vector.label = label
  if (typeof record.role === 'string' && VECTOR_ROLES.includes(record.role as VectorRole)) {
    vector.role = record.role as VectorRole
  }
  if (record.highlighted === true) vector.highlighted = true
  return vector
}

/**
 * Verify the model's `result` vector against local maths.
 *
 * - `addition`: the result must equal the sum of the other vectors; a mismatch
 *   is re-derived so the drawing is mathematically correct.
 * - `scalar_multiplication`: the result must be collinear with the input.
 * - `linear_combination`: the result must lie in the span of the two basis
 *   vectors (verified by re-solving the 2×2 system and reconstructing it).
 *
 * An inconsistent result is dropped rather than trusted.
 */
function reconcileVectorResult(
  operation: VectorOperation,
  vectors: VisualizationVector[],
): VisualizationVector[] {
  const resultIndex = vectors.findIndex((vector) => vector.role === 'result')
  if (resultIndex === -1) return vectors
  const result = vectors[resultIndex]!
  const inputs = vectors.filter(
    (vector, index) => index !== resultIndex && vector.role !== 'basis' && vector.role !== 'component',
  )

  if (operation === 'addition') {
    if (inputs.length < 2) return vectors
    const expected = inputs.reduce<{ x: number; y: number }>(
      (acc, vector) => addVectors(acc, { x: vector.x, y: vector.y }),
      { x: 0, y: 0 },
    )
    if (approxEqualVector(expected, { x: result.x, y: result.y })) return vectors
    const updated = vectors.slice()
    updated[resultIndex] = { ...result, x: expected.x, y: expected.y }
    return updated
  }

  if (operation === 'scalar_multiplication') {
    if (inputs.length !== 1) return vectors
    const input = inputs[0]!
    if (isCollinear({ x: input.x, y: input.y }, { x: result.x, y: result.y })) return vectors
    return vectors.filter((_, index) => index !== resultIndex)
  }

  if (operation === 'linear_combination') {
    const basis = vectors.filter((vector, index) => index !== resultIndex && vector.role === 'basis')
    if (basis.length !== 2) return vectors
    const b1 = { x: basis[0]!.x, y: basis[0]!.y }
    const b2 = { x: basis[1]!.x, y: basis[1]!.y }
    const coefficients = spanCoefficients(b1, b2, { x: result.x, y: result.y })
    if (!coefficients) return vectors.filter((_, index) => index !== resultIndex)
    const rebuilt = addVectors(scaleVector(b1, coefficients.s), scaleVector(b2, coefficients.t))
    if (approxEqualVector(rebuilt, { x: result.x, y: result.y })) return vectors
    return vectors.filter((_, index) => index !== resultIndex)
  }

  return vectors
}

function normalizeVectors(
  draft: VisualizationDraft,
  base: CommonBase & { viewport?: VisualizationViewport },
): Normalized {
  const operation = VECTOR_OPERATIONS.includes(draft.operation as VectorOperation)
    ? (draft.operation as VectorOperation)
    : 'display'

  const rawVectors = Array.isArray(draft.vectors) ? draft.vectors : []
  let vectors: VisualizationVector[] = []
  for (const raw of rawVectors) {
    if (vectors.length >= MAX_VECTORS) break
    const vector = normalizeVectorItem(raw, vectors.length)
    if (!vector) continue
    // A zero-length arrow is not a vector; dropping it never changes the maths.
    if (isZeroVector({ x: vector.x, y: vector.y })) continue
    vectors.push(vector)
  }
  if (vectors.length === 0) return { ok: false, reason: 'no-valid-vectors' }

  vectors = reconcileVectorResult(operation, vectors)

  return {
    ok: true,
    value: { ...base, type: 'vectors_2d', vectors, operation },
  }
}

function normalizeGraphNode(raw: unknown): GraphNode | null {
  const record = asRecord(raw)
  if (!record) return null
  const id = sanitizeText(record.id, MAX_ID_LENGTH)
  if (!id) return null
  const label = sanitizeText(record.label, MAX_LABEL_LENGTH) ?? id
  const node: GraphNode = { id, label }
  if (record.partition === 'left' || record.partition === 'right') node.partition = record.partition
  if (record.highlighted === true) node.highlighted = true
  return node
}

function normalizeGraphEdge(raw: unknown): GraphEdge | null {
  const record = asRecord(raw)
  if (!record) return null
  const source = sanitizeText(record.source, MAX_ID_LENGTH)
  const target = sanitizeText(record.target, MAX_ID_LENGTH)
  if (!source || !target) return null
  const edge: GraphEdge = { source, target }
  const label = sanitizeText(record.label, MAX_LABEL_LENGTH)
  if (label) edge.label = label
  const weight = readNumber(record.weight)
  if (weight !== null) edge.weight = weight
  if (record.directed === true) edge.directed = true
  if (record.highlighted === true) edge.highlighted = true
  return edge
}

function normalizeGraph(draft: VisualizationDraft, base: CommonBase): Normalized {
  const graphKind: GraphKind = draft.graphKind === 'directed' ? 'directed' : 'undirected'
  const requestedLayout = GRAPH_LAYOUTS.includes(draft.layout as GraphLayoutKind)
    ? (draft.layout as GraphLayoutKind)
    : 'circular'

  const rawNodes = Array.isArray(draft.nodes) ? draft.nodes : []
  const nodes: GraphNode[] = []
  const nodeIds = new Set<string>()
  for (const raw of rawNodes) {
    if (nodes.length >= MAX_GRAPH_NODES) break
    const node = normalizeGraphNode(raw)
    if (!node || DANGEROUS_KEYS.has(node.id) || nodeIds.has(node.id)) continue
    nodeIds.add(node.id)
    nodes.push(node)
  }
  if (nodes.length === 0) return { ok: false, reason: 'no-valid-nodes' }

  const rawEdges = Array.isArray(draft.edges) ? draft.edges : []
  const collected: GraphEdge[] = []
  for (const raw of rawEdges) {
    if (collected.length >= MAX_GRAPH_EDGES) break
    const edge = normalizeGraphEdge(raw)
    if (!edge) continue
    // Dangling edges are dropped individually; they never fail the whole graph.
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    collected.push(edge)
  }
  const edges = dedupeGraphEdges(collected, graphKind === 'directed')

  const rawRoot = sanitizeText(draft.rootId, MAX_ID_LENGTH)
  const rootId =
    rawRoot && nodeIds.has(rawRoot) && !DANGEROUS_KEYS.has(rawRoot) ? rawRoot : undefined
  const layout = resolveGraphLayout(nodes, edges, requestedLayout, graphKind === 'directed', rootId)

  return {
    ok: true,
    value: {
      ...base,
      type: 'graph_2d',
      graphKind,
      layout,
      nodes,
      edges,
      ...(rootId ? { rootId } : {}),
    },
  }
}

function normalizePlacement(raw: unknown): VisualizationPlacement {
  const record = asRecord(raw)
  if (!record || record.scope !== 'section') return { scope: 'lesson' }
  const block = record.block
  if (typeof block !== 'string' || !PLACEMENT_BLOCKS.includes(block as PlacementBlock)) {
    return { scope: 'lesson' }
  }
  const rawIndex = readNumber(record.index)
  const index = rawIndex === null ? 0 : Math.max(0, Math.min(5, Math.floor(rawIndex)))
  return { scope: 'section', block: block as PlacementBlock, index }
}

function normalizeTransform(draft: VisualizationDraft, base: CommonBase): Normalized {
  const rawMatrix = asRecord(draft.matrix)
  if (!rawMatrix) return { ok: false, reason: 'no-valid-matrix' }
  const a = readNumber(rawMatrix.a)
  const b = readNumber(rawMatrix.b)
  const c = readNumber(rawMatrix.c)
  const d = readNumber(rawMatrix.d)
  if (a === null || b === null || c === null || d === null) {
    return { ok: false, reason: 'no-valid-matrix' }
  }
  if (
    Math.abs(a) > MAX_MATRIX_ELEMENT ||
    Math.abs(b) > MAX_MATRIX_ELEMENT ||
    Math.abs(c) > MAX_MATRIX_ELEMENT ||
    Math.abs(d) > MAX_MATRIX_ELEMENT
  ) {
    return { ok: false, reason: 'matrix-out-of-range' }
  }
  const matrix: Matrix2x2 = { a, b, c, d }

  const rawVectors = Array.isArray(draft.vectors) ? draft.vectors : []
  const vectors: TransformVector[] = []
  for (const raw of rawVectors) {
    if (vectors.length >= MAX_TRANSFORM_VECTORS) break
    const record = asRecord(raw)
    if (!record) continue
    const x = readNumber(record.x)
    const y = readNumber(record.y)
    if (x === null || y === null) continue
    const label = sanitizeText(record.label, MAX_LABEL_LENGTH)
    vectors.push({
      id: `t${vectors.length}`,
      x,
      y,
      ...(label ? { label } : {}),
      ...(record.highlighted === true ? { highlighted: true } : {}),
    })
  }

  // Recompute locally and reject anything non-finite or absurdly large.
  const geometry = computeTransform(matrix, vectors)
  const transformed = [
    ...geometry.transformedSquare,
    ...geometry.basis.map((entry) => entry.transformed),
    ...geometry.vectors.map((entry) => entry.transformed),
  ]
  for (const point of transformed) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return { ok: false, reason: 'non-finite-transform' }
    }
    if (
      Math.abs(point.x) > MAX_TRANSFORM_COORDINATE ||
      Math.abs(point.y) > MAX_TRANSFORM_COORDINATE
    ) {
      return { ok: false, reason: 'transform-out-of-range' }
    }
  }

  return {
    ok: true,
    value: {
      ...base,
      type: 'transform_2d',
      matrix,
      vectors,
      showBasis: draft.showBasis !== false,
      showUnitSquare: draft.showUnitSquare !== false,
      showGrid: draft.showGrid !== false,
      showArea: draft.showArea !== false,
    },
  }
}

function normalizeEigen(
  draft: VisualizationDraft,
  base: CommonBase & { viewport?: VisualizationViewport },
): Normalized {
  const rawMatrix = asRecord(draft.matrix)
  if (!rawMatrix) return { ok: false, reason: 'no-valid-matrix' }
  const a = readNumber(rawMatrix.a)
  const b = readNumber(rawMatrix.b)
  const c = readNumber(rawMatrix.c)
  const d = readNumber(rawMatrix.d)
  if (a === null || b === null || c === null || d === null) {
    return { ok: false, reason: 'no-valid-matrix' }
  }
  if (
    Math.abs(a) > MAX_MATRIX_ELEMENT ||
    Math.abs(b) > MAX_MATRIX_ELEMENT ||
    Math.abs(c) > MAX_MATRIX_ELEMENT ||
    Math.abs(d) > MAX_MATRIX_ELEMENT
  ) {
    return { ok: false, reason: 'matrix-out-of-range' }
  }
  const matrix: Matrix2x2 = { a, b, c, d }

  // The matrix is authoritative; eigenvalues and eigenvectors are local.
  const solved = solveEigen(matrix)
  if (!solved.ok) return { ok: false, reason: solved.reason }

  // AI candidates are only used to label the lesson's example. They are
  // validated against the local solution; if the lesson's stated eigenpairs
  // disagree wholesale with the matrix we draw nothing rather than a figure
  // that contradicts the text.
  const rawCandidates = Array.isArray(draft.eigenpairs) ? draft.eigenpairs : []
  const labels = new Map<number, string>()
  let candidateCount = 0
  let matched = 0
  for (const raw of rawCandidates) {
    if (candidateCount >= MAX_EIGEN_CANDIDATES) break
    const record = asRecord(raw)
    if (!record) continue
    const value = readNumber(record.value)
    const rawVector = asRecord(record.vector)
    if (value === null || !rawVector) continue
    const x = readNumber(rawVector.x)
    const y = readNumber(rawVector.y)
    if (x === null || y === null) continue
    candidateCount++
    const index = matchEigenCandidate({ value, vector: { x, y } }, solved.pairs)
    if (index === null) continue
    matched++
    const label = sanitizeText(record.label, MAX_LABEL_LENGTH)
    if (label && !labels.has(index)) labels.set(index, label)
  }
  if (candidateCount > 0 && matched === 0) {
    return { ok: false, reason: 'eigen-candidates-inconsistent' }
  }

  const eigenpairs: EigenCandidate[] = []
  for (const [index, pair] of solved.pairs.entries()) {
    if (!verifyEigenPair(matrix, pair.value, pair.vector)) {
      return { ok: false, reason: 'eigen-verification-failed' }
    }
    const label = labels.get(index)
    eigenpairs.push({
      value: pair.value,
      vector: { x: pair.vector.x, y: pair.vector.y },
      ...(label ? { label } : {}),
    })
  }

  return {
    ok: true,
    value: {
      ...base,
      type: 'eigen_2d',
      matrix,
      eigenpairs,
      fullEigenspace: solved.fullEigenspace,
      defective: solved.defective,
      showUnitCircle: draft.showUnitCircle !== false,
      showTransform: draft.showTransform !== false,
    },
  }
}

function normalizeVenn(draft: VisualizationDraft, base: CommonBase): Normalized {
  const rawSets = Array.isArray(draft.sets) ? draft.sets : []
  const sets: VennSet[] = []
  const ids = new Set<string>()
  for (const raw of rawSets) {
    if (sets.length >= MAX_VENN_SETS) break
    const record = asRecord(raw)
    if (!record) continue
    const id = sanitizeText(record.id, MAX_ID_LENGTH)
    if (!id || DANGEROUS_KEYS.has(id) || ids.has(id)) continue
    const label = sanitizeText(record.label, MAX_LABEL_LENGTH) ?? id
    const rawElements = Array.isArray(record.elements) ? record.elements : []
    const elements: string[] = []
    for (const element of rawElements) {
      if (elements.length >= MAX_SET_ELEMENTS) break
      const value = sanitizeText(element, MAX_ELEMENT_LENGTH)
      if (value) elements.push(value)
    }
    ids.add(id)
    sets.push({ id, label, elements: dedupeElements(elements) })
  }
  if (sets.length < 2) return { ok: false, reason: 'too-few-sets' }

  const rawUniverse = Array.isArray(draft.universe) ? draft.universe : []
  const universe: string[] = []
  for (const element of rawUniverse) {
    if (universe.length >= MAX_UNIVERSE_ELEMENTS) break
    const value = sanitizeText(element, MAX_ELEMENT_LENGTH)
    if (value) universe.push(value)
  }
  const dedupedUniverse = universe.length > 0 ? dedupeElements(universe) : undefined

  const operation: VennOperation = VENN_OPERATIONS.includes(draft.operation as VennOperation)
    ? (draft.operation as VennOperation)
    : 'display'

  const rawOperands = Array.isArray(draft.operands) ? draft.operands : []
  const operands = rawOperands
    .map((id) => sanitizeText(id, MAX_ID_LENGTH))
    .filter((id): id is string => id !== undefined && ids.has(id))
  const effectiveOperands = operands.length > 0 ? operands : sets.map((set) => set.id)

  if (operation === 'complement' && !dedupedUniverse) {
    return { ok: false, reason: 'complement-needs-universe' }
  }

  // Recompute locally to validate the data is usable.
  const regions = computeVennRegions(sets, dedupedUniverse)
  applyVennOperation(operation, sets, regions, effectiveOperands)

  return {
    ok: true,
    value: {
      ...base,
      type: 'venn_2d',
      sets,
      operation,
      operands: effectiveOperands,
      ...(dedupedUniverse ? { universe: dedupedUniverse } : {}),
    },
  }
}

function normalizeOne(raw: unknown, index: number): Normalized {
  const draft = asRecord(raw) as VisualizationDraft | null
  if (!draft) return { ok: false, reason: 'not-an-object' }

  const type = draft.type
  if (typeof type !== 'string' || !ALL_TYPES.includes(type as TutorVisualizationType)) {
    return { ok: false, reason: 'unsupported-type' }
  }

  const caption = sanitizeText(draft.caption, MAX_CAPTION_LENGTH)
  const viewport = normalizeViewport(draft.viewport)
  const base: CommonBase = {
    id: `${type}-${index}`,
    schemaVersion: TUTOR_VISUALIZATION_SCHEMA_VERSION,
    placement: normalizePlacement(draft.placement),
    ...(caption ? { caption } : {}),
  }

  if (type === 'graph_2d') return normalizeGraph(draft, base)
  if (type === 'transform_2d') return normalizeTransform(draft, base)
  if (type === 'venn_2d') return normalizeVenn(draft, base)

  const planeBase: CommonBase & { viewport?: VisualizationViewport } = {
    ...base,
    ...(viewport ? { viewport } : {}),
  }

  if (type === 'vectors_2d') return normalizeVectors(draft, planeBase)
  if (type === 'eigen_2d') return normalizeEigen(draft, planeBase)

  if (LINE_TYPES.includes(type as TutorVisualizationType)) {
    const expressions = normalizeExpressions(draft.expressions, {
      allowFunctions: type === 'function_2d',
    })
    if (expressions.length === 0) return { ok: false, reason: 'no-valid-expressions' }
    return {
      ok: true,
      value: {
        ...planeBase,
        type: type as 'function_2d' | 'equation_2d' | 'inequality_2d',
        expressions,
      },
    }
  }

  const points = normalizePoints(draft.points)
  if (points.length === 0) return { ok: false, reason: 'no-valid-points' }
  return {
    ok: true,
    value: {
      ...planeBase,
      type: type as 'points_2d' | 'table_2d',
      points,
      ...(draft.connectPoints === true ? { connect: true } : {}),
    },
  }
}

function extractList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  const record = asRecord(raw)
  if (record && Array.isArray(record.visualizations)) return record.visualizations
  if (record && typeof record.type === 'string') return [record]
  return []
}

export function normalizeVisualizations(
  raw: unknown,
  options: { maxVisualizations?: number } = {},
): NormalizeResult {
  const max = options.maxVisualizations ?? MAX_VISUALIZATIONS
  const list = extractList(raw)
  const visualizations: TutorVisualization[] = []
  const rejected: RejectedVisualization[] = []

  for (let index = 0; index < list.length && visualizations.length < max; index++) {
    const result = normalizeOne(list[index], index)
    if (result.ok) visualizations.push(result.value)
    else rejected.push({ index, reason: result.reason })
  }

  return { visualizations, rejected }
}
