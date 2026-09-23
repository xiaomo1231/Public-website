import { parse, type MathNode } from 'mathjs'
import type { VisualizationPoint, VisualizationRelation, VisualizationViewport } from './types'

/**
 * Deterministic linear-relation maths for the 2D renderer.
 *
 * Only the supported subset from the Phase 1 spec is understood:
 *   x, y, numbers, + - * /, parentheses, and the relations = < <= > >=.
 *
 * Anything else (powers, functions, two-variable products) returns `null`, and
 * the caller drops the visualization rather than guessing a graph. There is no
 * `eval`, no `new Function`, and no LaTeX execution: mathjs parses the
 * normalised expression into an AST which is walked symbolically.
 */

/** Canonical linear form `a·x + b·y = c`. */
export interface LinearForm {
  a: number
  b: number
  c: number
}

/** A line the renderer can draw. */
export type LineSpec = { kind: 'slope'; m: number; b: number } | { kind: 'vertical'; x: number }

export interface ParsedRelation {
  form: LinearForm
  relation: VisualizationRelation
  line: LineSpec
}

const RELATION_PATTERN = /(<=|>=|=|<|>)/
const EPS = 1e-12
const MAX_MAGNITUDE = 1e9

/**
 * Expand simple `\frac{a}{b}` into `((a)/(b))`. Nested braces are deliberately
 * not supported — if the fraction does not match, parsing fails and the
 * visualization is omitted.
 */
function expandFractions(input: string): string {
  let out = input
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))')
    if (next === out) break
    out = next
  }
  return out
}

/**
 * Reduce a LaTeX relation to the plain syntax mathjs parses. This is a
 * *conservative* normaliser: it only rewrites constructs it fully understands.
 */
export function normalizeLatexMath(input: string): string {
  return expandFractions(input)
    .replace(/\\left|\\right/g, '')
    .replace(/\\leq|\\le(?![a-zA-Z])/g, '<=')
    .replace(/\\geq|\\ge(?![a-zA-Z])/g, '>=')
    .replace(/\\lt(?![a-zA-Z])/g, '<')
    .replace(/\\gt(?![a-zA-Z])/g, '>')
    .replace(/\\(?:cdot|times|ast)/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\(?:,|;|:|!|quad|qquad|thinspace|medspace|thickspace)/g, ' ')
    .replace(/~/g, ' ')
    .replace(/\\[()[\]{}$]/g, '')
    .replace(/[$]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∗]/g, '*')
    .replace(/÷/g, '/')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/\s+/g, ' ')
    .trim()
}

interface NodeLike {
  type: string
  value?: unknown
  name?: unknown
  op?: unknown
  args?: unknown
  content?: unknown
}

function isConstant(form: LinearForm): boolean {
  return form.a === 0 && form.b === 0
}

function isFiniteForm(form: LinearForm): boolean {
  return (
    Number.isFinite(form.a) &&
    Number.isFinite(form.b) &&
    Number.isFinite(form.c) &&
    Math.abs(form.a) <= MAX_MAGNITUDE &&
    Math.abs(form.b) <= MAX_MAGNITUDE &&
    Math.abs(form.c) <= MAX_MAGNITUDE
  )
}

function addForms(left: LinearForm | null, right: LinearForm | null): LinearForm | null {
  if (!left || !right) return null
  return { a: left.a + right.a, b: left.b + right.b, c: left.c + right.c }
}

function subForms(left: LinearForm | null, right: LinearForm | null): LinearForm | null {
  if (!left || !right) return null
  return { a: left.a - right.a, b: left.b - right.b, c: left.c - right.c }
}

function scaleForm(form: LinearForm, factor: number): LinearForm {
  return { a: form.a * factor, b: form.b * factor, c: form.c * factor }
}

