/**
 * Graded graph questions on a supply-and-demand diagram (economics).
 *
 * Three kinds, each carrying a `MarketSpec` solved by `solveMarket`; every
 * expected answer is computed here from the engine, never taken from a model
 * or a stored string:
 *
 *   - `shift_id`     which curve(s) shift, which way, and what happens to the
 *                    equilibrium price and quantity (up / down / unchanged /
 *                    ambiguous — ambiguity from `shift.ambiguous`).
 *   - `area_read`    one engine-computed value (equilibrium P / Q, CS, PS,
 *                    DWL, tax revenue, burdens, shortage, elasticity, TR …),
 *                    graded with the economics number reader.
 *   - `draw_diagram` the student moves curve(s) / sets a policy line, marks
 *                    the new equilibrium and selects a shaded region; graded
 *                    item by item (curve moved, direction, amount, policy,
 *                    equilibrium, region).
 *
 * Partial credit: each item (or component) earns its points; the points come
 * from the professor's rubric when one maps onto the items, otherwise from
 * the platform rule (平台拟定, one point per item). Pure and local.
 */
import { compareEconNumber, type EconNumberSpec } from '@/infrastructure/math/economicsAnswer'
import {
  curveNumbers,
  exploreMarket,
  formatMarketNumber,
  nudgeCurveSpec,
  quantityScaleFactor,
  resolveCurve,
  solveMarket,
  type AreaKind,
  type CurveShift,
  type CurveSide,
  type MarketCurve,
  type MarketNumber,
  type MarketSolution,
  type MarketSpec,
  type QuantityScale,
} from './market'
import { parseMarketSpec, parseQuantityScale } from './marketSpec'

// --- types ------------------------------------------------------------------------

export type MarketQuestionKind = 'shift_id' | 'area_read' | 'draw_diagram'

export const MARKET_QUESTION_KINDS: readonly MarketQuestionKind[] = [
  'shift_id',
  'area_read',
  'draw_diagram',
]

/** What the figure shows with the question. */
export type FigureShow =
  /** The curves only (the student finds the equilibrium). */
  | 'curves'
  /** The curves and the original equilibrium. */
  | 'before'
  /** The scenario drawn (shifted curves / policy lines / outcome), no areas. */
  | 'after'

export interface MarketFigure {
  spec: MarketSpec
  show: FigureShow
  /** `$`, `€` … shown on the price axis. */
  priceUnit?: string
  quantityUnit?: string
  quantityScale?: QuantityScale
}

export type MarketValueTarget =
  | 'eq_price'
  | 'eq_quantity'
  | 'new_price'
  | 'new_quantity'
  | 'buyer_price'
  | 'seller_price'
  | 'cs_before'
  | 'ps_before'
  | 'cs_after'
  | 'ps_after'
  | 'cs_change'
  | 'ps_change'
  | 'total_surplus_after'
  | 'dwl'
  | 'tax_revenue'
  | 'subsidy_cost'
  | 'tariff_revenue'
  | 'quota_rent'
  | 'buyer_burden'
  | 'seller_burden'
  | 'shortage'
  | 'excess_supply'
  | 'imports'
  | 'exports'
  | 'elasticity_demand'
  | 'elasticity_supply'
  | 'elasticity_midpoint'
  | 'tr_before'
  | 'tr_after'
  | 'tr_change'

export const MARKET_VALUE_TARGETS: readonly MarketValueTarget[] = [
  'eq_price',
  'eq_quantity',
  'new_price',
  'new_quantity',
  'buyer_price',
  'seller_price',
  'cs_before',
  'ps_before',
  'cs_after',
  'ps_after',
  'cs_change',
  'ps_change',
  'total_surplus_after',
  'dwl',
  'tax_revenue',
  'subsidy_cost',
  'tariff_revenue',
  'quota_rent',
  'buyer_burden',
  'seller_burden',
  'shortage',
  'excess_supply',
  'imports',
  'exports',
  'elasticity_demand',
  'elasticity_supply',
  'elasticity_midpoint',
  'tr_before',
  'tr_after',
  'tr_change',
]

/** How a value is measured: a price, a quantity, money (an area or P·Q), or a ratio. */
export type ValueMeasure = 'price' | 'quantity' | 'money' | 'ratio'

export const TARGET_MEASURE: Record<MarketValueTarget, ValueMeasure> = {
  eq_price: 'price',
  eq_quantity: 'quantity',
  new_price: 'price',
  new_quantity: 'quantity',
  buyer_price: 'price',
  seller_price: 'price',
  cs_before: 'money',
  ps_before: 'money',
  cs_after: 'money',
  ps_after: 'money',
  cs_change: 'money',
  ps_change: 'money',
  total_surplus_after: 'money',
  dwl: 'money',
  tax_revenue: 'money',
  subsidy_cost: 'money',
  tariff_revenue: 'money',
  quota_rent: 'money',
  buyer_burden: 'price',
  seller_burden: 'price',
  shortage: 'quantity',
  excess_supply: 'quantity',
  imports: 'quantity',
  exports: 'quantity',
  elasticity_demand: 'ratio',
  elasticity_supply: 'ratio',
  elasticity_midpoint: 'ratio',
  tr_before: 'money',
  tr_after: 'money',
  tr_change: 'money',
}

/** A region the student may be asked to shade (after the change). */
export type RegionKey = 'cs' | 'ps' | 'dwl' | 'revenue' | 'cost' | 'rent' | 'tariff' | 'transfer'

export const REGION_KEYS: readonly RegionKey[] = [
  'cs',
  'ps',
  'dwl',
  'revenue',
  'cost',
  'rent',
  'tariff',
  'transfer',
]

/** One gradable item of a drawing. */
export type DrawItemKey = 'curve' | 'direction' | 'amount' | 'policy' | 'equilibrium' | 'region'

export const DRAW_ITEM_KEYS: readonly DrawItemKey[] = [
  'curve',
  'direction',
  'amount',
  'policy',
  'equilibrium',
  'region',
]

export interface DrawTask {
  /** The items this drawing is graded on (in this order). */
  items: DrawItemKey[]
  /** The region to select, when `region` is graded. */
  region?: RegionKey
}

/** One component of a shift-identification answer. */
export type ShiftComponent = 'demand' | 'supply' | 'price' | 'quantity'

export const SHIFT_COMPONENTS: readonly ShiftComponent[] = ['demand', 'supply', 'price', 'quantity']

/** Rubric lines (with marks) and where they come from. */
export interface MarketRubric {
  source: 'professor' | 'platform'
  lines: string[]
}

