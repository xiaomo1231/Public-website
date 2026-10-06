/**
 * Normalizers for the v9 subject figures (formula explorer, calculus,
 * physics, statistics, chemistry kinetics, biology models, algorithms).
 *
 * Same contract as `normalize.ts`: the draft is untrusted; every field is
 * checked, formulas go through the whitelist parser, and anything the local
 * maths cannot use is rejected rather than drawn wrongly.
 */
import type {
  ArrheniusVisualization,
  BstVisualization,
  CircuitVisualization,
  ConfidenceIntervalVisualization,
  EnzymeVisualization,
  FormulaParameter,
  FormulaVisualization,
  ForcesVisualization,
  KineticsVisualization,
  MotionVisualization,
  OpticsVisualization,
  PopulationVisualization,
  RegressionVisualization,
  RiemannVisualization,
  SortingVisualization,
  TangentVisualization,
  TaylorVisualization,
  TutorVisualization,
  VisualizationDraft,
  VisualizationPlacement,
} from './types'
import { VISUALIZATION_LIMITS } from './limits'
import { asRecord, readNumber, sanitizeText } from './sanitize'
import {
  derivativeOf,
  isValidSymbolName,
  numericDerivative,
  parseFormula,
  taylorCoefficients,
  type ParsedFormula,
  type RiemannMethod,
} from './formula'
import { MAX_RESISTORS, countResistors, type CircuitNode, type Force, type OpticalElement } from './physics'
import type { InhibitionType } from './models'
import { MAX_BST_KEYS, MAX_SORT_VALUES, SORT_ALGORITHMS, type SortAlgorithm } from './algorithms'

type Normalized = { ok: true; value: TutorVisualization } | { ok: false; reason: string }

interface CommonBase {
  id: string
  schemaVersion: number
  placement: VisualizationPlacement
  caption?: string
}

const { maxLabelLength: MAX_LABEL } = VISUALIZATION_LIMITS

const fail = (reason: string): Normalized => ({ ok: false, reason })

function inRange(value: unknown, min: number, max: number): number | null {
  const n = readNumber(value)
  return n !== null && n >= min && n <= max ? n : null
}

function positive(value: unknown, max = 1e9): number | null {
  const n = readNumber(value)
  return n !== null && n > 0 && n <= max ? n : null
}

function domainOf(raw: unknown): { min: number; max: number } | null {
  const record = asRecord(raw)
  const min = readNumber(record?.min)
  const max = readNumber(record?.max)
  return min !== null && max !== null && min < max ? { min, max } : null
}

function variableOf(raw: unknown): string {
  return typeof raw === 'string' && isValidSymbolName(raw.trim()) ? raw.trim() : 'x'
}

/** At least a fifth of the samples must be finite, or there is nothing to draw. */
function drawable(formula: ParsedFormula, variable: string, scope: Record<string, number>, min: number, max: number): boolean {
  let finite = 0
  for (let i = 0; i <= 100; i++) {
    const y = formula.evaluate({ ...scope, [variable]: min + ((max - min) * i) / 100 })
    if (Number.isFinite(y) && Math.abs(y) < 1e12) finite++
  }
  return finite >= 20
}

// --- formula explorer and calculus -------------------------------------------