/** Walk a parsed node and reduce it to a linear form, or `null`. */
function linearize(node: MathNode): LinearForm | null {
  const n = node as unknown as NodeLike
  switch (n.type) {
    case 'ConstantNode': {
      const value = Number(n.value)
      return Number.isFinite(value) ? { a: 0, b: 0, c: value } : null
    }
    case 'SymbolNode': {
      const name = String(n.name)
      if (name === 'x') return { a: 1, b: 0, c: 0 }
      if (name === 'y') return { a: 0, b: 1, c: 0 }
      return null
    }
    case 'ParenthesisNode': {
      return n.content ? linearize(n.content as MathNode) : null
    }
    case 'OperatorNode': {
      const op = String(n.op)
      const args = (n.args as MathNode[] | undefined) ?? []
      if (op === '+') {
        if (args.length === 1) return linearize(args[0])
        if (args.length === 2) return addForms(linearize(args[0]), linearize(args[1]))
      }
      if (op === '-') {
        if (args.length === 1) {
          const inner = linearize(args[0])
          return inner ? scaleForm(inner, -1) : null
        }
        if (args.length === 2) return subForms(linearize(args[0]), linearize(args[1]))
      }
      if (op === '*' && args.length === 2) {
        const left = linearize(args[0])
        const right = linearize(args[1])
        if (!left || !right) return null
        if (isConstant(left)) return scaleForm(right, left.c)
        if (isConstant(right)) return scaleForm(left, right.c)
        return null
      }
      if (op === '/' && args.length === 2) {
        const left = linearize(args[0])
        const right = linearize(args[1])
        if (!left || !right || !isConstant(right) || right.c === 0) return null
        return scaleForm(left, 1 / right.c)
      }
      return null
    }
    default:
      return null
  }
}

/** Avoid `-0` leaking into geometry, coordinates or ticks. */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value
}

/** `a·x + b·y = c` → a drawable line, or `null` for a degenerate relation. */
export function toLine(form: LinearForm): LineSpec | null {
  if (!isFiniteForm(form)) return null
  if (Math.abs(form.b) > EPS) {
    const m = normalizeZero(-form.a / form.b)
    const b = normalizeZero(form.c / form.b)
    return Number.isFinite(m) && Number.isFinite(b) ? { kind: 'slope', m, b } : null
  }
  if (Math.abs(form.a) > EPS) {
    const x = normalizeZero(form.c / form.a)
    return Number.isFinite(x) ? { kind: 'vertical', x } : null
  }
  return null
}

/**
 * Parse one canonical LaTeX relation (e.g. `y = 2x + 1`, `y \ge 2x - 1`,
 * `x = 2`). Returns `null` for anything outside the supported subset.
 */
export function parseRelationLatex(latex: string): ParsedRelation | null {
  if (typeof latex !== 'string') return null
  const trimmed = latex.trim()
  if (!trimmed || trimmed.length > 200) return null

  const normalized = normalizeLatexMath(trimmed)
  const match = RELATION_PATTERN.exec(normalized)
  if (!match) return null

  const relation = match[1] as VisualizationRelation
  const lhsText = normalized.slice(0, match.index).trim()
  const rhsText = normalized.slice(match.index + match[1].length).trim()
  if (!lhsText || !rhsText) return null

  let lhs: MathNode
  let rhs: MathNode
  try {
    lhs = parse(lhsText)
    rhs = parse(rhsText)
  } catch {
    return null
  }

  const left = linearize(lhs)
  const right = linearize(rhs)
  if (!left || !right) return null

  // lhs = rhs  →  (l.a - r.a)x + (l.b - r.b)y = (r.c - l.c)
  const form: LinearForm = { a: left.a - right.a, b: left.b - right.b, c: right.c - left.c }
  const line = toLine(form)
  if (!line) return null

  return {
    form: { ...form, a: normalizeZero(form.a), b: normalizeZero(form.b), c: normalizeZero(form.c) },
    relation,
    line,
  }
}

export function isStrictRelation(relation: VisualizationRelation): boolean {
  return relation === '<' || relation === '>'
}

/** True when the relation is an inequality (shaded region). */
export function isInequality(relation: VisualizationRelation): boolean {
  return relation !== '='
}

export type ShadeDirection = 'above' | 'below' | 'left' | 'right'

/**
 * Which half-plane a relation shades.
 *
 * For `b > 0` the relation reads directly in y; for `b < 0` dividing by `b`
 * flips it. For `b ≈ 0` the line is vertical and the shading is horizontal.
 */
export function shadeDirection(
  form: LinearForm,
  relation: VisualizationRelation,
): ShadeDirection | null {
  if (!isInequality(relation)) return null
  const greater = relation.startsWith('>')
  if (Math.abs(form.b) > EPS) {
    return form.b > 0 === greater ? 'above' : 'below'
  }
  if (Math.abs(form.a) > EPS) {
    return form.a > 0 === greater ? 'right' : 'left'
  }
  return null
}

