import type { DistributionParams, ProbabilityInterval } from './distribution'
import type { EnergyState, TitrationSetup } from './chemistry'
import type { Dominance, PedigreeMember } from './biology'

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
 * shape changes. v2 added `vectors_2d` and `graph_2d`; v3 added `transform_2d`
 * and `venn_2d`; v4 added `eigen_2d`; v5 added `hasse_2d`; v6 added
 * `distribution_2d`; v7 added the chemistry figures (`molecule_2d`,
 * `energy_2d`, `titration_2d`) and the biology figures (`punnett_2d`,
 * `pedigree_2d`, `translation_2d`). Older rows are still read and rendered
 * unchanged.
 */
export const TUTOR_VISUALIZATION_SCHEMA_VERSION = 7

export type TutorVisualizationType =
  | 'function_2d'
  | 'equation_2d'
  | 'inequality_2d'
  | 'points_2d'
  | 'table_2d'
  | 'vectors_2d'
  | 'graph_2d'
  | 'transform_2d'
  | 'venn_2d'
  | 'eigen_2d'
  | 'hasse_2d'
  | 'distribution_2d'
  | 'molecule_2d'
  | 'energy_2d'
  | 'titration_2d'
  | 'punnett_2d'
  | 'pedigree_2d'
  | 'translation_2d'

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
 * Lesson-level is the original, safe placement. Section-level anchors a
 * visualization to a recognised teaching block (e.g. after the second
 * `Example`), which lets a figure sit next to the example it illustrates
 * without the model controlling a React key. The anchor is validated locally
 * against the lesson's real sections; if it does not resolve, the figure falls
 * back to lesson level.
 */
export const PLACEMENT_BLOCKS = [
  'definition',
  'keyIdea',
  'example',
  'workedExample',
  'important',
  'warning',
  'note',
  'commonMistake',
  'explanation',
  'intuition',
  'summary',
  'overview',
] as const

export type PlacementBlock = (typeof PLACEMENT_BLOCKS)[number]

export type VisualizationPlacement =
  | { scope: 'lesson' }
  | { scope: 'section'; block: PlacementBlock; index: number }

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

/** Semantic role of a vector, used for non-colour styling and the legend. */
export type VectorRole = 'vector' | 'basis' | 'component' | 'result'

export type VectorOperation =
  | 'display'
  | 'addition'
  | 'scalar_multiplication'
  | 'linear_combination'
  | 'basis'

/**
 * One arrow. `x`/`y` are components; the endpoint is always computed locally as
 * `start + vector`. The model never supplies coordinates, only components.
 */
export interface VisualizationVector {
  id: string
  x: number
  y: number
  label?: string
  start?: { x: number; y: number }
  role?: VectorRole
  highlighted?: boolean
}

export interface VectorsVisualization extends TutorVisualizationBase {
  type: 'vectors_2d'
  vectors: VisualizationVector[]
  operation: VectorOperation
}

export type GraphKind = 'undirected' | 'directed'
export type GraphLayoutKind = 'circular' | 'bipartite' | 'hierarchical'

/**
 * A graph node. The model supplies an id and a plain-text label; coordinates
 * are computed by the local layout. `partition` is only used for the bipartite
 * layout and is validated (and otherwise ignored).
 */
export interface GraphNode {
  id: string
  label: string
  partition?: 'left' | 'right'
  highlighted?: boolean
}

/**
 * A graph edge. The model supplies the endpoints and optional label/weight;
 * geometry (trimming, arrows, self-loops) is computed locally.
 */
export interface GraphEdge {
  source: string
  target: string
  label?: string
  weight?: number
  directed?: boolean
  highlighted?: boolean
}

export interface GraphVisualization extends TutorVisualizationBase {
  type: 'graph_2d'
  graphKind: GraphKind
  layout: GraphLayoutKind
  nodes: GraphNode[]
  edges: GraphEdge[]
  rootId?: string
}

/** A 2×2 real matrix, row-major: `[[a, b], [c, d]]`. */
export interface Matrix2x2 {
  a: number
  b: number
  c: number
  d: number
}

export interface TransformVector {
  id: string
  x: number
  y: number
  label?: string
  highlighted?: boolean
}

/**
 * A 2D linear transformation. The model supplies the matrix and the input
 * vectors; `A·v`, the determinant, the transformed basis, the unit square and
 * the area scale are all computed locally.
 */
export interface TransformVisualization extends TutorVisualizationBase {
  type: 'transform_2d'
  matrix: Matrix2x2
  vectors: TransformVector[]
  showBasis: boolean
  showUnitSquare: boolean
  showGrid: boolean
  showArea: boolean
}

/** One eigenpair, always computed and verified locally. */
export interface EigenCandidate {
  value: number
  /** Unit eigenvector with a deterministic sign. */
  vector: { x: number; y: number }
  label?: string
}

/**
 * A 2D eigenvector diagram for a 2×2 real matrix.
 *
 * The model supplies only the matrix (and optional candidate eigenpairs used
 * to label the lesson's example); every eigenvalue, eigenvector and the
 * `Av = λv` check are computed locally. A matrix without real eigenvalues is
 * never drawn as a real eigen-direction.
 */
export interface Eigen2DVisualization extends TutorVisualizationBase {
  type: 'eigen_2d'
  matrix: Matrix2x2
  eigenpairs: EigenCandidate[]
  /** True when `A = λI`: every non-zero vector is an eigenvector. */
  fullEigenspace: boolean
  /** True when only one independent real eigenvector exists. */
  defective: boolean
  showUnitCircle: boolean
  showTransform: boolean
}