function normalizeFormula(draft: VisualizationDraft, base: CommonBase): Normalized {
  const variable = variableOf(draft.variable)
  const domain = domainOf(draft.domain)
  if (!domain) return fail('invalid-formula-domain')
  const params: FormulaParameter[] = []
  for (const raw of Array.isArray(draft.params) ? draft.params.slice(0, 6) : []) {
    const item = asRecord(raw)
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    const min = readNumber(item?.min)
    const max = readNumber(item?.max)
    const value = readNumber(item?.value)
    if (!isValidSymbolName(name) || name === variable || params.some((p) => p.name === name)) return fail('invalid-formula-parameter')
    if (min === null || max === null || value === null || min >= max) return fail('invalid-formula-parameter')
    const rawStep = readNumber(item?.step)
    const step = rawStep !== null && rawStep > 0 && rawStep <= max - min ? rawStep : (max - min) / 100
    const label = sanitizeText(item?.label, MAX_LABEL)
    const unit = sanitizeText(item?.unit, 16)
    params.push({ name, value: Math.min(max, Math.max(min, value)), min, max, step, ...(label ? { label } : {}), ...(unit ? { unit } : {}) })
  }
  const symbols = [variable, ...params.map((p) => p.name)]
  const scope = Object.fromEntries(params.map((p) => [p.name, p.value]))
  const rawCurves = Array.isArray(draft.curves) ? draft.curves.slice(0, 4) : draft.expression ? [{ expression: draft.expression }] : []
  const curves: FormulaVisualization['curves'] = []
  for (const raw of rawCurves) {
    const item = asRecord(raw)
    const formula = parseFormula(item?.expression, symbols)
    if (!formula) return fail('invalid-formula-expression')
    if (!drawable(formula, variable, scope, domain.min, domain.max)) return fail('formula-not-drawable')
    const label = sanitizeText(item?.label, MAX_LABEL)
    curves.push({ expression: formula.source, ...(label ? { label } : {}) })
  }
  if (curves.length === 0) return fail('missing-formula-expression')
  const xLabel = sanitizeText(draft.xLabel, MAX_LABEL)
  const yLabel = sanitizeText(draft.yLabel, MAX_LABEL)
  const value: FormulaVisualization = {
    ...base,
    type: 'formula_2d',
    variable,
    curves,
    params,
    domain,
    ...(xLabel ? { xLabel } : {}),
    ...(yLabel ? { yLabel } : {}),
  }
  return { ok: true, value }
}

function singleFunction(draft: VisualizationDraft): { formula: ParsedFormula; variable: string; source: string } | null {
  const variable = variableOf(draft.variable)
  const formula = parseFormula(draft.expression, [variable])
  return formula ? { formula, variable, source: formula.source } : null
}

function normalizeTangent(draft: VisualizationDraft, base: CommonBase): Normalized {
  const fn = singleFunction(draft)
  const domain = domainOf(draft.domain)
  if (!fn || !domain) return fail('invalid-tangent-function')
  const raw = readNumber(draft.point)
  const point = raw === null ? (domain.min + domain.max) / 2 : Math.min(domain.max, Math.max(domain.min, raw))
  const at = { [fn.variable]: point }
  const derivative = derivativeOf(fn.formula, fn.variable)
  const slope = derivative ? derivative.evaluate(at) : numericDerivative(fn.formula.evaluate, at, fn.variable)
  if (!Number.isFinite(fn.formula.evaluate(at)) || !Number.isFinite(slope)) return fail('tangent-undefined')
  if (!drawable(fn.formula, fn.variable, {}, domain.min, domain.max)) return fail('formula-not-drawable')
  const value: TangentVisualization = {
    ...base,
    type: 'tangent_2d',
    expression: fn.source,
    variable: fn.variable,
    point,
    domain,
    showSecant: draft.showSecant !== false,
  }
  return { ok: true, value }
}

function normalizeRiemann(draft: VisualizationDraft, base: CommonBase): Normalized {
  const fn = singleFunction(draft)
  const a = readNumber(draft.a)
  const b = readNumber(draft.b)
  if (!fn || a === null || b === null || a >= b) return fail('invalid-riemann-setup')
  if (!drawable(fn.formula, fn.variable, {}, a, b)) return fail('formula-not-drawable')
  const n = inRange(draft.n, 1, 200)
  const method = ['left', 'right', 'midpoint', 'trapezoid'].includes(String(draft.method)) ? (draft.method as RiemannMethod) : 'left'
  const value: RiemannVisualization = {
    ...base,
    type: 'riemann_2d',
    expression: fn.source,
    variable: fn.variable,
    a,
    b,
    n: n === null ? 8 : Math.round(n),
    method,
  }
  return { ok: true, value }
}

function normalizeTaylor(draft: VisualizationDraft, base: CommonBase): Normalized {
  const fn = singleFunction(draft)
  const domain = domainOf(draft.domain)
  const center = readNumber(draft.center) ?? 0
  if (!fn || !domain || center < domain.min || center > domain.max) return fail('invalid-taylor-setup')
  const rawOrder = inRange(draft.order, 1, 10)
  const order = rawOrder === null ? 5 : Math.round(rawOrder)
  // The highest order the slider can reach must be computable.
  if (!taylorCoefficients(fn.formula, fn.variable, center, 10)) return fail('taylor-not-differentiable')
  if (!drawable(fn.formula, fn.variable, {}, domain.min, domain.max)) return fail('formula-not-drawable')
  const value: TaylorVisualization = { ...base, type: 'taylor_2d', expression: fn.source, variable: fn.variable, center, order, domain }
  return { ok: true, value }
}

