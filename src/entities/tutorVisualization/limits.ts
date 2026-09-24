/**
 * Central limits for AI-proposed visualizations.
 *
 * Every cap lives here so the normalizer, the vector maths and the graph layout
 * all agree on the same numbers. Nothing in this file trusts the model.
 */
export const VISUALIZATION_LIMITS = {
  /** Per lesson. */
  maxVisualizations: 4,
  /** Per line/curve visualization. */
  maxExpressions: 6,
  /** Per points/table visualization. */
  maxPoints: 40,
  /** Per vectors_2d visualization. */
  maxVectors: 8,
  /** Per graph_2d visualization. */
  maxGraphNodes: 12,
  maxGraphEdges: 30,
  /** Per transform_2d visualization. */
  maxTransformVectors: 4,
  /** Per eigen_2d visualization: AI candidate eigenpairs (labels only). */
  maxEigenCandidates: 4,
  /** Largest absolute value of a 2×2 matrix element. */
  maxMatrixElement: 100,
  /** Largest absolute value of a transformed coordinate. */
  maxTransformCoordinate: 1e4,
  /** Largest number of grid lines drawn per axis. */
  maxGridLines: 21,
  /** Per venn_2d visualization. */
  maxVennSets: 3,
  maxSetElements: 12,
  maxUniverseElements: 24,
  maxElementLength: 20,
  /** Text. */
  maxCaptionLength: 300,
  maxLabelLength: 40,
  maxIdLength: 64,
  /** Largest absolute numeric value accepted anywhere. */
  maxMagnitude: 1e6,
} as const

/** Numeric tolerance used for local vector verification. */
export const VECTOR_EPSILON = 1e-6
