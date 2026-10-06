import type { DistributionParams, ProbabilityInterval } from './distribution'
import type { EnergyState, LegacyTitrationSetup, TitrationSetup } from './chemistry'
import type { Dominance, PedigreeMember, WrittenDirection } from './biology'
import type { ChiSquareCategory } from './chiSquare'
import type { RiemannMethod } from './formula'
import type { CircuitNode, Force, MotionSegment, OpticalElement } from './physics'
import type { GrowthModel, Inhibitor, ReactionOrder } from './models'
import type { SortAlgorithm } from './algorithms'
import type {
  CardiacInput,
  Dentition,
  DosingRegimen,
  IonConcentration,
  IonizableGroup,
  LungVolumes,
  MetabolicStep,
  PoConvention,
  Shuttle,
  StarlingForces,
} from './medicine'

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
 * `pedigree_2d`, `translation_2d`); v8 added `chisquare_test_2d`, t / χ² / F
 * distributions, polyprotic-acid and weak-base titrations, X-linked and
 * multiple-allele crosses, and an explicit strand direction and start codon
 * for translation; v9 added the interactive formula explorer and figures for
 * calculus (tangent, Riemann sums, Taylor), physics (forces, motion, optics,
 * circuits), statistics (regression, confidence intervals), chemistry
 * (kinetics, Arrhenius), biology (enzyme kinetics, population growth) and
 * computer science (sorting, BSTs); v10 added the medical figures (membrane
 * and action potentials, oxygen binding, the cardiac PV loop, lung volumes,
 * renal filtration, acid–base, amino acids, energy yield, pharmacokinetics,
 * the dental chart, timelines, neural pathways and anatomy tables). Older
 * rows are still read and rendered unchanged.
 */
export const TUTOR_VISUALIZATION_SCHEMA_VERSION = 10

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
  | 'chisquare_test_2d'
  | 'formula_2d'
  | 'tangent_2d'
  | 'riemann_2d'
  | 'taylor_2d'
  | 'forces_2d'
  | 'motion_2d'
  | 'optics_2d'
  | 'circuit_2d'
  | 'regression_2d'
  | 'confidence_interval_2d'
  | 'kinetics_2d'
  | 'arrhenius_2d'
  | 'enzyme_2d'
  | 'population_2d'
  | 'sorting_2d'
  | 'bst_2d'
  | 'membrane_potential_2d'
  | 'action_potential_2d'
  | 'oxygen_2d'
  | 'cardiac_2d'
  | 'lung_volumes_2d'
  | 'renal_2d'
  | 'acid_base_2d'
  | 'amino_acid_2d'
  | 'metabolism_2d'
  | 'pharmacokinetics_2d'
  | 'dental_chart_2d'
  | 'timeline_2d'
  | 'neural_pathway_2d'
  | 'anatomy_table_2d'

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

/**
 * An acid (strong, or weak with up to three Kₐ) titrated with a strong base,
 * or a base (strong, or weak with K_b) titrated with a strong acid; every pH
 * is computed. Rows stored at schema v7 use the legacy monoprotic shape and
 * `acidLabel` / `baseLabel`.
 */
export interface TitrationVisualization extends TutorVisualizationBase {
  type: 'titration_2d'
  setup: TitrationSetup | LegacyTitrationSetup
  analyteLabel?: string
  titrantLabel?: string
  acidLabel?: string
  baseLabel?: string
}