// --- physics -----------------------------------------------------------------

function normalizeForces(draft: VisualizationDraft, base: CommonBase): Normalized {
  const list = Array.isArray(draft.forces) ? draft.forces : []
  if (list.length < 1 || list.length > 8) return fail('invalid-force-count')
  const forces: Force[] = []
  for (const raw of list) {
    const item = asRecord(raw)
    const label = sanitizeText(item?.label, MAX_LABEL)
    const magnitude = inRange(item?.magnitude, 0, 1e9)
    const angle = readNumber(item?.angle)
    if (!label || magnitude === null || angle === null) return fail('invalid-force')
    forces.push({ label, magnitude, angle: ((angle % 360) + 360) % 360 })
  }
  const mass = positive(draft.mass)
  const incline = readNumber(draft.incline)
  const body = sanitizeText(draft.body, MAX_LABEL)
  const value: ForcesVisualization = {
    ...base,
    type: 'forces_2d',
    forces,
    unit: sanitizeText(draft.unit, 8) ?? 'N',
    ...(body ? { body } : {}),
    ...(mass !== null ? { mass } : {}),
    ...(incline !== null && incline > 0 && incline < 90 ? { incline } : {}),
  }
  return { ok: true, value }
}

function normalizeMotion(draft: VisualizationDraft, base: CommonBase): Normalized {
  const list = Array.isArray(draft.segments) ? draft.segments : []
  if (list.length < 1 || list.length > 6) return fail('invalid-motion-segments')
  const segments = []
  for (const raw of list) {
    const item = asRecord(raw)
    const duration = positive(item?.duration, 1e4)
    const acceleration = inRange(item?.acceleration, -1e4, 1e4)
    if (duration === null || acceleration === null) return fail('invalid-motion-segment')
    segments.push({ duration, acceleration })
  }
  const value: MotionVisualization = {
    ...base,
    type: 'motion_2d',
    x0: inRange(draft.x0, -1e6, 1e6) ?? 0,
    v0: inRange(draft.v0, -1e6, 1e6) ?? 0,
    segments,
  }
  return { ok: true, value }
}

const ELEMENTS: OpticalElement[] = ['converging_lens', 'diverging_lens', 'concave_mirror', 'convex_mirror']

function normalizeOptics(draft: VisualizationDraft, base: CommonBase): Normalized {
  const element = ELEMENTS.includes(draft.element as OpticalElement) ? (draft.element as OpticalElement) : null
  const focal = readNumber(draft.focalLength)
  const objectDistance = positive(draft.objectDistance, 1e4)
  if (!element || focal === null || focal === 0 || Math.abs(focal) > 1e4 || objectDistance === null) return fail('invalid-optics-setup')
  const value: OpticsVisualization = {
    ...base,
    type: 'optics_2d',
    element,
    focalLength: Math.abs(focal),
    objectDistance,
    objectHeight: positive(draft.objectHeight, 1e4) ?? 1,
  }
  return { ok: true, value }
}

function parseNetwork(raw: unknown, depth: number, labels: string[]): CircuitNode | null {
  const item = asRecord(raw)
  if (!item || depth > 3) return null
  if (item.kind === 'series' || item.kind === 'parallel') {
    const items = Array.isArray(item.items) ? item.items.map((child) => parseNetwork(child, depth + 1, labels)) : []
    if (items.length < 2 || items.some((child) => !child)) return null
    return { kind: item.kind, items: items as CircuitNode[] }
  }
  const resistance = positive(item.resistance)
  if (resistance === null) return null
  let label = sanitizeText(item.label, 12) ?? `R${labels.length + 1}`
  if (labels.includes(label)) label = `${label}′`
  labels.push(label)
  return { kind: 'resistor', label, resistance }
}

