import type { Matrix2x2, VisualizationViewport } from './types'
import { applyMatrix } from './transform'
import { computeBoundsViewport, isCollinear, magnitude, type Vec2 } from './vector'
import { VISUALIZATION_LIMITS } from './limits'

/**
 * Deterministic local maths for `eigen_2d`.
 *
 * The model supplies only a 2×2 real matrix (and, optionally, candidate
 * eigenpairs taken from the lesson). Every eigenvalue, eigenvector and the
 * `Av = λv` verification is computed here, so a wrong model answer can never
 * become a wrong drawing. There is no numerical iteration, no complex support
 * and no `eval`: a closed-form 2×2 solution is used.
 */

/** Tolerance for "the discriminant is zero" (a repeated eigenvalue). */
export const EIGEN_EPSILON = 1e-9
/** Relative tolerance for verifying `Av ≈ λv` and matching candidates. */
export const EIGEN_VERIFY_TOLERANCE = 1e-6
/** Below this norm a vector is treated as zero and never used as a direction. */
export const MIN_VECTOR_NORM = 1e-9
/** Largest absolute eigenvalue we are willing to draw. */
export const MAX_EIGEN_VALUE = 1e6

export interface EigenPair {
  value: number
  /** Unit vector with a deterministic sign. */
  vector: Vec2
  /** `A·v = λ·v`, computed locally. */
  transformed: Vec2
  label?: string
}

export type EigenSolveResult =
  | {
      ok: true
      pairs: EigenPair[]
      /** True when `A = λI`: the whole plane is the eigenspace. */
      fullEigenspace: boolean
      /** True when only one independent real eigenvector exists. */
      defective: boolean
      trace: number
      determinant: number
    }
  | { ok: false; reason: 'complex-eigenvalues' | 'non-finite' | 'out-of-range' }

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value
}

function allFinite(matrix: Matrix2x2): boolean {
  return (
    Number.isFinite(matrix.a) &&
    Number.isFinite(matrix.b) &&
    Number.isFinite(matrix.c) &&
    Number.isFinite(matrix.d)
  )
}

/**
 * A non-zero eigenvector for `λ`, or `null` if one cannot be built (which can
 * only happen for a malformed matrix).
 *
 * The two rows of `(A - λI)` are tried in turn; at least one is non-zero unless
 * `A = λI`, which the caller handles separately. The result is normalised and
 * given a deterministic sign so the same matrix always draws the same arrow.
 */
function eigenvectorFor(matrix: Matrix2x2, lambda: number): Vec2 | null {
  // Row 1: (a - λ)x + b·y = 0  →  (b, λ - a) is a solution.
  let x = matrix.b
  let y = lambda - matrix.a
  if (magnitude({ x, y }) <= MIN_VECTOR_NORM) {
    // Row 2: c·x + (d - λ)y = 0  →  (d - λ, -c) is a solution.
    x = matrix.d - lambda
    y = -matrix.c
  }
  const norm = magnitude({ x, y })
  if (!Number.isFinite(norm) || norm <= MIN_VECTOR_NORM) return null

  let nx = x / norm
  let ny = y / norm
  // Deterministic sign: prefer x > 0, then y > 0 when x ≈ 0.
  if (nx < 0 || (Math.abs(nx) <= EIGEN_EPSILON && ny < 0)) {
    nx = -nx
    ny = -ny
  }
  return { x: normalizeZero(nx), y: normalizeZero(ny) }
}

/**
 * Closed-form eigenvalues of a 2×2 real matrix.
 *
 * - two distinct real eigenvalues → two eigenpairs (descending by λ)
 * - a repeated eigenvalue → either the whole plane (`A = λI`) or a single
 *   eigen-direction (a defective matrix)
 * - a negative discriminant → `complex-eigenvalues`, which the caller refuses
 *   to draw rather than projecting a complex result onto the real plane
 */