/** The graded graph question as stored on a question / practice part. */
export interface MarketQuestion {
  kind: MarketQuestionKind
  figure: MarketFigure
  /** `area_read`: the value asked for. */
  target?: MarketValueTarget
  /** `draw_diagram`: what is graded. */
  draw?: DrawTask
  /**
   * `shift_id`: grade the textbook answer (the sizes of the shifts are not
   * given, so a both-curves case leaves one variable "ambiguous"). Default
   * true; false when the question states the numbers.
   */
  qualitative?: boolean
  /** The professor's rubric (mapped onto the items) or none (platform rule). */
  rubric?: MarketRubric
}

// --- solving ----------------------------------------------------------------------

export function solveQuestion(question: Pick<MarketQuestion, 'figure'>): MarketSolution | null {
  const result = solveMarket(question.figure.spec)
  return result.ok ? result.solution : null
}

function abs(n: MarketNumber): MarketNumber {
  return n.value < 0
    ? { value: -n.value, exact: { n: -n.exact.n, d: n.exact.d } }
    : { value: n.value, exact: n.exact }
}

function diff(a: MarketNumber, b: MarketNumber): MarketNumber {
  const n = a.exact.n * b.exact.d - b.exact.n * a.exact.d
  const d = a.exact.d * b.exact.d
  let x = n < 0n ? -n : n
  let y = d
  while (y) [x, y] = [y, x % y]
  const g = x || 1n
  return { value: a.value - b.value, exact: { n: n / g, d: d / g } }
}

/** The value a target asks for, computed by the engine; null when it does not apply. */
export function marketValue(
  solution: MarketSolution,
  target: MarketValueTarget,
): MarketNumber | null {
  const scenario = solution.scenario
  switch (target) {
    case 'eq_price':
      return solution.original.p
    case 'eq_quantity':
      return solution.original.q
    case 'new_price':
      return scenario === 'equilibrium' ? null : solution.outcome.p
    case 'new_quantity':
      return scenario === 'equilibrium' ? null : solution.outcome.q
    case 'buyer_price':
      return solution.buyerPrice ?? null
    case 'seller_price':
      return solution.sellerPrice ?? null
    case 'cs_before':
      return solution.before.cs
    case 'ps_before':
      return solution.before.ps
    case 'cs_after':
      return scenario === 'equilibrium' ? null : solution.after.cs
    case 'ps_after':
      return scenario === 'equilibrium' ? null : solution.after.ps
    case 'cs_change':
      return scenario === 'equilibrium' ? null : solution.change.cs
    case 'ps_change':
      return scenario === 'equilibrium' ? null : solution.change.ps
    case 'total_surplus_after':
      return scenario === 'equilibrium' ? null : solution.after.total
    case 'dwl':
      return solution.deadweightLoss && solution.deadweightLoss.value > 0
        ? solution.deadweightLoss
        : null
    case 'tax_revenue':
      return scenario === 'tax' ? solution.after.government : null
    case 'subsidy_cost':
      return scenario === 'subsidy' ? abs(solution.after.government) : null
    case 'tariff_revenue':
      return scenario === 'trade' && solution.after.government.value > 0
        ? solution.after.government
        : null
    case 'quota_rent':
      return solution.after.rent.value > 0 ? solution.after.rent : null
    case 'buyer_burden':
      return solution.incidence ? solution.incidence.buyersPerUnit : null
    case 'seller_burden':
      return solution.incidence ? solution.incidence.sellersPerUnit : null
    case 'shortage':
      return solution.control?.gapKind === 'shortage' && solution.binding
        ? solution.control.gap
        : null
    case 'excess_supply':
      return solution.control?.gapKind === 'surplus' && solution.binding
        ? solution.control.gap
        : null
    case 'imports':
      return solution.trade?.role === 'importer' ? solution.trade.volume : null
    case 'exports':
      return solution.trade?.role === 'exporter' ? solution.trade.volume : null
    case 'elasticity_demand': {
      const e = solution.elasticity.demandAtOriginal
      return e?.exact ? abs({ value: e.value, exact: e.exact }) : null
    }
    case 'elasticity_supply': {
      const e = solution.elasticity.supplyAtOriginal
      return e?.exact ? { value: e.value, exact: e.exact } : null
    }
    case 'elasticity_midpoint': {
      const e = solution.elasticity.alongUnshifted
      if (!e?.value.exact) return null
      const value = { value: e.value.value, exact: e.value.exact }
      // The price elasticity of demand is reported as an absolute value.
      return e.side === 'demand' ? abs(value) : value
    }
    case 'tr_before':
      return solution.totalRevenue.before
    case 'tr_after':
      return scenario === 'equilibrium' ? null : solution.totalRevenue.after
    case 'tr_change':
      return scenario === 'equilibrium'
        ? null
        : diff(solution.totalRevenue.after, solution.totalRevenue.before)
  }
}

/** The economics reading rules of a target (absolute-value elasticity, amounts in thousands). */
export function targetEconSpec(
  target: MarketValueTarget,
  figure: Pick<MarketFigure, 'quantityScale'>,
): EconNumberSpec {
  const measure = TARGET_MEASURE[target]
  const scale = quantityScaleFactor(figure.quantityScale)
  return {
    ...(target === 'elasticity_demand' || (target === 'elasticity_midpoint' && measure === 'ratio')
      ? { absolute: true }
      : {}),
    ...(scale > 1 && (measure === 'money' || measure === 'quantity') ? { scale } : {}),
  }
}

/** A plain decimal of an exact value, precise enough to compare with (12 significant digits). */
export function exactDecimal(n: MarketNumber): string {
  const text = formatMarketNumber(n, 6)
  if (!text.startsWith('≈')) return text.replace('−', '-')
  return String(Number(n.value.toPrecision(12)))
}

/** A value as the student should read it (`$`, money in the figure's scale). */
export function formatTargetValue(
  n: MarketNumber,
  target: MarketValueTarget,
  figure: Pick<MarketFigure, 'priceUnit'>,
): string {
  const text = formatMarketNumber(n)
  const measure = TARGET_MEASURE[target]
  if ((measure === 'price' || measure === 'money') && figure.priceUnit) {
    const unit = figure.priceUnit
    if (text.startsWith('≈ ')) return `≈ ${withUnit(text.slice(2), unit)}`
    return withUnit(text, unit)
  }
  return text
}

function withUnit(text: string, unit: string): string {
  return text.startsWith('−') ? `−${unit}${text.slice(1)}` : `${unit}${text}`
}

