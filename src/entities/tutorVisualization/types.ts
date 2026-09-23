/**
 * Structured 2D mathematical visualizations attached to a `TutorLesson`.
 *
 * The AI never produces SVG, HTML or JavaScript. It returns *structured
 * mathematical data* (canonical LaTeX plus numeric points); a deterministic,
 * local renderer turns that into SVG. This keeps the graph safe, reproducible
 * and theme-aware.
 *
 * These types are the *stored* shape. The tolerant shape the model returns is
 * `VisualizationDraft` below; `normalize.ts` converts one into the other.
 */

/**
 * Shape version of a stored visualization.
 *
 * Deliberately separate from the Dexie database version and from
 * `TUTOR_LESSON_VERSION`: this only changes when the visualization *data*
 * shape changes.
 */
export const TUTOR_VISUALIZATION_SCHEMA_VERSION = 1

export type TutorVisualizationType =
  'function_2d' | 'equation_2d' | 'inequality_2d' | 'points_2d' | 'table_2d'

export type VisualizationRelation = '=' | '<' | '<=' | '>' | '>='

/** Optional presentation window. Never required from the model. */
export interface VisualizationViewport {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/**
 * One mathematical relation in a line graph.
 *
 * `latex` is the canonical, user-visible representation (e.g. `y = 2x + 1`).
 * `relation` is derived locally from that LaTeX — it is never trusted from the
 * model on its own.
 */
export interface VisualizationExpression {
  latex: string
  relation: VisualizationRelation
  /** Optional series label the model explicitly supplied. */
  label?: string
  /**
   * Explicit function of `x` for a nonlinear `function_2d` curve, in the
   * restricted plain syntax the local parser accepts (e.g. `x^2 + 2x + 1`,
   * `sin(x)`, `2*exp(-x)`). Canonical display remains `latex`. Only ever set
   * after the local AST whitelist has accepted it.
   */
  expression?: string
  /** Optional explicit domain for a nonlinear curve. */
  domain?: { min: number; max: number }
}

export interface VisualizationPoint {
  x: number
  y: number
  label?: string
}

/**
 * Where the visualization belongs.
 *
 * Phase 1 places visualizations at the lesson level, matching the existing
 * `TutorLesson.visuals` precedent: the Markdown pipeline has no stable
 * block-level ids, and inventing a fragile index-based anchor would be worse
 * than a deliberate lesson-level section.
 */
export interface VisualizationPlacement {
  scope: 'lesson'
}

interface TutorVisualizationBase {
  /** Stable within a lesson; generated locally, never from the model. */
  id: string
  schemaVersion: number
  caption?: string
  placement: VisualizationPlacement
  /** Optional; when absent or invalid the renderer chooses its own window. */
  viewport?: VisualizationViewport
}

/** A function, equation or inequality drawn as one or more straight lines. */
export interface LineVisualization extends TutorVisualizationBase {
  type: 'function_2d' | 'equation_2d' | 'inequality_2d'
  expressions: VisualizationExpression[]
}

/** Explicit points. */
export interface PointsVisualization extends TutorVisualizationBase {
  type: 'points_2d'
  points: VisualizationPoint[]
  /** Connect the points in the given order. */
  connect?: boolean
}

/** An explicit x → y data table, optionally also plotted. */
export interface TableVisualization extends TutorVisualizationBase {
  type: 'table_2d'
  points: VisualizationPoint[]
  connect?: boolean
}

export type TutorVisualization = LineVisualization | PointsVisualization | TableVisualization

export const LINE_VISUALIZATION_TYPES = ['function_2d', 'equation_2d', 'inequality_2d'] as const

export function isLineVisualization(
  visualization: TutorVisualization,
): visualization is LineVisualization {
  return (LINE_VISUALIZATION_TYPES as readonly string[]).includes(visualization.type)
}

export function isTableVisualization(
  visualization: TutorVisualization,
): visualization is TableVisualization {
  return visualization.type === 'table_2d'
}

/**
 * The tolerant JSON shape the model returns, before validation.
 *
 * Every field is `unknown`-ish on purpose: nothing here is trusted until
 * `normalizeVisualizations()` has checked it.
 */
export interface VisualizationDraft {
  type?: unknown
  caption?: unknown
  viewport?: unknown
  expressions?: unknown
  points?: unknown
  connectPoints?: unknown
}

export interface VisualizationDraftOutput {
  visualizations?: unknown
}