export function solveEigen(matrix: Matrix2x2): EigenSolveResult {
  if (!allFinite(matrix)) return { ok: false, reason: 'non-finite' }
  const maxElement = Math.max(
    Math.abs(matrix.a),
    Math.abs(matrix.b),
    Math.abs(matrix.c),
    Math.abs(matrix.d),
  )
  if (maxElement > VISUALIZATION_LIMITS.maxMatrixElement) {
    return { ok: false, reason: 'out-of-range' }
  }

  const trace = matrix.a + matrix.d
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (!Number.isFinite(trace) || !Number.isFinite(determinant)) {
    return { ok: false, reason: 'non-finite' }
  }

  const discriminant = trace * trace - 4 * determinant
  const discEpsilon =
    EIGEN_EPSILON * Math.max(1, trace * trace, 4 * Math.abs(determinant))

  if (discriminant < -discEpsilon) {
    return { ok: false, reason: 'complex-eigenvalues' }
  }

  if (discriminant > discEpsilon) {
    const root = Math.sqrt(discriminant)
    const first = (trace + root) / 2
    const second = (trace - root) / 2
    if (Math.abs(first) > MAX_EIGEN_VALUE || Math.abs(second) > MAX_EIGEN_VALUE) {
      return { ok: false, reason: 'out-of-range' }
    }
    const v1 = eigenvectorFor(matrix, first)
    const v2 = eigenvectorFor(matrix, second)
    if (!v1 || !v2) return { ok: false, reason: 'non-finite' }
    return {
      ok: true,
      pairs: [
        { value: normalizeZero(first), vector: v1, transformed: applyMatrix(matrix, v1) },
        { value: normalizeZero(second), vector: v2, transformed: applyMatrix(matrix, v2) },
      ],
      fullEigenspace: false,
      defective: false,
      trace,
      determinant,
    }
  }

  // Repeated eigenvalue (discriminant ≈ 0).
  const lambda = trace / 2
  if (!Number.isFinite(lambda) || Math.abs(lambda) > MAX_EIGEN_VALUE) {
    return { ok: false, reason: 'out-of-range' }
  }
  const scalarEpsilon = EIGEN_EPSILON * Math.max(1, Math.abs(lambda), maxElement)
  const isScalar =
    Math.abs(matrix.b) <= scalarEpsilon &&
    Math.abs(matrix.c) <= scalarEpsilon &&
    Math.abs(matrix.a - lambda) <= scalarEpsilon &&
    Math.abs(matrix.d - lambda) <= scalarEpsilon

  if (isScalar) {
    // Every non-zero vector is an eigenvector; use the standard basis.
    const e1: Vec2 = { x: 1, y: 0 }
    const e2: Vec2 = { x: 0, y: 1 }
    return {
      ok: true,
      pairs: [
        { value: normalizeZero(lambda), vector: e1, transformed: applyMatrix(matrix, e1) },
        { value: normalizeZero(lambda), vector: e2, transformed: applyMatrix(matrix, e2) },
      ],
      fullEigenspace: true,
      defective: false,
      trace,
      determinant,
    }
  }

  const vector = eigenvectorFor(matrix, lambda)
  if (!vector) return { ok: false, reason: 'non-finite' }
  return {
    ok: true,
    pairs: [
      { value: normalizeZero(lambda), vector, transformed: applyMatrix(matrix, vector) },
    ],
    fullEigenspace: false,
    defective: true,
    trace,
    determinant,
  }
}

/**
 * Verify a candidate eigenpair against the matrix: `v` must be non-zero and
 * finite, `Av ≈ λv` within a relative tolerance, and `λ` must be finite.
 */
export function verifyEigenPair(
  matrix: Matrix2x2,
  value: number,
  vector: Vec2,
  tolerance = EIGEN_VERIFY_TOLERANCE,
): boolean {
  if (!Number.isFinite(value)) return false
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) return false
  const norm = magnitude(vector)
  if (!Number.isFinite(norm) || norm <= MIN_VECTOR_NORM) return false
  if (Math.abs(value) > MAX_EIGEN_VALUE) return false

  const image = applyMatrix(matrix, vector)
  if (!Number.isFinite(image.x) || !Number.isFinite(image.y)) return false
  const residual = Math.hypot(image.x - value * vector.x, image.y - value * vector.y)
  const scale = Math.max(1, Math.abs(value) * norm, norm)
  return residual <= tolerance * scale
}

/**
 * Match an untrusted candidate to a locally computed eigenpair.
 *
 * Returns the index of the matching local pair, or `null`. A multiple of the
 * local vector (including the opposite sign) is accepted as the same
 * direction, and `λ` must agree within a relative epsilon.
 */
export function matchEigenCandidate(
  candidate: { value: number; vector: Vec2 },
  pairs: EigenPair[],
): number | null {
  if (!Number.isFinite(candidate.value)) return null
  if (!Number.isFinite(candidate.vector.x) || !Number.isFinite(candidate.vector.y)) return null
  if (magnitude(candidate.vector) <= MIN_VECTOR_NORM) return null

  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index]!
    const valueEpsilon = EIGEN_EPSILON * Math.max(1, Math.abs(candidate.value), Math.abs(pair.value))
    if (Math.abs(candidate.value - pair.value) > valueEpsilon) continue
    if (isCollinear(candidate.vector, pair.vector, EIGEN_VERIFY_TOLERANCE)) return index
  }
  return null
}

/**
 * A window containing the origin, both eigen-directions (and their opposites)
 * and the transformed vectors. A unit circle, when shown, is also included.
 */
export function computeEigenViewport(
  pairs: EigenPair[],
  showUnitCircle: boolean,
): VisualizationViewport {
  const points: Vec2[] = [{ x: 0, y: 0 }]
  for (const pair of pairs) {
    points.push(pair.vector, { x: -pair.vector.x, y: -pair.vector.y })
    if (Number.isFinite(pair.transformed.x) && Number.isFinite(pair.transformed.y)) {
      points.push(pair.transformed, {
        x: -pair.transformed.x,
        y: -pair.transformed.y,
      })
    }
  }
  if (showUnitCircle) {
    points.push({ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 })
  }
  return computeBoundsViewport(points)
}