// --- shift identification ----------------------------------------------------------

export type CurveMove = 'increase' | 'decrease' | 'none'
export type OutcomeMove = 'increase' | 'decrease' | 'unchanged' | 'ambiguous'

export interface ShiftAnswer {
  demand: CurveMove
  supply: CurveMove
  price: OutcomeMove
  quantity: OutcomeMove
}

const CURVE_MOVES: readonly CurveMove[] = ['decrease', 'none', 'increase']
const OUTCOME_MOVES: readonly OutcomeMove[] = ['decrease', 'unchanged', 'increase', 'ambiguous']

export const CURVE_MOVE_OPTIONS = CURVE_MOVES
export const OUTCOME_MOVE_OPTIONS = OUTCOME_MOVES

function sideMove(direction: string | undefined): CurveMove | null {
  if (direction === 'increase' || direction === 'decrease') return direction
  if (direction === 'none' || direction === undefined) return 'none'
  return null // a rotation is not a shift question
}

function changeMove(value: number): OutcomeMove {
  return value > 1e-12 ? 'increase' : value < -1e-12 ? 'decrease' : 'unchanged'
}

/**
 * The expected answer of a shift question. Only `shift` scenarios (and the
 * taxes / subsidies, drawn as a shifted curve) qualify; a rotation does not.
 */
export function expectedShift(
  solution: MarketSolution,
  qualitative = true,
  spec?: MarketSpec,
): ShiftAnswer | null {
  if (solution.scenario === 'shift') {
    const shift = solution.shift
    if (!shift) return null
    const demand = sideMove(shift.demand)
    const supply = sideMove(shift.supply)
    if (!demand || !supply) return null
    const price =
      qualitative && shift.ambiguous === 'price' ? 'ambiguous' : changeMove(solution.deltaP.value)
    const quantity =
      qualitative && shift.ambiguous === 'quantity'
        ? 'ambiguous'
        : changeMove(solution.deltaQ.value)
    return { demand, supply, price, quantity }
  }
  if ((solution.scenario === 'tax' || solution.scenario === 'subsidy') && spec) {
    const scenario = spec.scenario
    if (scenario.kind !== 'tax' && scenario.kind !== 'subsidy') return null
    const move: CurveMove = scenario.kind === 'tax' ? 'decrease' : 'increase'
    return {
      demand: scenario.on === 'buyers' ? move : 'none',
      supply: scenario.on === 'sellers' ? move : 'none',
      // The price buyers pay and the quantity traded.
      price: changeMove(solution.deltaP.value),
      quantity: changeMove(solution.deltaQ.value),
    }
  }
  return null
}

export interface ComponentResult<K extends string> {
  key: K
  correct: boolean
  expected: string
  given: string | null
}

export interface MarketItemResult {
  key: DrawItemKey | ShiftComponent | 'value'
  correct: boolean
  /** Expected / given in a short machine form (`increase`, `30, 45`, `dwl`). */
  expected?: string
  given?: string | null
  /** Why it failed, machine-readable (`not-moved`, `extra-curve`, `wrong-side` …). */
  reason?: string
}

export interface RubricLineResult {
  text: string
  points: number
  /** The items this line was mapped to (empty: not graded automatically). */
  keys: Array<MarketItemResult['key']>
  earned: number
}

export interface MarketGradeResult {
  kind: MarketQuestionKind
  items: MarketItemResult[]
  earned: number
  total: number
  /** Where the points come from. */
  rubricSource: 'professor' | 'platform'
  /** Professor rubric lines with what they earned (professor source only). */
  rubricLines?: RubricLineResult[]
  /** The answer could not be read at all. */
  unreadable?: boolean
  /** area_read: the econ comparison note (absolute value, full amount …). */
  note?: string
}

/** Serialised shift answer: `shift: demand=increase; supply=none; price=increase; quantity=ambiguous`. */
export function encodeShiftAnswer(answer: Partial<ShiftAnswer>): string {
  const parts = SHIFT_COMPONENTS.filter((key) => answer[key]).map((key) => `${key}=${answer[key]}`)
  return `shift: ${parts.join('; ')}`
}

export function decodeShiftAnswer(text: string): Partial<ShiftAnswer> | null {
  const match = /^\s*shift\s*:\s*(.*)$/is.exec(text.trim())
  if (!match) return null
  const out: Partial<ShiftAnswer> = {}
  for (const piece of match[1]!.split(/[;,\n]/)) {
    const [rawKey, rawValue] = piece.split('=').map((s) => s?.trim().toLowerCase())
    if (!rawKey || !rawValue) continue
    if (rawKey === 'demand' || rawKey === 'supply') {
      if ((CURVE_MOVES as readonly string[]).includes(rawValue)) out[rawKey] = rawValue as CurveMove
    } else if (rawKey === 'price' || rawKey === 'quantity') {
      if ((OUTCOME_MOVES as readonly string[]).includes(rawValue))
        out[rawKey] = rawValue as OutcomeMove
    }
  }
  return out
}

const UP =
  /\b(?:right(?:ward)?|increase[sd]?|rise[sns]?|rose|up(?:ward)?|higher|outward)\b|右移|向右|增加|上升|上涨|提高|升高/i
const DOWN =
  /\b(?:left(?:ward)?|decrease[sd]?|fall[sn]?|fell|down(?:ward)?|lower|inward|drop[sp]?(?:ed)?)\b|左移|向左|减少|下降|下跌|降低/i