/** Optional phenotype names for one gene of a Punnett square. */
export interface PunnettTrait {
  /** The gene's letter, e.g. `a` for A/a, `i` for I^A/I^B/i, `b` for X^B/X^b. */
  gene: string
  dominant?: string
  recessive?: string
  /** The heterozygote's phenotype under incomplete dominance or codominance. */
  intermediate?: string
  /** Names per allele for multiple alleles, e.g. I^A → "A", i → "O". */
  alleles?: Array<{ allele: string; name: string }>
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

/**
 * DNA → mRNA → amino acids, transcribed and translated locally. `direction`
 * and `start` are absent on v7 rows (legacy reading: coding 5′→3′, template
 * 3′→5′, from the first base).
 */
export interface TranslationVisualization extends TutorVisualizationBase {
  type: 'translation_2d'
  dna: string
  strand: 'coding' | 'template'
  direction?: WrittenDirection
  start?: 'aug' | 'first'
}

/** A χ² goodness-of-fit test; expected counts, χ², p and the verdict are computed. */
export interface ChiSquareTestVisualization extends TutorVisualizationBase {
  type: 'chisquare_test_2d'
  categories: ChiSquareCategory[]
  df: number
  alpha: number
}

/** A slider-controlled parameter of a formula. */
export interface FormulaParameter {
  name: string
  value: number
  min: number
  max: number
  step: number
  label?: string
  unit?: string
}

/**
 * Interactive formula explorer: 1–4 curves y(variable) sharing parameters the
 * student can change with sliders; every point is computed locally.
 */
export interface FormulaVisualization extends TutorVisualizationBase {
  type: 'formula_2d'
  variable: string
  curves: Array<{ expression: string; label?: string }>
  params: FormulaParameter[]
  domain: { min: number; max: number }
  xLabel?: string
  yLabel?: string
}

/** Tangent line (and secant) to f at a movable point; f′ is computed symbolically. */
export interface TangentVisualization extends TutorVisualizationBase {
  type: 'tangent_2d'
  expression: string
  variable: string
  point: number
  domain: { min: number; max: number }
  showSecant: boolean
}

/** Riemann sums converging to ∫ₐᵇ f; the integral is computed numerically. */
export interface RiemannVisualization extends TutorVisualizationBase {
  type: 'riemann_2d'
  expression: string
  variable: string
  a: number
  b: number
  n: number
  method: RiemannMethod
}

/** Taylor polynomials of increasing order around a centre. */
export interface TaylorVisualization extends TutorVisualizationBase {
  type: 'taylor_2d'
  expression: string
  variable: string
  center: number
  order: number
  domain: { min: number; max: number }
}

/** Free-body diagram; the net force and acceleration are computed. */
export interface ForcesVisualization extends TutorVisualizationBase {
  type: 'forces_2d'
  body?: string
  forces: Force[]
  unit: string
  mass?: number
  /** Incline angle in degrees (surface rising to the right). */
  incline?: number
}

/** x–t, v–t and a–t graphs from piecewise-constant acceleration. */
export interface MotionVisualization extends TutorVisualizationBase {
  type: 'motion_2d'
  x0: number
  v0: number
  segments: MotionSegment[]
}

/** Ray diagram for a thin lens or spherical mirror. */
export interface OpticsVisualization extends TutorVisualizationBase {
  type: 'optics_2d'
  element: OpticalElement
  focalLength: number
  objectDistance: number
  objectHeight: number
}

/** A series–parallel resistor network across an ideal source. */
export interface CircuitVisualization extends TutorVisualizationBase {
  type: 'circuit_2d'
  voltage: number
  network: CircuitNode
}

/** Scatter plot with the least-squares line and confidence / prediction bands. */
export interface RegressionVisualization extends TutorVisualizationBase {
  type: 'regression_2d'
  points: Array<{ x: number; y: number }>
  xLabel?: string
  yLabel?: string
  level: number
}

/** A z or t confidence interval for a mean. */
export interface ConfidenceIntervalVisualization extends TutorVisualizationBase {
  type: 'confidence_interval_2d'
  mean: number
  sd: number
  n: number
  level: number
  sigmaKnown: boolean
  label?: string
}

/** Concentration–time curve with the linearised plot for a reaction order. */
export interface KineticsVisualization extends TutorVisualizationBase {
  type: 'kinetics_2d'
  order: ReactionOrder
  k: number
  a0: number
  species?: string
  timeUnit: string
}

/** ln k against 1/T; Ea and A are fitted from data or taken from the lesson. */
export interface ArrheniusVisualization extends TutorVisualizationBase {
  type: 'arrhenius_2d'
  points?: Array<{ t: number; k: number }>
  /** J/mol. */
  ea?: number
  a?: number
}

/** Michaelis–Menten curve and Lineweaver–Burk plot, optionally with an inhibitor. */
export interface EnzymeVisualization extends TutorVisualizationBase {
  type: 'enzyme_2d'
  vmax: number
  km: number
  inhibitor?: Inhibitor
  substrateUnit?: string
  rateUnit?: string
}

/** Exponential or logistic population growth. */
export interface PopulationVisualization extends TutorVisualizationBase {
  type: 'population_2d'
  model: GrowthModel
  n0: number
  r: number
  k?: number
  timeUnit?: string
}

/** A sorting algorithm, step by step. */
export interface SortingVisualization extends TutorVisualizationBase {
  type: 'sorting_2d'
  algorithm: SortAlgorithm
  values: number[]
}

/** A binary search tree built by inserting keys in order. */
export interface BstVisualization extends TutorVisualizationBase {
  type: 'bst_2d'
  keys: number[]
}

/** Equilibrium potentials (Nernst) and, with permeabilities, the GHK resting potential. */
export interface MembranePotentialVisualization extends TutorVisualizationBase {
  type: 'membrane_potential_2d'
  ions: IonConcentration[]
  celsius: number
}

/** A schematic action potential with the lesson's resting, threshold and peak values. */
export interface ActionPotentialVisualization extends TutorVisualizationBase {
  type: 'action_potential_2d'
  cell: 'neuron' | 'ventricular' | 'pacemaker'
  resting: number
  threshold: number
  peak: number
}

/** Oxyhaemoglobin dissociation curves (Hill), with O₂ content at marked PO₂ values. */
export interface OxygenVisualization extends TutorVisualizationBase {
  type: 'oxygen_2d'
  curves: Array<{ label: string; p50: number; n: number }>
  hb: number
  markers: number[]
}

/** Left-ventricular pressure–volume loop; SV, EF, CO and stroke work are computed. */
export interface CardiacVisualization extends TutorVisualizationBase, CardiacInput {
  type: 'cardiac_2d'
}

/** Spirogram with lung volumes and the derived capacities. */
export interface LungVolumesVisualization extends TutorVisualizationBase, LungVolumes {
  type: 'lung_volumes_2d'
}

/** Glomerular Starling forces and / or renal clearance. */
export interface RenalVisualization extends TutorVisualizationBase {
  type: 'renal_2d'
  forces?: StarlingForces
  substances?: Array<{ name: string; urine: number; plasma: number }>
  /** mL/min */
  urineFlow?: number
}

/** Blood-gas analysis on a Davenport diagram. */
export interface AcidBaseVisualization extends TutorVisualizationBase {
  type: 'acid_base_2d'
  ph: number
  paco2: number
  hco3: number
  chronicity?: 'acute' | 'chronic'
}

/** Net charge against pH and the isoelectric point of an amino acid. */
export interface AminoAcidVisualization extends TutorVisualizationBase {
  type: 'amino_acid_2d'
  name: string
  groups: IonizableGroup[]
}

/** A metabolic pathway with its ATP / NADH / FADH₂ tally. */
export interface MetabolismVisualization extends TutorVisualizationBase {
  type: 'metabolism_2d'
  pathway: string
  steps: MetabolicStep[]
  convention: PoConvention
  shuttle: Shuttle
}

/** One-compartment plasma concentration–time curve (single or repeated doses). */
export interface PharmacokineticsVisualization extends TutorVisualizationBase, DosingRegimen {
  type: 'pharmacokinetics_2d'
  drug?: string
  /** Minimum effective / minimum toxic concentration (mg/L) from the lesson. */
  mec?: number
  mtc?: number
}

/** A dental chart with the lesson's teeth highlighted; notations are converted locally. */
export interface DentalChartVisualization extends TutorVisualizationBase {
  type: 'dental_chart_2d'
  dentition: Dentition
  teeth: Array<{ code: number; label?: string }>
}

/** Events and periods on a time axis (embryology, tooth eruption). */
export interface TimelineVisualization extends TutorVisualizationBase {
  type: 'timeline_2d'
  unit: 'day' | 'week' | 'month' | 'year'
  events: Array<{ label: string; start: number; end?: number; group?: string }>
}

export type NervousLevel = 'periphery' | 'spinal_cord' | 'medulla' | 'pons' | 'midbrain' | 'thalamus' | 'cortex'

/** A sensory or motor pathway traced neuron by neuron, with its decussation. */
export interface NeuralPathwayVisualization extends TutorVisualizationBase {
  type: 'neural_pathway_2d'
  name: string
  kind: 'sensory' | 'motor'
  /** The body side of the stimulus (sensory) or of the cortex of origin (motor). */
  side: 'left' | 'right'
  /** `crossesAt`: where a decussating axon crosses, when not at its cell body (corticospinal: cortex → medulla). */
  neurons: Array<{ cellBody: string; level: NervousLevel; tract?: string; decussates?: boolean; crossesAt?: NervousLevel }>
}

/** A relation table (e.g. muscles: origin, insertion, action, innervation, blood supply). */
export interface AnatomyTableVisualization extends TutorVisualizationBase {
  type: 'anatomy_table_2d'
  title?: string
  columns: string[]
  rows: Array<{ name: string; cells: string[] }>
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
  | ChiSquareTestVisualization
  | SubjectVisualization

/** Figures for the other science subjects (schema v9). */
export type SubjectVisualization =
  | FormulaVisualization
  | TangentVisualization
  | RiemannVisualization
  | TaylorVisualization
  | ForcesVisualization
  | MotionVisualization
  | OpticsVisualization
  | CircuitVisualization
  | RegressionVisualization
  | ConfidenceIntervalVisualization
  | KineticsVisualization
  | ArrheniusVisualization
  | EnzymeVisualization
  | PopulationVisualization
  | SortingVisualization
  | BstVisualization
  | MedicalVisualization

/** Figures for the basic medical sciences (schema v10). */
export type MedicalVisualization =
  | MembranePotentialVisualization
  | ActionPotentialVisualization
  | OxygenVisualization
  | CardiacVisualization
  | LungVolumesVisualization
  | RenalVisualization
  | AcidBaseVisualization
  | AminoAcidVisualization
  | MetabolismVisualization
  | PharmacokineticsVisualization
  | DentalChartVisualization
  | TimelineVisualization
  | NeuralPathwayVisualization
  | AnatomyTableVisualization

/** Science and subject figures, drawn by their own renderers. */
export const SCIENCE_VISUALIZATION_TYPES = [
  'molecule_2d',
  'energy_2d',
  'titration_2d',
  'punnett_2d',
  'pedigree_2d',
  'translation_2d',
  'chisquare_test_2d',
  'formula_2d',
  'tangent_2d',
  'riemann_2d',
  'taylor_2d',
  'forces_2d',
  'motion_2d',
  'optics_2d',
  'circuit_2d',
  'regression_2d',
  'confidence_interval_2d',
  'kinetics_2d',
  'arrhenius_2d',
  'enzyme_2d',
  'population_2d',
  'sorting_2d',
  'bst_2d',
  'membrane_potential_2d',
  'action_potential_2d',
  'oxygen_2d',
  'cardiac_2d',
  'lung_volumes_2d',
  'renal_2d',
  'acid_base_2d',
  'amino_acid_2d',
  'metabolism_2d',
  'pharmacokinetics_2d',
  'dental_chart_2d',
  'timeline_2d',
  'neural_pathway_2d',
  'anatomy_table_2d',
] as const

export type ScienceVisualization =
  | MoleculeVisualization
  | EnergyVisualization
  | TitrationVisualization
  | PunnettVisualization
  | PedigreeVisualization
  | TranslationVisualization
  | ChiSquareTestVisualization
  | SubjectVisualization

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
  analyte?: unknown
  concentration?: unknown
  volume?: unknown
  titrantConcentration?: unknown
  kb?: unknown
  analyteLabel?: unknown
  titrantLabel?: unknown
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
  direction?: unknown
  start?: unknown
  // chisquare_test_2d
  categories?: unknown
  df?: unknown
  alpha?: unknown
  // v9 subject figures
  variable?: unknown
  curves?: unknown
  domain?: unknown
  xLabel?: unknown
  yLabel?: unknown
  expression?: unknown
  point?: unknown
  showSecant?: unknown
  a?: unknown
  b?: unknown
  n?: unknown
  method?: unknown
  center?: unknown
  order?: unknown
  body?: unknown
  forces?: unknown
  mass?: unknown
  incline?: unknown
  x0?: unknown
  v0?: unknown
  segments?: unknown
  element?: unknown
  focalLength?: unknown
  objectDistance?: unknown
  objectHeight?: unknown
  voltage?: unknown
  network?: unknown
  level?: unknown
  mean?: unknown
  sd?: unknown
  sigmaKnown?: unknown
  label?: unknown
  k?: unknown
  a0?: unknown
  species?: unknown
  timeUnit?: unknown
  ea?: unknown
  vmax?: unknown
  km?: unknown
  inhibitor?: unknown
  substrateUnit?: unknown
  rateUnit?: unknown
  model?: unknown
  n0?: unknown
  r?: unknown
  algorithm?: unknown
  values?: unknown
  keys?: unknown
  // v10 medical figures
  ions?: unknown
  celsius?: unknown
  cell?: unknown
  resting?: unknown
  threshold?: unknown
  peak?: unknown
  hb?: unknown
  markers?: unknown
  edv?: unknown
  esv?: unknown
  edp?: unknown
  aorticOpen?: unknown
  endSystolic?: unknown
  minimum?: unknown
  hr?: unknown
  tv?: unknown
  irv?: unknown
  erv?: unknown
  rv?: unknown
  substances?: unknown
  urineFlow?: unknown
  ph?: unknown
  paco2?: unknown
  hco3?: unknown
  chronicity?: unknown
  name?: unknown
  groups?: unknown
  pathway?: unknown
  steps?: unknown
  convention?: unknown
  shuttle?: unknown
  route?: unknown
  dose?: unknown
  vd?: unknown
  halfLife?: unknown
  bioavailability?: unknown
  doses?: unknown
  drug?: unknown
  mec?: unknown
  mtc?: unknown
  dentition?: unknown
  teeth?: unknown
  events?: unknown
  kind?: unknown
  side?: unknown
  neurons?: unknown
  title?: unknown
  columns?: unknown
  rows?: unknown
  // placement (all types)
  placement?: unknown
}

export interface VisualizationDraftOutput {
  visualizations?: unknown
}
