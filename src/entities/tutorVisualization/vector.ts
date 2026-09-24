import type { VisualizationVector, VisualizationViewport } from './types'
import { DEFAULT_VIEWPORT } from './linear'
import { VECTOR_EPSILON } from './limits'

/**
 * Deterministic local maths for `vectors_2d`.
 *
 * The model supplies only components (and an optional start). Every endpoint,
 * every derived result and the viewport are computed here, so a wrong model
 * answer can never become a wrong drawing.
 */

export interface Vec2 {
  x: number
  y: number
}

export function vectorStart(vector: VisualizationVector): Vec2 {
  return vector.start ?? { x: 0, y: 0 }
}

/** `end = start + vector` — always local, never from the model. */
export function vectorEnd(vector: VisualizationVector): Vec2 {
  const start = vectorStart(vector)
  return { x: start.x + vector.x, y: start.y + vector.y }
}

export function addVectors(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function scaleVector(vector: Vec2, factor: number): Vec2 {
  return { x: vector.x * factor, y: vector.y * factor }
}

export function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

export function magnitude(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y)
}

export function approxEqual(a: number, b: number, epsilon = VECTOR_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon
}

export function approxEqualVector(a: Vec2, b: Vec2, epsilon = VECTOR_EPSILON): boolean {
  return approxEqual(a.x, b.x, epsilon) && approxEqual(a.y, b.y, epsilon)
}

export function isZeroVector(vector: Vec2, epsilon = VECTOR_EPSILON): boolean {
  return magnitude(vector) <= epsilon
}

/** True when `b` lies on the same line through the origin as `a`. */
export function isCollinear(a: Vec2, b: Vec2, epsilon = VECTOR_EPSILON): boolean {
  const scale = Math.max(1, magnitude(a) * magnitude(b))
  return Math.abs(cross2(a, b)) <= epsilon * scale
}

/**
 * Solve `b1·s + b2·t = target` for `s` and `t`. Returns `null` when `b1` and
 * `b2` are linearly dependent (the target cannot be uniquely expressed).
 */
export function spanCoefficients(
  b1: Vec2,
  b2: Vec2,
  target: Vec2,
): { s: number; t: number } | null {
  const det = cross2(b1, b2)
  if (Math.abs(det) <= VECTOR_EPSILON) return null
  const s = (target.x * b2.y - target.y * b2.x) / det
  const t = (b1.x * target.y - b1.y * target.x) / det
  if (!Number.isFinite(s) || !Number.isFinite(t)) return null
  return { s, t }
}

/**
 * A finite window containing every given point, with padding, a minimum span
 * and a hard magnitude cap. Always finite; empty input falls back to a default.
 */
export function computeBoundsViewport(points: Vec2[]): VisualizationViewport {
  const xs: number[] = []
  const ys: number[] = []
  for (const point of points) {
    if (Number.isFinite(point.x)) xs.push(point.x)
    if (Number.isFinite(point.y)) ys.push(point.y)
  }
  if (xs.length === 0 || ys.length === 0) return DEFAULT_VIEWPORT

  let xMin = Math.min(...xs)
  let xMax = Math.max(...xs)
  let yMin = Math.min(...ys)
  let yMax = Math.max(...ys)

  const padX = Math.max((xMax - xMin) * 0.15, 0.5)
  const padY = Math.max((yMax - yMin) * 0.15, 0.5)
  xMin -= padX
  xMax += padX
  yMin -= padY
  yMax += padY

  // Keep a minimum span so a tiny figure is not blown up absurdly.
  const minSpan = 4
  const expand = (min: number, max: number): [number, number] => {
    const span = max - min
    if (span >= minSpan) return [min, max]
    const center = (min + max) / 2
    return [center - minSpan / 2, center + minSpan / 2]
  }
  ;[xMin, xMax] = expand(xMin, xMax)
  ;[yMin, yMax] = expand(yMin, yMax)

  return { xMin, xMax, yMin, yMax }
}

/**
 * A window that contains the origin, every arrow start and every arrow end.
 * Fits the vectors themselves so a small vector is still readable.
 */
export function computeVectorViewport(vectors: VisualizationVector[]): VisualizationViewport {
  const points: Vec2[] = [{ x: 0, y: 0 }]
  for (const vector of vectors) {
    points.push(vectorStart(vector), vectorEnd(vector))
  }
  return computeBoundsViewport(points)
}