const NONE =
  /\b(?:no (?:shift|change)|unchanged|does not (?:shift|change)|doesn't (?:shift|change)|stays?(?: the same)?)\b|不变|不移动|不动|没有变化/i
const AMBIGUOUS =
  /\b(?:ambiguous|indeterminate|uncertain|cannot be determined|depends)\b|不确定|无法确定|不一定|取决于/i

function readMove(sentence: string): OutcomeMove | null {
  if (AMBIGUOUS.test(sentence)) return 'ambiguous'
  if (NONE.test(sentence)) return 'unchanged'
  const up = UP.test(sentence)
  const down = DOWN.test(sentence)
  if (up && !down) return 'increase'
  if (down && !up) return 'decrease'
  return null
}

/**
 * A written answer ("Demand shifts right; price rises; quantity is
 * ambiguous", 「需求右移，价格上升，数量不确定」) read clause by clause. Only
 * clauses naming one component are used; null when nothing is read.
 */
export function readShiftText(text: string): Partial<ShiftAnswer> | null {
  const coded = decodeShiftAnswer(text)
  if (coded) return coded
  const out: Partial<ShiftAnswer> = {}
  const subject: Array<[ShiftComponent, RegExp]> = [
    ['demand', /\bdemand\b|需求/i],
    ['supply', /\bsupply\b|供给|供应/i],
    ['price', /\bprices?\b|\bP\*?\b|价格/i],
    ['quantity', /\bquantity\b|\bQ\*?\b|数量|产量|交易量/i],
  ]
  for (const clause of text.split(/[.;。；，,\n]|\band\b|而且|并且/i)) {
    const named = subject.filter(([, pattern]) => pattern.test(clause))
    if (named.length !== 1) continue
    const [key] = named[0]!
    const move = readMove(clause)
    if (!move) continue
    if (key === 'demand' || key === 'supply') {
      if (move === 'ambiguous') continue
      out[key] = move === 'unchanged' ? 'none' : move
    } else out[key] = move
  }
  return Object.keys(out).length ? out : null
}

// --- drawing ----------------------------------------------------------------------

export interface CurveDrag {
  /** Rightward movement (quantity units). */
  dq: number
  /** Upward movement (price units). */
  dp: number
}

export interface DrawAnswer {
  demand?: CurveDrag
  supply?: CurveDrag
  /** The policy line the student set (price, or quantity for a quota). */
  policy?: number
  /** The new equilibrium the student marked. */
  point?: { q: number; p: number }
  region?: RegionKey
}

function num(text: string | undefined): number | null {
  if (text === undefined) return null
  const n = Number(text.trim().replace('−', '-'))
  return Number.isFinite(n) ? n : null
}

/** `draw: demand=10,0; supply=0,0; policy=40; point=30,45; region=dwl` (dq,dp and q,p). */
export function encodeDrawAnswer(answer: DrawAnswer): string {
  const round = (n: number) => String(Math.round(n * 1000) / 1000)
  const pieces: string[] = []
  if (answer.demand) pieces.push(`demand=${round(answer.demand.dq)},${round(answer.demand.dp)}`)
  if (answer.supply) pieces.push(`supply=${round(answer.supply.dq)},${round(answer.supply.dp)}`)
  if (answer.policy !== undefined) pieces.push(`policy=${round(answer.policy)}`)
  if (answer.point) pieces.push(`point=${round(answer.point.q)},${round(answer.point.p)}`)
  if (answer.region) pieces.push(`region=${answer.region}`)
  return `draw: ${pieces.join('; ')}`
}

export function decodeDrawAnswer(text: string): DrawAnswer | null {
  const match = /^\s*draw\s*:\s*(.*)$/is.exec(text.trim())
  if (!match) return null
  const out: DrawAnswer = {}
  for (const piece of match[1]!.split(';')) {
    const [rawKey, rawValue] = piece.split('=').map((s) => s?.trim())
    if (!rawKey || rawValue === undefined) continue
    const pair = rawValue.split(',').map((s) => num(s))
    if (rawKey === 'demand' || rawKey === 'supply' || rawKey === 'point') {
      if (pair.length !== 2 || pair[0] === null || pair[1] === null) continue
      if (rawKey === 'point') out.point = { q: pair[0]!, p: pair[1]! }
      else out[rawKey] = { dq: pair[0]!, dp: pair[1]! }
    } else if (rawKey === 'policy') {
      const n = num(rawValue)
      if (n !== null) out.policy = n
    } else if (rawKey === 'region' && (REGION_KEYS as readonly string[]).includes(rawValue)) {
      out.region = rawValue as RegionKey
    }
  }
  return out
}

/**
 * A 1 / 2 / 5 × 10ⁿ tick step for about `targetCount` ticks over `span` — the
 * same as `niceTickStep` of the tutor figures (kept here so the question model
 * does not pull in mathjs).
 */
export function niceTickStep(span: number, targetCount = 8): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const rough = span / Math.max(1, targetCount)
  const power = Math.floor(Math.log10(rough))
  const base = Math.pow(10, power)
  const normalized = rough / base
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return step * base
}

/**
 * Axis ranges of a market figure (the full scenario fits, rounded up to a nice
 * number). The tutor figure, the question figures and the drawing tolerances
 * all use these.
 */
export function figureRanges(solution: MarketSolution): { q: number; p: number } {
  const qs = [solution.original.q.value, solution.outcome.q.value]
  const ps = [solution.original.p.value, solution.outcome.p.value]
  for (const curve of [solution.demand, solution.newDemand]) {
    if (!curve) continue
    const c = curveNumbers(curve)
    if (c.kind === 'sloped' && c.slope < 0) {
      ps.push(c.intercept)
      qs.push(-c.intercept / c.slope)
    }
  }
  if (solution.gap) qs.push(solution.gap.q1)
  for (const n of [solution.buyerPrice, solution.sellerPrice, solution.control?.price]) {
    if (n) ps.push(n.value)
  }
  if (solution.trade) ps.push(solution.trade.worldPrice.value, solution.trade.domesticPrice.value)
  for (const curve of [solution.supply, solution.newSupply]) {
    if (!curve) continue
    const c = curveNumbers(curve)
    if (c.kind === 'vertical') qs.push(c.quantity)
  }
  const nice = (values: number[]) => {
    const top = Math.max(...values.filter((v) => Number.isFinite(v) && v > 0)) * 1.1
    const step = niceTickStep(top, 5)
    return Math.ceil(top / step) * step
  }
  return { q: nice(qs), p: nice(ps) }
}

/** The tolerances a drawing is judged with: a share of each axis. */
export const DRAW_TOLERANCE = {
  /** A curve counts as moved beyond this share of the quantity axis. */
  moved: 0.025,
  /** A stated shift amount: within 10 % of it or this share of the axis. */
  amount: 0.04,
  /** A policy line or the marked equilibrium: within this share of each axis. */
  point: 0.03,
}

/** Horizontal displacement of a curve at price p (quantity units; vertical curves too). */
function horizontalShift(before: MarketCurve, after: MarketCurve, p: number): number | null {
  const at = (curve: MarketCurve) => {
    const c = curveNumbers(curve)
    if (c.kind === 'vertical') return c.quantity
    if (c.slope === 0) return null
    return (p - c.intercept) / c.slope
  }
  const q0 = at(before)
  const q1 = at(after)
  // Horizontal curves have no quantity at a price: their direction is read
  // from the vertical movement instead (`verticalShift`).
  return q0 !== null && q1 !== null ? q1 - q0 : null
}