export interface VennSet {
  id: string
  label: string
  elements: string[]
}

export type VennOperation =
  | 'union'
  | 'intersection'
  | 'difference'
  | 'symmetric_difference'
  | 'complement'
  | 'display'

/**
 * A 2–3 set Venn diagram. The model supplies the sets, the operation and the
 * operand ids; region membership and the operation result are computed locally.
 */
export interface VennVisualization extends TutorVisualizationBase {
  type: 'venn_2d'
  sets: VennSet[]
  universe?: string[]
  operation: VennOperation
  operands: string[]
}

/** A finite partially ordered set. `relations` contains asserted x <= y pairs. */
export interface HasseVisualization extends TutorVisualizationBase {
  type: 'hasse_2d'
  elements: { id: string; label: string }[]
  relations: { lower: string; upper: string }[]
}

/**
 * A probability distribution (normal, binomial, Poisson, uniform,
 * exponential), optionally with a shaded interval. The model supplies only the
 * family, parameters and interval from the lesson; densities, the interval
 * probability, mean and variance are computed locally.
 */
export interface DistributionVisualization extends TutorVisualizationBase {
  type: 'distribution_2d'
  params: DistributionParams
  interval?: ProbabilityInterval
}

/** One structure in a molecule figure; `formula` is computed from `smiles`. */
export interface MoleculeEntry {
  smiles: string
  formula: string
  name?: string
}

/**
 * Skeletal structures drawn locally from SMILES. The model also names the
 * formula the lesson states; a SMILES string whose computed formula disagrees
 * is rejected, so a mistyped structure never reaches the student.
 */
export interface MoleculeVisualization extends TutorVisualizationBase {
  type: 'molecule_2d'
  molecules: MoleculeEntry[]
}

/** A reaction energy profile; ΔH and Eₐ are computed from the states. */
export interface EnergyVisualization extends TutorVisualizationBase {
  type: 'energy_2d'
  states: EnergyState[]
  unit: string
}

/** A monoprotic acid titrated with a strong base; every pH is computed. */
export interface TitrationVisualization extends TutorVisualizationBase {
  type: 'titration_2d'
  setup: TitrationSetup
  acidLabel?: string
  baseLabel?: string
}

/** Optional phenotype names for one gene of a Punnett square. */
export interface PunnettTrait {
  gene: string
  dominant: string
  recessive: string
  intermediate?: string
}

/** A Punnett square; gametes, offspring and ratios are computed. */
export interface PunnettVisualization extends TutorVisualizationBase {
  type: 'punnett_2d'
  mother: string
  father: string
  dominance: Dominance
  traits: PunnettTrait[]
}

/** A family pedigree; generations and layout are computed. */
export interface PedigreeVisualization extends TutorVisualizationBase {
  type: 'pedigree_2d'
  members: PedigreeMember[]
}

/** DNA → mRNA → amino acids, transcribed and translated locally. */
export interface TranslationVisualization extends TutorVisualizationBase {
  type: 'translation_2d'
  dna: string
  strand: 'coding' | 'template'
}

export type TutorVisualization =
  | LineVisualization
  | PointsVisualization
  | TableVisualization
  | VectorsVisualization
  | GraphVisualization
  | TransformVisualization
  | VennVisualization
  | Eigen2DVisualization
  | HasseVisualization
  | DistributionVisualization
  | MoleculeVisualization
  | EnergyVisualization
  | TitrationVisualization
  | PunnettVisualization
  | PedigreeVisualization
  | TranslationVisualization

/** Chemistry and biology figures, drawn by their own renderer. */
export const SCIENCE_VISUALIZATION_TYPES = [
  'molecule_2d',
  'energy_2d',
  'titration_2d',
  'punnett_2d',
  'pedigree_2d',
  'translation_2d',
] as const

export type ScienceVisualization =
  | MoleculeVisualization
  | EnergyVisualization
  | TitrationVisualization
  | PunnettVisualization
  | PedigreeVisualization
  | TranslationVisualization

export function isScienceVisualization(
  visualization: TutorVisualization,
): visualization is ScienceVisualization {
  return (SCIENCE_VISUALIZATION_TYPES as readonly string[]).includes(visualization.type)
}

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
  // vectors_2d
  vectors?: unknown
  operation?: unknown
  // graph_2d
  nodes?: unknown
  edges?: unknown
  graphKind?: unknown
  layout?: unknown
  rootId?: unknown
  // transform_2d
  matrix?: unknown
  showBasis?: unknown
  showUnitSquare?: unknown
  showGrid?: unknown
  showArea?: unknown
  // venn_2d
  sets?: unknown
  universe?: unknown
  operands?: unknown
  // eigen_2d
  eigenpairs?: unknown
  showUnitCircle?: unknown
  showTransform?: unknown
  // hasse_2d
  elements?: unknown
  relations?: unknown
  // distribution_2d
  family?: unknown
  params?: unknown
  interval?: unknown
  // molecule_2d
  molecules?: unknown
  // energy_2d
  states?: unknown
  unit?: unknown
  // titration_2d
  acidConcentration?: unknown
  acidVolume?: unknown
  baseConcentration?: unknown
  ka?: unknown
  acidLabel?: unknown
  baseLabel?: unknown
  // punnett_2d
  mother?: unknown
  father?: unknown
  dominance?: unknown
  traits?: unknown
  // pedigree_2d
  members?: unknown
  // translation_2d
  dna?: unknown
  strand?: unknown
  // placement (all types)
  placement?: unknown
}

export interface VisualizationDraftOutput {
  visualizations?: unknown
}
