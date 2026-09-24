import type { Matrix2x2, TransformVector, VisualizationViewport } from './types'
import { computeBoundsViewport, type Vec2 } from './vector'

/**
 * Deterministic local maths for `transform_2d`.
 *
 * The model supplies only the 2×2 matrix and the input vectors. `A·v`, the
 * determinant, the transformed basis, the unit square and the area scale are
 * all computed here, so a wrong model answer can never become a wrong drawing.
 */

/** Tolerance for "the determinant is zero" (a degenerate transformation). */
export const DEGENERATE_EPSILON = 1e-6

export function applyMatrix(matrix: Matrix2x2, vector: Vec2): Vec2 {
  return {
    x: matrix.a * vector.x + matrix.b * vector.y,
    y: matrix.c * vector.x + matrix.d * vector.y,
  }
}

export function determinant(matrix: Matrix2x2): number {
  return matrix.a * matrix.d - matrix.b * matrix.c
}

export interface TransformVectorResult {
  id: string
  original: Vec2
  transformed: Vec2
  label?: string
  highlighted: boolean
}

export interface TransformGeometry {
  determinant: number
  areaScale: number
  degenerate: boolean
  orientationFlipped: boolean
  basis: { original: Vec2; transformed: Vec2 }[]
  unitSquare: Vec2[]
  transformedSquare: Vec2[]
  vectors: TransformVectorResult[]
}

export function computeTransform(
  matrix: Matrix2x2,
  vectors: TransformVector[],
): TransformGeometry {
  const det = determinant(matrix)
  const areaScale = Math.abs(det)
  const unitSquare: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]
  return {
    determinant: det,
    areaScale,
    degenerate: areaScale <= DEGENERATE_EPSILON,
    orientationFlipped: det < 0,
    basis: [
      { original: { x: 1, y: 0 }, transformed: applyMatrix(matrix, { x: 1, y: 0 }) },
      { original: { x: 0, y: 1 }, transformed: applyMatrix(matrix, { x: 0, y: 1 }) },
    ],
    unitSquare,
    transformedSquare: unitSquare.map((point) => applyMatrix(matrix, point)),
    vectors: vectors.map((vector) => {
      const original = { x: vector.x, y: vector.y }
      return {
        id: vector.id,
        original,
        transformed: applyMatrix(matrix, original),
        ...(vector.label ? { label: vector.label } : {}),
        highlighted: vector.highlighted === true,
      }
    }),
  }
}

/**
 * A window containing the origin, both bases, both transformed bases, the unit
 * square, the transformed parallelogram and every vector, before and after.
 */
export function computeTransformViewport(
  matrix: Matrix2x2,
  vectors: TransformVector[],
): VisualizationViewport {
  const points: Vec2[] = [{ x: 0, y: 0 }]
  const unit: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]
  points.push(...unit)
  for (const point of unit) points.push(applyMatrix(matrix, point))
  for (const basis of [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]) {
    points.push(basis, applyMatrix(matrix, basis))
  }
  for (const vector of vectors) {
    const original = { x: vector.x, y: vector.y }
    points.push(original, applyMatrix(matrix, original))
  }
  return computeBoundsViewport(points)
}