/** A curve's vertical displacement at quantity q (price units), for horizontal curves. */
function verticalShift(before: MarketCurve, after: MarketCurve, q: number): number | null {
  const c0 = curveNumbers(before)
  const c1 = curveNumbers(after)
  if (c0.kind !== 'sloped' || c1.kind !== 'sloped') return null
  return c1.intercept + c1.slope * q - (c0.intercept + c0.slope * q)
}

/**
 * How a side's curve moves in the scenario: its displacement at the original
 * equilibrium price (positive = more is demanded / supplied at that price), or
 * null when that side does not move.
 */
export interface ExpectedMove {
  side: CurveSide
  /** Quantity displacement at the original equilibrium price. */
  dq: number
  /** For a tax / subsidy: the vertical amount. */
  dp?: number
  direction: 'increase' | 'decrease'
}

function sign(n: number): number {
  return n > 1e-9 ? 1 : n < -1e-9 ? -1 : 0
}

/** The curve movements a drawing of this scenario must show. */
export function expectedMoves(spec: MarketSpec, solution: MarketSolution): ExpectedMove[] {
  const p0 = solution.original.p.value
  const q0 = solution.original.q.value
  const moves: ExpectedMove[] = []
  const add = (side: CurveSide, before: MarketCurve, after: MarketCurve | undefined) => {
    if (!after) return
    let dq = horizontalShift(before, after, p0)
    let direction: 'increase' | 'decrease' | null = null
    if (dq !== null && Math.abs(dq) > 1e-9) direction = dq > 0 ? 'increase' : 'decrease'
    else {
      const dp = verticalShift(before, after, q0)
      if (dp === null || Math.abs(dp) < 1e-9) return
      // A horizontal demand curve moving up is an increase; supply up is a decrease.
      direction = (side === 'demand') === dp > 0 ? 'increase' : 'decrease'
      dq = 0
    }
    const scenario = spec.scenario
    const taxed =
      (scenario.kind === 'tax' || scenario.kind === 'subsidy') &&
      scenario.on === (side === 'demand' ? 'buyers' : 'sellers')
    const dp = taxed ? (verticalShift(before, after, q0) ?? undefined) : undefined
    moves.push({ side, dq, direction, ...(dp !== undefined ? { dp } : {}) })
  }
  add('demand', solution.demand, solution.newDemand)
  add('supply', solution.supply, solution.newSupply)
  return moves
}

/** The policy line a drawing must set (price or quantity), or null. */
export function expectedPolicy(
  spec: MarketSpec,
): { axis: 'price' | 'quantity'; value: number } | null {
  const scenario = spec.scenario
  switch (scenario.kind) {
    case 'ceiling':
    case 'floor':
      return { axis: 'price', value: scenario.price }
    case 'trade':
      return { axis: 'price', value: scenario.worldPrice }
    case 'quota':
      return { axis: 'quantity', value: scenario.quantity }
    default:
      return null
  }
}

/** The point a drawing must mark: the new outcome (buyers' price, quantity traded). */
export function expectedPoint(solution: MarketSolution): { q: number; p: number } {
  return { q: solution.outcome.q.value, p: solution.outcome.p.value }
}

/** Regions a scenario offers to select (after the change), grouped by kind. */
export function regionCandidates(solution: MarketSolution): RegionKey[] {
  const kinds = new Set<AreaKind>()
  for (const area of solution.areas) {
    if (area.effect || area.phase !== 'after' || area.kind === 'total_revenue') continue
    if (area.area.value <= 0) continue
    kinds.add(area.kind)
  }
  return REGION_KEYS.filter((key) => kinds.has(key))
}

/** The student's drawing as a market (null when it makes no sense). */
export function drawnSpec(spec: MarketSpec, answer: DrawAnswer): MarketSpec {
  const moved = (drag: CurveDrag | undefined) =>
    !!drag && (Math.abs(drag.dq) > 1e-9 || Math.abs(drag.dp) > 1e-9)
  const scenario = spec.scenario
  const original = { demand: spec.demand, supply: spec.supply }
  // A policy line: the same policy at the student's value (none placed: no policy yet).
  if (expectedPolicy(spec)) {
    const base: MarketSpec = {
      demand: moved(answer.demand) ? nudgeCurveSpec(spec.demand, answer.demand!) : spec.demand,
      supply: moved(answer.supply) ? nudgeCurveSpec(spec.supply, answer.supply!) : spec.supply,
      scenario: { kind: 'equilibrium' },
    }
    return answer.policy !== undefined
      ? exploreMarket({ ...base, scenario }, { policy: answer.policy })
      : base
  }
  // A tax / subsidy drawn as the taxed side moved vertically: that tax.
  if (scenario.kind === 'tax' || scenario.kind === 'subsidy') {
    const drag = scenario.on === 'buyers' ? answer.demand : answer.supply
    const other = scenario.on === 'buyers' ? answer.supply : answer.demand
    if (!moved(other) && drag && Math.abs(drag.dq) < 1e-9 && Math.abs(drag.dp) > 1e-9) {
      // Sellers' tax: supply up; buyers' tax: demand down (a subsidy the other way).
      const up = scenario.on === 'sellers' ? drag.dp : -drag.dp
      const kind = up > 0 ? 'tax' : 'subsidy'
      return { ...original, scenario: { kind, amount: Math.abs(up), on: scenario.on } }
    }
  }
  // Otherwise every drawn movement is a shift of that curve.
  const shift: { demand?: CurveShift; supply?: CurveShift } = {}
  if (moved(answer.demand)) shift.demand = { dq: answer.demand!.dq, dp: answer.demand!.dp }
  if (moved(answer.supply)) shift.supply = { dq: answer.supply!.dq, dp: answer.supply!.dp }
  return shift.demand || shift.supply
    ? { ...original, scenario: { kind: 'shift', ...shift } }
    : { ...original, scenario: { kind: 'equilibrium' } }
}

/** Where the student's drawn curve is (resolved), for one side. */
function drawnCurve(spec: MarketSpec, answer: DrawAnswer, side: CurveSide): MarketCurve | null {
  const drag = answer[side]
  const written = side === 'demand' ? spec.demand : spec.supply
  const resolved = resolveCurve(drag ? nudgeCurveSpec(written, drag) : written, side)
  return resolved.ok ? resolved.value : null
}

// --- rubric -----------------------------------------------------------------------

const MARKS =
  /[([]\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?|分)?\s*[)\]]|(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?|分)\b|\b([MAB])(\d)\b/i