/** Intersection of two lines, or `null` when parallel/coincident. */
export function lineIntersection(
  first: LinearForm,
  second: LinearForm,
): { x: number; y: number } | null {
  const det = first.a * second.b - second.a * first.b
  if (Math.abs(det) < EPS) return null
  const x = (first.c * second.b - second.c * first.b) / det
  const y = (first.a * second.c - second.a * first.c) / det
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

export const DEFAULT_VIEWPORT: VisualizationViewport = {
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10,
}

/**
 * Validate a model-supplied viewport. Anything non-finite, reversed or
 * absurdly large is rejected so the renderer falls back to its own window.
 */
export function normalizeViewport(raw: unknown): VisualizationViewport | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  const read = (key: string): number | null => {
    const value = Number(source[key])
    return Number.isFinite(value) && Math.abs(value) <= MAX_MAGNITUDE ? value : null
  }
  const xMin = read('xMin')
  const xMax = read('xMax')
  const yMin = read('yMin')
  const yMax = read('yMax')
  if (xMin === null || xMax === null || yMin === null || yMax === null) return undefined
  if (xMax - xMin <= 1e-6 || yMax - yMin <= 1e-6) return undefined
  if (xMax - xMin > 1e6 || yMax - yMin > 1e6) return undefined
  return { xMin, xMax, yMin, yMax }
}

/**
 * A sensible default window: start at [-10, 10]², then grow to include every
 * point the graph actually has (intercepts, explicit points). The model never
 * has to supply a viewport.
 */
export function computeAutoViewport(
  forms: LinearForm[],
  points: VisualizationPoint[],
): VisualizationViewport {
  let xMin = DEFAULT_VIEWPORT.xMin
  let xMax = DEFAULT_VIEWPORT.xMax
  let yMin = DEFAULT_VIEWPORT.yMin
  let yMax = DEFAULT_VIEWPORT.yMax

  const include = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (Math.abs(x) > MAX_MAGNITUDE || Math.abs(y) > MAX_MAGNITUDE) return
    xMin = Math.min(xMin, x)
    xMax = Math.max(xMax, x)
    yMin = Math.min(yMin, y)
    yMax = Math.max(yMax, y)
  }

  for (const form of forms) {
    const line = toLine(form)
    if (!line) continue
    if (line.kind === 'vertical') {
      include(line.x, 0)
    } else {
      include(0, line.b)
      if (Math.abs(line.m) > EPS) include(-line.b / line.m, 0)
    }
  }
  for (const point of points) include(point.x, point.y)

  // Pad by 10% so points are not glued to the frame, and keep a minimum span.
  const padX = Math.max((xMax - xMin) * 0.1, 0.5)
  const padY = Math.max((yMax - yMin) * 0.1, 0.5)
  return {
    xMin: xMin - padX,
    xMax: xMax + padX,
    yMin: yMin - padY,
    yMax: yMax + padY,
  }
}

/**
 * Widen one axis so the world window matches the plot's pixel aspect ratio.
 *
 * Without this a unit step in x and a unit step in y would occupy different
 * numbers of pixels, and a slope of 1 would not look like a 45° line. The
 * window is only ever *expanded*, never cropped.
 */
export function fitViewport(
  viewport: VisualizationViewport,
  aspect: number,
): VisualizationViewport {
  if (!Number.isFinite(aspect) || aspect <= 0) return viewport
  const xRange = viewport.xMax - viewport.xMin
  const yRange = viewport.yMax - viewport.yMin
  if (xRange / yRange > aspect) {
    const center = (viewport.yMin + viewport.yMax) / 2
    const nextRange = xRange / aspect
    return { ...viewport, yMin: center - nextRange / 2, yMax: center + nextRange / 2 }
  }
  const center = (viewport.xMin + viewport.xMax) / 2
  const nextRange = yRange * aspect
  return { ...viewport, xMin: center - nextRange / 2, xMax: center + nextRange / 2 }
}

/** A "nice" axis tick step (1, 2 or 5 × 10ⁿ) for the given span. */
export function niceTickStep(span: number, targetCount = 8): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const rough = span / Math.max(1, targetCount)
  const power = Math.floor(Math.log10(rough))
  const base = Math.pow(10, power)
  const normalized = rough / base
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return step * base
}

/** Format a tick value compactly, avoiding floating-point noise. */
export function formatTick(value: number): string {
  if (Math.abs(value) < 1e-9) return '0'
  const rounded = Number(value.toFixed(2))
  if (Number.isInteger(rounded)) return String(rounded)
  return String(rounded)
}