function normalizeCircuit(draft: VisualizationDraft, base: CommonBase): Normalized {
  const voltage = positive(draft.voltage, 1e5)
  const network = parseNetwork(draft.network, 0, [])
  if (voltage === null || !network) return fail('invalid-circuit')
  if (countResistors(network) > MAX_RESISTORS) return fail('circuit-too-large')
  const value: CircuitVisualization = { ...base, type: 'circuit_2d', voltage, network }
  return { ok: true, value }
}

// --- statistics ----------------------------------------------------------------

function levelOf(raw: unknown): number {
  const level = readNumber(raw)
  return level !== null && level >= 0.5 && level <= 0.999 ? level : 0.95
}

function normalizeRegression(draft: VisualizationDraft, base: CommonBase): Normalized {
  const list = Array.isArray(draft.points) ? draft.points : []
  if (list.length < 3 || list.length > 100) return fail('invalid-regression-points')
  const points: Array<{ x: number; y: number }> = []
  for (const raw of list) {
    const item = asRecord(raw)
    const x = readNumber(item?.x)
    const y = readNumber(item?.y)
    if (x === null || y === null) return fail('invalid-regression-point')
    points.push({ x, y })
  }
  if (new Set(points.map((p) => p.x)).size < 2) return fail('regression-constant-x')
  const xLabel = sanitizeText(draft.xLabel, MAX_LABEL)
  const yLabel = sanitizeText(draft.yLabel, MAX_LABEL)
  const value: RegressionVisualization = {
    ...base,
    type: 'regression_2d',
    points,
    level: levelOf(draft.level),
    ...(xLabel ? { xLabel } : {}),
    ...(yLabel ? { yLabel } : {}),
  }
  return { ok: true, value }
}

function normalizeConfidence(draft: VisualizationDraft, base: CommonBase): Normalized {
  const mean = readNumber(draft.mean)
  const sd = positive(draft.sd)
  const n = inRange(draft.n, 2, 1e6)
  if (mean === null || sd === null || n === null || !Number.isInteger(n)) return fail('invalid-confidence-setup')
  const label = sanitizeText(draft.label, MAX_LABEL)
  const value: ConfidenceIntervalVisualization = {
    ...base,
    type: 'confidence_interval_2d',
    mean,
    sd,
    n,
    level: levelOf(draft.level),
    sigmaKnown: draft.sigmaKnown === true,
    ...(label ? { label } : {}),
  }
  return { ok: true, value }
}

// --- chemistry and biology models --------------------------------------------

function normalizeKinetics(draft: VisualizationDraft, base: CommonBase): Normalized {
  const order = Number(draft.order)
  const k = positive(draft.k)
  const a0 = positive(draft.a0)
  if (![0, 1, 2].includes(order) || k === null || a0 === null) return fail('invalid-kinetics-setup')
  const species = sanitizeText(draft.species, MAX_LABEL)
  const value: KineticsVisualization = {
    ...base,
    type: 'kinetics_2d',
    order: order as 0 | 1 | 2,
    k,
    a0,
    timeUnit: sanitizeText(draft.timeUnit, 8) ?? 's',
    ...(species ? { species } : {}),
  }
  return { ok: true, value }
}

function normalizeArrhenius(draft: VisualizationDraft, base: CommonBase): Normalized {
  const list = Array.isArray(draft.points) ? draft.points : []
  if (list.length >= 2) {
    if (list.length > 12) return fail('invalid-arrhenius-points')
    const points: Array<{ t: number; k: number }> = []
    for (const raw of list) {
      const item = asRecord(raw)
      const t = inRange(item?.t ?? item?.T, 1, 5000)
      const k = positive(item?.k, 1e30)
      if (t === null || k === null) return fail('invalid-arrhenius-point')
      points.push({ t, k })
    }
    if (new Set(points.map((p) => p.t)).size < 2) return fail('invalid-arrhenius-points')
    return { ok: true, value: { ...base, type: 'arrhenius_2d', points } satisfies ArrheniusVisualization }
  }
  // Ea in kJ/mol from the model, stored in J/mol.
  const ea = positive(draft.ea, 1e4)
  const a = positive(draft.a, 1e30)
  if (ea === null || a === null) return fail('invalid-arrhenius-setup')
  return { ok: true, value: { ...base, type: 'arrhenius_2d', ea: ea * 1000, a } satisfies ArrheniusVisualization }
}

const INHIBITIONS: InhibitionType[] = ['competitive', 'noncompetitive', 'uncompetitive', 'mixed']