/** Points written on a rubric line ("(1 mark)", "[2]", "1 pt", "2分", "B1"); 1 when none. */
export function rubricLinePoints(line: string): number {
  const match = MARKS.exec(line)
  if (!match) return 1
  const n = Number(match[1] ?? match[2] ?? match[4])
  return Number.isFinite(n) && n > 0 ? n : 1
}

type GradedKey = MarketItemResult['key']

/** The items a rubric line speaks of (empty: it cannot be graded automatically). */
export function rubricLineKeys(line: string, kind: MarketQuestionKind): GradedKey[] {
  const text = line.toLowerCase()
  if (kind === 'shift_id') {
    const keys: GradedKey[] = []
    const shifts = /shift|move|curve|右移|左移|移动|增加|减少|increase|decrease/i.test(text)
    if (/\bdemand\b|需求/.test(text) && shifts) keys.push('demand')
    if (/\bsupply\b|供给|供应/.test(text) && shifts) keys.push('supply')
    if (/\bprice|p\*|价格/.test(text)) keys.push('price')
    if (/\bquantit|q\*|数量|产量/.test(text)) keys.push('quantity')
    if (keys.length === 0 && /equilibri|均衡/.test(text)) keys.push('price', 'quantity')
    return keys
  }
  if (kind === 'area_read') return ['value']
  const keys: GradedKey[] = []
  if (/shift|move|curve|右移|左移|移动|曲线/.test(text)) keys.push('curve', 'direction')
  if (/ceiling|floor|quota|world price|price line|上限|下限|配额|世界价格|价格线/.test(text))
    keys.push('policy')
  if (/equilibri|new p|new q|p and q|p\*|q\*|均衡/.test(text)) keys.push('equilibrium')
  if (/shad|area|dwl|deadweight|surplus|revenue|rent|无谓|剩余|阴影|面积|税收|租金/.test(text))
    keys.push('region')
  return keys
}

function gradeWithRubric(
  question: MarketQuestion,
  items: MarketItemResult[],
): Pick<MarketGradeResult, 'earned' | 'total' | 'rubricSource' | 'rubricLines'> {
  const rubric = question.rubric
  if (rubric?.source === 'professor' && rubric.lines.length > 0) {
    const present = new Set(items.map((item) => item.key))
    const lines: RubricLineResult[] = rubric.lines.map((text) => {
      const keys = rubricLineKeys(text, question.kind).filter((key) => present.has(key))
      const points = rubricLinePoints(text)
      const passed =
        keys.length > 0 && keys.every((key) => items.find((item) => item.key === key)?.correct)
      return { text, points, keys, earned: passed ? points : 0 }
    })
    const graded = lines.filter((line) => line.keys.length > 0)
    if (graded.length > 0) {
      return {
        rubricSource: 'professor',
        rubricLines: lines,
        earned: graded.reduce((sum, line) => sum + line.earned, 0),
        total: graded.reduce((sum, line) => sum + line.points, 0),
      }
    }
  }
  return {
    rubricSource: 'platform',
    earned: items.filter((item) => item.correct).length,
    total: items.length,
  }
}

// --- grading ----------------------------------------------------------------------

export function gradeShiftId(question: MarketQuestion, answer: string): MarketGradeResult | null {
  const solution = solveQuestion(question)
  if (!solution) return null
  const expected = expectedShift(solution, question.qualitative ?? true, question.figure.spec)
  if (!expected) return null
  const given = readShiftText(answer)
  if (!given) {
    return {
      kind: 'shift_id',
      items: SHIFT_COMPONENTS.map((key) => ({
        key,
        correct: false,
        expected: expected[key],
        given: null,
      })),
      earned: 0,
      total: SHIFT_COMPONENTS.length,
      rubricSource: 'platform',
      unreadable: true,
    }
  }
  const items: MarketItemResult[] = SHIFT_COMPONENTS.map((key) => ({
    key,
    correct: given[key] === expected[key],
    expected: expected[key],
    given: given[key] ?? null,
  }))
  return { kind: 'shift_id', items, ...gradeWithRubric(question, items) }
}

export function gradeAreaRead(question: MarketQuestion, answer: string): MarketGradeResult | null {
  const solution = solveQuestion(question)
  const target = question.target
  if (!solution || !target) return null
  const value = marketValue(solution, target)
  if (!value) return null
  const spec = targetEconSpec(target, question.figure)
  const comparison = compareEconNumber(answer, exactDecimal(value), spec)
  if (comparison.outcome === 'unreadable')
    return {
      kind: 'area_read',
      items: [{ key: 'value', correct: false, expected: exactDecimal(value), given: answer }],
      earned: 0,
      total: 1,
      rubricSource: 'platform',
      unreadable: true,
    }
  const items: MarketItemResult[] = [
    {
      key: 'value',
      correct: comparison.outcome === 'correct',
      expected: exactDecimal(value),
      given: answer.trim(),
      ...(comparison.note ? { reason: comparison.note } : {}),
    },
  ]
  return {
    kind: 'area_read',
    items,
    ...gradeWithRubric(question, items),
    ...(comparison.note ? { note: comparison.note } : {}),
  }
}

/** Grade a drawing item by item against the engine's solution. */
export function gradeDraw(question: MarketQuestion, answer: string): MarketGradeResult | null {
  const spec = question.figure.spec
  const solution = solveQuestion(question)
  const task = question.draw
  if (!solution || !task) return null
  const drawn = decodeDrawAnswer(answer)
  if (!drawn) {
    const items = task.items.map((key) => ({ key, correct: false, reason: 'unreadable' }))
    return {
      kind: 'draw_diagram',
      items,
      earned: 0,
      total: items.length,
      rubricSource: 'platform',
      unreadable: true,
    }
  }
  const ranges = figureRanges(solution)
  const base = solveMarket({ ...spec, scenario: { kind: 'equilibrium' } })
  const original = base.ok ? base.solution : solution
  const p0 = solution.original.p.value
  const q0 = solution.original.q.value
  const expected = expectedMoves(spec, solution)
  const expectedSides = new Set(expected.map((move) => move.side))

  // The student's displacement of each side, at the original price.
  const studentMove = (side: CurveSide): { dq: number; dp: number } | null => {
    if (!drawn[side]) return { dq: 0, dp: 0 }
    const curve = drawnCurve(spec, drawn, side)
    if (!curve) return null
    const before = side === 'demand' ? original.demand : original.supply
    const dq = horizontalShift(before, curve, p0)
    const dp = verticalShift(before, curve, q0)
    return { dq: dq ?? 0, dp: dp ?? 0 }
  }
  const movedBeyond = (move: { dq: number; dp: number } | null, side: CurveSide): boolean => {
    if (!move) return false
    const before = side === 'demand' ? original.demand : original.supply
    const c = curveNumbers(before)
    if (c.kind === 'sloped' && c.slope === 0)
      return Math.abs(move.dp) > DRAW_TOLERANCE.moved * ranges.p
    // Moved visibly along either axis (a steep curve moves little sideways).
    return (
      Math.abs(move.dq) > DRAW_TOLERANCE.moved * ranges.q ||
      (c.kind === 'sloped' && Math.abs(move.dp) > DRAW_TOLERANCE.moved * ranges.p)
    )
  }
  const directionOf = (move: { dq: number; dp: number }, side: CurveSide): number => {
    const before = side === 'demand' ? original.demand : original.supply
    const c = curveNumbers(before)
    if (c.kind === 'sloped' && c.slope === 0)
      return side === 'demand' ? sign(move.dp) : -sign(move.dp)
    return sign(move.dq)
  }

  const items: MarketItemResult[] = []
  for (const key of task.items) {
    switch (key) {
      case 'curve': {
        const moved = (['demand', 'supply'] as const).filter((side) =>
          movedBeyond(studentMove(side), side),
        )
        const extra = moved.filter((side) => !expectedSides.has(side))
        const missing = [...expectedSides].filter((side) => !moved.includes(side))
        items.push({
          key,
          correct: extra.length === 0 && missing.length === 0,
          expected: [...expectedSides].join('+') || 'none',
          given: moved.join('+') || 'none',
          ...(extra.length
            ? { reason: 'extra-curve' }
            : missing.length
              ? { reason: 'not-moved' }
              : {}),
        })
        break
      }
      case 'direction': {
        let correct = expected.length > 0
        let reason: string | undefined
        for (const move of expected) {
          const got = studentMove(move.side)
          if (!got || !movedBeyond(got, move.side)) {
            correct = false
            reason ??= 'not-moved'
            continue
          }
          const want = move.direction === 'increase' ? 1 : -1
          if (directionOf(got, move.side) !== want) {
            correct = false
            reason = 'wrong-direction'
          }
        }
        items.push({
          key,
          correct,
          expected: expected.map((move) => `${move.side}:${move.direction}`).join(' '),
          ...(reason ? { reason } : {}),
        })
        break
      }
      case 'amount': {
        let correct = expected.length > 0
        for (const move of expected) {
          const got = studentMove(move.side)
          if (!got) {
            correct = false
            continue
          }
          if (move.dp !== undefined) {
            const tolerance = Math.max(0.1 * Math.abs(move.dp), DRAW_TOLERANCE.amount * ranges.p)
            if (Math.abs(got.dp - move.dp) > tolerance) correct = false
          } else {
            const tolerance = Math.max(0.1 * Math.abs(move.dq), DRAW_TOLERANCE.amount * ranges.q)
            if (Math.abs(got.dq - move.dq) > tolerance) correct = false
          }
        }
        items.push({
          key,
          correct,
          expected: expected.map((move) => `${move.side}:${round3(move.dp ?? move.dq)}`).join(' '),
          ...(correct ? {} : { reason: 'wrong-amount' }),
        })
        break
      }
      case 'policy': {
        const policy = expectedPolicy(spec)
        const range = policy?.axis === 'quantity' ? ranges.q : ranges.p
        const correct =
          !!policy &&
          drawn.policy !== undefined &&
          Math.abs(drawn.policy - policy.value) <= DRAW_TOLERANCE.point * range
        items.push({
          key,
          correct,
          ...(policy ? { expected: String(policy.value) } : {}),
          given: drawn.policy !== undefined ? String(round3(drawn.policy)) : null,
          ...(correct ? {} : { reason: drawn.policy === undefined ? 'missing' : 'misplaced' }),
        })
        break
      }
      case 'equilibrium': {
        const target = expectedPoint(solution)
        const point = drawn.point
        const correct =
          !!point &&
          Math.abs(point.q - target.q) <= DRAW_TOLERANCE.point * ranges.q &&
          Math.abs(point.p - target.p) <= DRAW_TOLERANCE.point * ranges.p
        items.push({
          key,
          correct,
          expected: `${round3(target.q)}, ${round3(target.p)}`,
          given: point ? `${round3(point.q)}, ${round3(point.p)}` : null,
          ...(correct ? {} : { reason: point ? 'misplaced' : 'missing' }),
        })
        break
      }
      case 'region': {
        const correct = !!task.region && drawn.region === task.region
        items.push({
          key,
          correct,
          ...(task.region ? { expected: task.region } : {}),
          given: drawn.region ?? null,
          ...(correct ? {} : { reason: drawn.region ? 'wrong-region' : 'missing' }),
        })
        break
      }
    }
  }
  return { kind: 'draw_diagram', items, ...gradeWithRubric(question, items) }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function gradeMarketQuestion(
  question: MarketQuestion,
  answer: string,
): MarketGradeResult | null {
  if (!answer.trim()) return null
  switch (question.kind) {
    case 'shift_id':
      return gradeShiftId(question, answer)
    case 'area_read':
      return gradeAreaRead(question, answer)
    case 'draw_diagram':
      return gradeDraw(question, answer)
  }
}

/** Every item right. */
export function isFullyCorrect(result: MarketGradeResult): boolean {
  return result.items.length > 0 && result.items.every((item) => item.correct)
}

// --- the expected answer, for display ---------------------------------------------

export interface ExpectedMarketAnswer {
  shift?: ShiftAnswer
  value?: { target: MarketValueTarget; number: MarketNumber; text: string }
  draw?: {
    moves: ExpectedMove[]
    policy: { axis: 'price' | 'quantity'; value: number } | null
    point: { q: number; p: number }
    region?: RegionKey
  }
}

export function expectedMarketAnswer(question: MarketQuestion): ExpectedMarketAnswer | null {
  const solution = solveQuestion(question)
  if (!solution) return null
  switch (question.kind) {
    case 'shift_id': {
      const shift = expectedShift(solution, question.qualitative ?? true, question.figure.spec)
      return shift ? { shift } : null
    }
    case 'area_read': {
      if (!question.target) return null
      const number = marketValue(solution, question.target)
      return number
        ? {
            value: {
              target: question.target,
              number,
              text: formatTargetValue(number, question.target, question.figure),
            },
          }
        : null
    }
    case 'draw_diagram':
      return {
        draw: {
          moves: expectedMoves(question.figure.spec, solution),
          policy: expectedPolicy(question.figure.spec),
          point: expectedPoint(solution),
          ...(question.draw?.region ? { region: question.draw.region } : {}),
        },
      }
  }
}

/** The expected answer encoded the way a student answer is (for a "show answer" fill-in). */
export function expectedAnswerCode(question: MarketQuestion): string | null {
  const expected = expectedMarketAnswer(question)
  if (!expected) return null
  if (expected.shift) return encodeShiftAnswer(expected.shift)
  if (expected.value) return exactDecimal(expected.value.number)
  if (expected.draw) {
    const answer: DrawAnswer = { point: expected.draw.point }
    const solution = solveQuestion(question)
    for (const move of expected.draw.moves) {
      const after = move.side === 'demand' ? solution?.newDemand : solution?.newSupply
      const before = move.side === 'demand' ? solution?.demand : solution?.supply
      if (!after || !before) continue
      const a = curveNumbers(after)
      const b = curveNumbers(before)
      answer[move.side] =
        a.kind === 'sloped' && b.kind === 'sloped'
          ? { dq: 0, dp: a.intercept - b.intercept }
          : a.kind === 'vertical' && b.kind === 'vertical'
            ? { dq: a.quantity - b.quantity, dp: 0 }
            : { dq: move.dq, dp: 0 }
    }
    if (expected.draw.policy) answer.policy = expected.draw.policy.value
    if (expected.draw.region) answer.region = expected.draw.region
    return encodeDrawAnswer(answer)
  }
  return null
}

// --- reading untrusted payloads --------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const SHOWS: readonly FigureShow[] = ['curves', 'before', 'after']

/**
 * A graph question from untrusted JSON (a model reply, a stored row): the
 * spec must parse AND solve, the target must apply to the solved market, a
 * shift question must have a definite expected answer. Null otherwise.
 */
export function parseMarketQuestion(value: unknown): MarketQuestion | null {
  const item = record(value)
  if (!item) return null
  const kind = item.kind
  if (kind !== 'shift_id' && kind !== 'area_read' && kind !== 'draw_diagram') return null
  const figureItem = record(item.figure) ?? item
  const spec = parseMarketSpec(figureItem.spec ?? figureItem.market ?? item.market)
  if (!spec) return null
  const show = SHOWS.includes(figureItem.show as FigureShow)
    ? (figureItem.show as FigureShow)
    : defaultShow(kind)
  const scale = parseQuantityScale(figureItem.quantityScale)
  const figure: MarketFigure = {
    spec,
    show,
    ...(typeof figureItem.priceUnit === 'string' && figureItem.priceUnit.length <= 4
      ? { priceUnit: figureItem.priceUnit }
      : {}),
    ...(typeof figureItem.quantityUnit === 'string' && figureItem.quantityUnit.length <= 24
      ? { quantityUnit: figureItem.quantityUnit }
      : {}),
    ...(scale ? { quantityScale: scale } : {}),
  }
  const question: MarketQuestion = { kind, figure }
  if (kind === 'area_read') {
    if (!(MARKET_VALUE_TARGETS as readonly unknown[]).includes(item.target)) return null
    question.target = item.target as MarketValueTarget
  }
  if (kind === 'draw_diagram') {
    const draw = record(item.draw)
    const rawItems = Array.isArray(draw?.items) ? draw.items : []
    const items = DRAW_ITEM_KEYS.filter((key) => rawItems.includes(key))
    const region =
      typeof draw?.region === 'string' && (REGION_KEYS as readonly string[]).includes(draw.region)
        ? (draw.region as RegionKey)
        : undefined
    question.draw = { items, ...(region ? { region } : {}) }
  }
  if (item.qualitative === false) question.qualitative = false
  const rubric = record(item.rubric)
  if (rubric && Array.isArray(rubric.lines)) {
    const lines = rubric.lines.filter(
      (line): line is string => typeof line === 'string' && !!line.trim(),
    )
    if (lines.length)
      question.rubric = { source: rubric.source === 'professor' ? 'professor' : 'platform', lines }
  }
  return validateMarketQuestion(question) ? question : null
}

export function defaultShow(kind: MarketQuestionKind): FigureShow {
  void kind
  return 'before'
}

/** A question the engine can grade: solvable, its target applies, its drawing items make sense. */
export function validateMarketQuestion(question: MarketQuestion): boolean {
  const solution = solveQuestion(question)
  if (!solution) return false
  switch (question.kind) {
    case 'shift_id':
      return expectedShift(solution, question.qualitative ?? true, question.figure.spec) !== null
    case 'area_read':
      return !!question.target && marketValue(solution, question.target) !== null
    case 'draw_diagram': {
      const task = question.draw
      if (!task || task.items.length === 0) return false
      const moves = expectedMoves(question.figure.spec, solution)
      const policy = expectedPolicy(question.figure.spec)
      for (const key of task.items) {
        if ((key === 'curve' || key === 'direction' || key === 'amount') && moves.length === 0)
          return false
        if (key === 'policy' && !policy) return false
        if (key === 'region' && (!task.region || !regionCandidates(solution).includes(task.region)))
          return false
        if (key === 'equilibrium' && solution.scenario === 'equilibrium') return false
      }
      return true
    }
  }
}

/** The numbers of a curve spec, rounded (used to compare with a stated answer key). */
export function curveIntercepts(spec: MarketSpec): {
  demand: ReturnType<typeof curveNumbers> | null
  supply: ReturnType<typeof curveNumbers> | null
} {
  const d = resolveCurve(spec.demand, 'demand')
  const s = resolveCurve(spec.supply, 'supply')
  return {
    demand: d.ok ? curveNumbers(d.value) : null,
    supply: s.ok ? curveNumbers(s.value) : null,
  }
}

/**
 * The kind of error of a wrong graph answer, for 错题跟进: a value read from
 * the diagram (`value`), only directions reversed (`sign`), or a misdrawn /
 * misidentified diagram (`concept`).
 */
export function marketErrorDimension(
  result: MarketGradeResult,
): 'sign' | 'concept' | 'value' | undefined {
  const wrong = result.items.filter((item) => !item.correct)
  if (wrong.length === 0) return undefined
  if (result.kind === 'area_read') return 'value'
  const opposite = (item: MarketItemResult) =>
    item.reason === 'wrong-direction' ||
    (item.expected === 'increase' && item.given === 'decrease') ||
    (item.expected === 'decrease' && item.given === 'increase')
  return wrong.every(opposite) ? 'sign' : 'concept'
}