function normalizeEnzyme(draft: VisualizationDraft, base: CommonBase): Normalized {
  const vmax = positive(draft.vmax)
  const km = positive(draft.km)
  if (vmax === null || km === null) return fail('invalid-enzyme-setup')
  const raw = asRecord(draft.inhibitor)
  let inhibitor: EnzymeVisualization['inhibitor']
  if (raw) {
    const type = INHIBITIONS.includes(raw.type as InhibitionType) ? (raw.type as InhibitionType) : null
    const concentration = inRange(raw.concentration, 0, 1e9)
    const ki = positive(raw.ki)
    const kiPrime = positive(raw.kiPrime)
    if (!type || concentration === null || ki === null) return fail('invalid-enzyme-inhibitor')
    inhibitor = { type, concentration, ki, ...(kiPrime !== null ? { kiPrime } : {}) }
  }
  const substrateUnit = sanitizeText(draft.substrateUnit, 12)
  const rateUnit = sanitizeText(draft.rateUnit, 16)
  const value: EnzymeVisualization = {
    ...base,
    type: 'enzyme_2d',
    vmax,
    km,
    ...(inhibitor ? { inhibitor } : {}),
    ...(substrateUnit ? { substrateUnit } : {}),
    ...(rateUnit ? { rateUnit } : {}),
  }
  return { ok: true, value }
}

function normalizePopulation(draft: VisualizationDraft, base: CommonBase): Normalized {
  const model = draft.model === 'logistic' ? 'logistic' : draft.model === 'exponential' ? 'exponential' : null
  const n0 = positive(draft.n0)
  const r = positive(draft.r, 100)
  const k = positive(draft.k)
  if (!model || n0 === null || r === null) return fail('invalid-population-setup')
  if (model === 'logistic' && (k === null || n0 >= k)) return fail('invalid-population-capacity')
  const timeUnit = sanitizeText(draft.timeUnit, 12)
  const value: PopulationVisualization = {
    ...base,
    type: 'population_2d',
    model,
    n0,
    r,
    ...(model === 'logistic' && k !== null ? { k } : {}),
    ...(timeUnit ? { timeUnit } : {}),
  }
  return { ok: true, value }
}

// --- algorithms ----------------------------------------------------------------

function integers(raw: unknown, min: number, max: number, limit: number): number[] | null {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) return null
  const out: number[] = []
  for (const value of raw) {
    const n = readNumber(value)
    if (n === null || !Number.isInteger(n) || Math.abs(n) > limit) return null
    out.push(n)
  }
  return out
}

function normalizeSorting(draft: VisualizationDraft, base: CommonBase): Normalized {
  const algorithm = SORT_ALGORITHMS.includes(draft.algorithm as SortAlgorithm) ? (draft.algorithm as SortAlgorithm) : null
  const values = integers(draft.values, 2, MAX_SORT_VALUES, 999)
  if (!algorithm || !values) return fail('invalid-sorting-setup')
  return { ok: true, value: { ...base, type: 'sorting_2d', algorithm, values } satisfies SortingVisualization }
}

function normalizeBst(draft: VisualizationDraft, base: CommonBase): Normalized {
  const keys = integers(draft.keys, 1, MAX_BST_KEYS, 9999)
  if (!keys) return fail('invalid-bst-keys')
  return { ok: true, value: { ...base, type: 'bst_2d', keys } satisfies BstVisualization }
}

export const SUBJECT_NORMALIZERS: Record<string, (draft: VisualizationDraft, base: CommonBase) => Normalized> = {
  formula_2d: normalizeFormula,
  tangent_2d: normalizeTangent,
  riemann_2d: normalizeRiemann,
  taylor_2d: normalizeTaylor,
  forces_2d: normalizeForces,
  motion_2d: normalizeMotion,
  optics_2d: normalizeOptics,
  circuit_2d: normalizeCircuit,
  regression_2d: normalizeRegression,
  confidence_interval_2d: normalizeConfidence,
  kinetics_2d: normalizeKinetics,
  arrhenius_2d: normalizeArrhenius,
  enzyme_2d: normalizeEnzyme,
  population_2d: normalizePopulation,
  sorting_2d: normalizeSorting,
  bst_2d: normalizeBst,
}
