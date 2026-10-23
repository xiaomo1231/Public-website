/**
 * Linear supply-and-demand markets, solved exactly.
 *
 * Pure, dependency-free (apart from the exact-fraction helpers in `rref.ts`)
 * and shared by the tutor figure `market_2d` and graded graph questions. The
 * model (or a question author) supplies only curves and a scenario; every
 * equilibrium, price, quantity, area, incidence share and elasticity is
 * computed here with BigInt fractions, so 400/3 stays 400/3 and no rounding
 * tolerance is needed when comparing.
 *
 * Conventions (introductory micro): price P on the vertical axis, quantity Q
 * on the horizontal axis. A sloped curve is P = a + b·Q; a vertical curve is
 * Q = q₀ (perfectly inelastic), a horizontal curve P = p₀ (perfectly
 * elastic). For surplus purposes a vertical supply curve has zero marginal
 * cost up to q₀ and a sloped supply curve with a negative price intercept
 * starts on the quantity axis (marginal cost never below 0).
 *
 * Anything that would draw a wrong picture — curves that do not meet in the
 * positive quadrant, a negative price, a demand curve sloping up — is
 * rejected with a machine-readable reason rather than approximated.
 *
 * Public API (see the exported functions and types below):
 *   - `resolveCurve(spec)` — CurveSpec → MarketCurve (exact).
 *   - `solveMarket(spec)` — MarketSpec → { ok, solution } | { ok: false, reason }.
 *   - `equilibriumOf`, `priceAt`, `quantityAt`, `shiftCurve` — curve maths.
 *   - `pointElasticity`, `midpointElasticity`, `classifyElasticity`.
 *   - `scaleScenario(spec, fraction)` — the scenario `fraction` of the way
 *     from "no change" to the full change (animation, sliders).
 *   - `BOTH_SHIFT_CASES` — the four textbook cases when both curves shift.
 *   - `formatMarketNumber`, `quantityScaleFactor` — display helpers.
 */
import { formatRational, rational, type Rational } from '@/infrastructure/math/rref'

// --- exact numbers ---------------------------------------------------------------

/** An exactly computed value plus its floating-point approximation for drawing. */
export interface MarketNumber {
  value: number
  exact: Rational
}

export interface MarketPoint {
  q: MarketNumber
  p: MarketNumber
}

/** A plain drawing coordinate (quantity, price). */
export interface PlotPoint {
  q: number
  p: number
}

const R = rational
const ZERO = R.of(0n)
const ONE = R.of(1n)
const HALF = R.of(1n, 2n)

/** Largest magnitude accepted for any input number. */
export const MARKET_MAX_MAGNITUDE = 1e9

/** Convert an input number to an exact fraction (12 decimal places at most). */
export function toRational(value: number): Rational | null {
  if (!Number.isFinite(value) || Math.abs(value) > MARKET_MAX_MAGNITUDE) return null
  if (Number.isInteger(value)) return R.of(BigInt(value))
  const text = value.toFixed(12)
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const trimmed = fraction.replace(/0+$/, '')
  const n = BigInt(whole + trimmed) * (negative ? -1n : 1n)
  return R.of(n, 10n ** BigInt(trimmed.length))
}

export function toNumber(value: Rational): number {
  return Number(value.n) / Number(value.d)
}

function mn(exact: Rational): MarketNumber {
  return { value: toNumber(exact), exact }
}

function cmp(a: Rational, b: Rational): number {
  const diff = a.n * b.d - b.n * a.d
  return diff > 0n ? 1 : diff < 0n ? -1 : 0
}
const lt = (a: Rational, b: Rational) => cmp(a, b) < 0
const le = (a: Rational, b: Rational) => cmp(a, b) <= 0
const gt = (a: Rational, b: Rational) => cmp(a, b) > 0
const max = (a: Rational, b: Rational) => (gt(a, b) ? a : b)
const min = (a: Rational, b: Rational) => (lt(a, b) ? a : b)
const neg = (a: Rational) => R.of(-a.n, a.d)
const abs = (a: Rational) => (a.n < 0n ? neg(a) : a)
const sign = (a: Rational) => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0)

/**
 * Display a computed number: integers and terminating decimals exactly
 * (`120`, `2.5`), anything else rounded with a leading ≈ (`≈ 133.33`).
 */
export function formatMarketNumber(value: MarketNumber | Rational, digits = 2): string {
  const exact = 'exact' in value ? value.exact : value
  let d = exact.d
  while (d % 2n === 0n) d /= 2n
  while (d % 5n === 0n) d /= 5n
  const number = toNumber(exact)
  const terminating = d === 1n
  if (terminating) {
    const text = String(Number(number.toFixed(10)))
    const decimals = text.split('.')[1]?.length ?? 0
    if (decimals <= Math.max(digits, 4)) return text.replace('-', '−')
  }
  const rounded = Number(number.toFixed(digits))
  return `≈ ${String(rounded).replace('-', '−')}`
}

/** `400/3`-style exact text (useful in tests and grading feedback). */
export function exactText(value: MarketNumber | Rational): string {
  return formatRational('exact' in value ? value.exact : value)
}

// --- curves ----------------------------------------------------------------------

export type CurveSide = 'demand' | 'supply'

/** How a lesson (or the model) writes a curve. Numbers are copied verbatim. */
export type CurveSpec =
  /** P = intercept + slope · Q */
  | { form: 'price'; intercept: number; slope: number }
  /** Q = intercept + slope · P */
  | { form: 'quantity'; intercept: number; slope: number }
  /** Two (Q, P) points on the line. */
  | { form: 'points'; points: [PlotPoint, PlotPoint] }
  /** Perfectly inelastic: Q = quantity at every price. */
  | { form: 'vertical'; quantity: number }
  /** Perfectly elastic: P = price at every quantity. */
  | { form: 'horizontal'; price: number }

/** A resolved curve: P = a + b·Q (b = 0 is horizontal) or vertical Q = q. */
export type MarketCurve =
  { kind: 'sloped'; a: Rational; b: Rational } | { kind: 'vertical'; q: Rational }

export type MarketRejectReason =
  | 'invalid-number'
  | 'invalid-curve'
  | 'demand-slopes-up'
  | 'supply-slopes-down'
  | 'no-equilibrium'
  | 'equilibrium-not-positive'
  | 'new-equilibrium-not-positive'
  | 'negative-price'
  | 'invalid-scenario'
  | 'shift-not-applicable'
  | 'control-needs-sloped-curves'
  | 'market-shut-down'
  | 'tariff-needs-imports'
  | 'tariff-and-quota'

type Result<T> = { ok: true; value: T } | { ok: false; reason: MarketRejectReason }
type Rejected = { ok: false; reason: MarketRejectReason }
const fail = (reason: MarketRejectReason): Rejected => ({ ok: false, reason })
const okv = <T>(value: T): Result<T> => ({ ok: true, value })

/** Resolve a written curve exactly, checking the slope sign for its side. */
export function resolveCurve(spec: CurveSpec, side: CurveSide): Result<MarketCurve> {
  let curve: MarketCurve
  switch (spec.form) {
    case 'price': {
      const a = toRational(spec.intercept)
      const b = toRational(spec.slope)
      if (!a || !b) return fail('invalid-number')
      curve = { kind: 'sloped', a, b }
      break
    }
    case 'quantity': {
      // Q = c + d·P  ⇔  P = −c/d + (1/d)·Q ; d = 0 is a vertical curve Q = c.
      const c = toRational(spec.intercept)
      const d = toRational(spec.slope)
      if (!c || !d) return fail('invalid-number')
      curve = R.isZero(d)
        ? { kind: 'vertical', q: c }
        : { kind: 'sloped', a: R.div(neg(c), d), b: R.div(ONE, d) }
      break
    }
    case 'points': {
      const [p1, p2] = spec.points
      const q1 = toRational(p1.q)
      const q2 = toRational(p2.q)
      const y1 = toRational(p1.p)
      const y2 = toRational(p2.p)
      if (!q1 || !q2 || !y1 || !y2) return fail('invalid-number')
      if (R.equal(q1, q2)) {
        if (R.equal(y1, y2)) return fail('invalid-curve')
        curve = { kind: 'vertical', q: q1 }
      } else {
        const b = R.div(R.sub(y2, y1), R.sub(q2, q1))
        curve = { kind: 'sloped', a: R.sub(y1, R.mul(b, q1)), b }
      }
      break
    }
    case 'vertical': {
      const q = toRational(spec.quantity)
      if (!q) return fail('invalid-number')
      curve = { kind: 'vertical', q }
      break
    }
    case 'horizontal': {
      const p = toRational(spec.price)
      if (!p) return fail('invalid-number')
      curve = { kind: 'sloped', a: p, b: ZERO }
      break
    }
    default:
      return fail('invalid-curve')
  }
  return checkCurve(curve, side)
}

function checkCurve(curve: MarketCurve, side: CurveSide): Result<MarketCurve> {
  if (curve.kind === 'vertical') return lt(curve.q, ZERO) ? fail('invalid-curve') : okv(curve)
  if (side === 'demand' && gt(curve.b, ZERO)) return fail('demand-slopes-up')
  if (side === 'supply' && lt(curve.b, ZERO)) return fail('supply-slopes-down')
  return okv(curve)
}

export const isHorizontal = (curve: MarketCurve): boolean =>
  curve.kind === 'sloped' && R.isZero(curve.b)

/** Price on the curve at quantity q (null for a vertical curve). */
export function priceAt(curve: MarketCurve, q: Rational): Rational | null {
  return curve.kind === 'sloped' ? R.add(curve.a, R.mul(curve.b, q)) : null
}

/**
 * Quantity on the curve at price p, never below 0 (a demand curve above its
 * choke price, or a supply curve below its intercept, gives 0). Null for a
 * horizontal curve, where the quantity is not determined.
 */
export function quantityAt(curve: MarketCurve, p: Rational): Rational | null {
  if (curve.kind === 'vertical') return curve.q
  if (R.isZero(curve.b)) return null
  return max(ZERO, R.div(R.sub(p, curve.a), curve.b))
}

/** Where two curves cross (exact), or null when they are parallel. */
export function intersect(demand: MarketCurve, supply: MarketCurve): PlotPointExact | null {
  if (demand.kind === 'sloped' && supply.kind === 'sloped') {
    const den = R.sub(supply.b, demand.b)
    if (R.isZero(den)) return null
    const q = R.div(R.sub(demand.a, supply.a), den)
    return { q, p: R.add(demand.a, R.mul(demand.b, q)) }
  }
  if (demand.kind === 'vertical' && supply.kind === 'sloped')
    return { q: demand.q, p: R.add(supply.a, R.mul(supply.b, demand.q)) }
  if (supply.kind === 'vertical' && demand.kind === 'sloped')
    return { q: supply.q, p: R.add(demand.a, R.mul(demand.b, supply.q)) }
  return null
}

interface PlotPointExact {
  q: Rational
  p: Rational
}

const point = (q: Rational, p: Rational): MarketPoint => ({ q: mn(q), p: mn(p) })

/** The market equilibrium, required to lie strictly inside the positive quadrant. */
export function equilibriumOf(demand: MarketCurve, supply: MarketCurve): Result<MarketPoint> {
  const cross = intersect(demand, supply)
  if (!cross) return fail('no-equilibrium')
  if (!gt(cross.q, ZERO) || !gt(cross.p, ZERO)) return fail('equilibrium-not-positive')
  return okv(point(cross.q, cross.p))
}

/** How a curve moves in a `shift` scenario. Exactly one way of describing it. */
export interface CurveShift {
  /** The new curve, as the lesson states it. */
  to?: CurveSpec
  /** Horizontal shift (positive = to the right). */
  dq?: number
  /** Vertical shift (positive = up). */
  dp?: number
  /** New slope b in P = a + bQ, rotating about the price intercept or the old equilibrium. */
  slope?: number
  pivot?: 'intercept' | 'equilibrium'
}

/** Move a curve. `at` is the old equilibrium (the pivot for `pivot: 'equilibrium'`). */
export function shiftCurve(
  curve: MarketCurve,
  shift: CurveShift,
  side: CurveSide,
  at?: PlotPointExact,
): Result<MarketCurve> {
  if (shift.to) return resolveCurve(shift.to, side)
  let next: MarketCurve = curve
  if (shift.slope !== undefined) {
    const b = toRational(shift.slope)
    if (!b || curve.kind !== 'sloped') return fail('shift-not-applicable')
    const a = shift.pivot === 'equilibrium' && at ? R.sub(at.p, R.mul(b, at.q)) : curve.a
    next = { kind: 'sloped', a, b }
  }
  if (shift.dp !== undefined) {
    const dp = toRational(shift.dp)
    if (!dp) return fail('invalid-number')
    if (next.kind === 'sloped') next = { kind: 'sloped', a: R.add(next.a, dp), b: next.b }
  }
  if (shift.dq !== undefined) {
    const dq = toRational(shift.dq)
    if (!dq) return fail('invalid-number')
    next =
      next.kind === 'vertical'
        ? { kind: 'vertical', q: R.add(next.q, dq) }
        : { kind: 'sloped', a: R.sub(next.a, R.mul(next.b, dq)), b: next.b }
  }
  return checkCurve(next, side)
}

/** Shift a curve vertically by an exact amount (taxes and subsidies drawn as a shifted curve). */
function raise(curve: MarketCurve, dp: Rational): MarketCurve {
  return curve.kind === 'sloped' ? { kind: 'sloped', a: R.add(curve.a, dp), b: curve.b } : curve
}

/** Numbers for drawing a curve. */
export function curveNumbers(
  curve: MarketCurve,
): { kind: 'sloped'; intercept: number; slope: number } | { kind: 'vertical'; quantity: number } {
  return curve.kind === 'sloped'
    ? { kind: 'sloped', intercept: toNumber(curve.a), slope: toNumber(curve.b) }
    : { kind: 'vertical', quantity: toNumber(curve.q) }
}

// --- elasticity ------------------------------------------------------------------

export type ElasticityClass =
  'perfectly_inelastic' | 'inelastic' | 'unit' | 'elastic' | 'perfectly_elastic'

export interface Elasticity {
  /** Signed elasticity (negative along a demand curve); ±Infinity when perfectly elastic. */
  value: number
  /** Exact value, null when infinite. */
  exact: Rational | null
  /** |e| classified. */
  kind: ElasticityClass
}

export function classifyElasticity(value: number): ElasticityClass {
  const size = Math.abs(value)
  if (size === 0) return 'perfectly_inelastic'
  if (!Number.isFinite(size)) return 'perfectly_elastic'
  if (Math.abs(size - 1) < 1e-12) return 'unit'
  return size < 1 ? 'inelastic' : 'elastic'
}

function elasticity(exact: Rational | null, infiniteSign = -1): Elasticity {
  if (!exact) {
    const value = infiniteSign * Infinity
    return { value, exact: null, kind: 'perfectly_elastic' }
  }
  const value = toNumber(exact)
  return {
    value,
    exact,
    kind: R.equal(abs(exact), ONE) ? 'unit' : classifyElasticity(value),
  }
}

/** Point elasticity (dQ/dP)·(P/Q) on a curve at a point with Q > 0. */
export function pointElasticity(
  curve: MarketCurve,
  at: { q: Rational; p: Rational },
  side: CurveSide = 'demand',
): Elasticity | null {
  if (!gt(at.q, ZERO)) return null
  if (curve.kind === 'vertical') return elasticity(ZERO)
  if (R.isZero(curve.b)) return elasticity(null, side === 'demand' ? -1 : 1)
  return elasticity(R.div(at.p, R.mul(curve.b, at.q)))
}

/**
 * Midpoint (arc) elasticity between two points:
 * (ΔQ / average Q) ÷ (ΔP / average P). Null when both points coincide.
 */
export function midpointElasticity(
  from: { q: Rational; p: Rational },
  to: { q: Rational; p: Rational },
): Elasticity | null {
  const dq = R.sub(to.q, from.q)
  const dp = R.sub(to.p, from.p)
  const sq = R.add(to.q, from.q)
  const sp = R.add(to.p, from.p)
  if (R.isZero(sq)) return null
  if (R.isZero(dp)) return R.isZero(dq) ? null : elasticity(null, sign(dq))
  return elasticity(R.div(R.mul(dq, sp), R.mul(dp, sq)))
}

// --- areas -----------------------------------------------------------------------

export type AreaKind =
  'cs' | 'ps' | 'revenue' | 'cost' | 'rent' | 'tariff' | 'dwl' | 'transfer' | 'total_revenue'

export type AreaEffect = 'gain' | 'loss' | 'unchanged'

export interface MarketArea {
  /** Stable key within a solution, e.g. `cs-after`, `dwl`, `ps-change-loss-0`. */
  id: string
  kind: AreaKind
  phase: 'before' | 'after'
  polygon: PlotPoint[]
  area: MarketNumber
  /** Only on the surplus-change regions (`changes`). */
  effect?: AreaEffect
}

type Fn = (q: Rational) => Rational

function shoelace(points: PlotPointExact[]): Rational {
  let sum = ZERO
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    sum = R.add(sum, R.sub(R.mul(a.q, b.p), R.mul(b.q, a.p)))
  }
  return abs(R.mul(sum, HALF))
}

/**
 * The region between `upper` and `lower` over q ∈ [q0, q1]; both are linear
 * between the `kinks`, so the polygon (and its area) is exact.
 */
function region(
  upper: Fn,
  lower: Fn,
  q0: Rational,
  q1: Rational,
  kinks: Rational[] = [],
): { polygon: PlotPointExact[]; area: Rational } {
  if (!lt(q0, q1)) return { polygon: [], area: ZERO }
  const xs = [q0, ...kinks.filter((k) => lt(q0, k) && lt(k, q1)), q1].sort(cmp)
  const top = xs.map((q) => ({ q, p: upper(q) }))
  const bottom = [...xs].reverse().map((q) => ({ q, p: lower(q) }))
  const polygon: PlotPointExact[] = []
  for (const pt of [...top, ...bottom]) {
    const last = polygon[polygon.length - 1]
    if (!last || !R.equal(last.q, pt.q) || !R.equal(last.p, pt.p)) polygon.push(pt)
  }
  return { polygon, area: shoelace(polygon) }
}

const constant =
  (value: Rational): Fn =>
  () =>
    value

/** Marginal benefit along demand (null when demand is vertical: unbounded surplus). */
function benefitFn(demand: MarketCurve): Fn | null {
  return demand.kind === 'sloped' ? (q) => R.add(demand.a, R.mul(demand.b, q)) : null
}

/** Marginal cost along supply: never below 0; a vertical supply curve costs 0. */
function costFn(supply: MarketCurve): Fn {
  return supply.kind === 'sloped'
    ? (q) => max(ZERO, R.add(supply.a, R.mul(supply.b, q)))
    : () => ZERO
}

function costKinks(supply: MarketCurve): Rational[] {
  if (supply.kind !== 'sloped' || R.isZero(supply.b) || !lt(supply.a, ZERO)) return []
  return [R.div(neg(supply.a), supply.b)]
}

class AreaBuilder {
  readonly areas: MarketArea[] = []
  constructor(
    readonly demand: MarketCurve,
    readonly supply: MarketCurve,
  ) {}

  add(
    id: string,
    kind: AreaKind,
    phase: 'before' | 'after',
    shape: { polygon: PlotPointExact[]; area: Rational } | null,
    effect?: AreaEffect,
  ): Rational | null {
    if (!shape) return null
    this.areas.push({
      id,
      kind,
      phase,
      polygon: shape.polygon.map((pt) => ({ q: toNumber(pt.q), p: toNumber(pt.p) })),
      area: mn(shape.area),
      ...(effect ? { effect } : {}),
    })
    return shape.area
  }

  /** Consumer surplus at buyer price p for the first q units. */
  cs(p: Rational, q: Rational) {
    const mb = benefitFn(this.demand)
    return mb ? region(mb, constant(p), ZERO, q) : null
  }

  ps(p: Rational, q: Rational) {
    return region(constant(p), costFn(this.supply), ZERO, q, costKinks(this.supply))
  }

  /** Deadweight loss between the curves from q0 to q1 (either order). */
  dwl(q0: Rational, q1: Rational) {
    const mb = benefitFn(this.demand)
    const mc = costFn(this.supply)
    if (!mb) return R.equal(q0, q1) ? { polygon: [], area: ZERO } : null
    return lt(q0, q1)
      ? region(mb, mc, q0, q1, costKinks(this.supply))
      : region(mc, mb, q1, q0, costKinks(this.supply))
  }

  rect(q0: Rational, q1: Rational, p0: Rational, p1: Rational) {
    return region(constant(max(p0, p1)), constant(min(p0, p1)), min(q0, q1), max(q0, q1))
  }

  /** Consumer-surplus change regions from (p0, q0) to (p1, q1), q1 ≤ q0. */
  csChange(p0: Rational, q0: Rational, p1: Rational, q1: Rational): void {
    const mb = benefitFn(this.demand)
    if (!mb) return
    if (le(p0, p1)) {
      this.add(
        'cs-change-unchanged',
        'cs',
        'after',
        region(mb, constant(p1), ZERO, q1),
        'unchanged',
      )
      this.add('cs-change-loss-0', 'cs', 'after', this.rect(ZERO, q1, p0, p1), 'loss')
    } else {
      this.add(
        'cs-change-unchanged',
        'cs',
        'after',
        region(mb, constant(p0), ZERO, q1),
        'unchanged',
      )
      this.add('cs-change-gain', 'cs', 'after', this.rect(ZERO, q1, p1, p0), 'gain')
    }
    this.add('cs-change-loss-1', 'cs', 'after', region(mb, constant(p0), q1, q0), 'loss')
  }

  /** Producer-surplus change regions from (p0, q0) to (p1, q1), q1 ≤ q0. */
  psChange(p0: Rational, q0: Rational, p1: Rational, q1: Rational): void {
    const mc = costFn(this.supply)
    const kinks = costKinks(this.supply)
    if (le(p1, p0)) {
      this.add(
        'ps-change-unchanged',
        'ps',
        'after',
        region(constant(p1), mc, ZERO, q1, kinks),
        'unchanged',
      )
      this.add('ps-change-loss-0', 'ps', 'after', this.rect(ZERO, q1, p1, p0), 'loss')
    } else {
      this.add(
        'ps-change-unchanged',
        'ps',
        'after',
        region(constant(p0), mc, ZERO, q1, kinks),
        'unchanged',
      )
      this.add('ps-change-gain', 'ps', 'after', this.rect(ZERO, q1, p0, p1), 'gain')
    }
    this.add('ps-change-loss-1', 'ps', 'after', region(constant(p0), mc, q1, q0, kinks), 'loss')
  }
}

// --- scenarios -------------------------------------------------------------------

export type MarketScenario =
  | { kind: 'equilibrium' }
  | { kind: 'shift'; demand?: CurveShift; supply?: CurveShift }
  | { kind: 'tax'; amount: number; on: 'buyers' | 'sellers' }
  | { kind: 'subsidy'; amount: number; on: 'buyers' | 'sellers' }
  | { kind: 'ceiling'; price: number }
  | { kind: 'floor'; price: number }
  /** A limit on the quantity sold (supply management, licences). */
  | { kind: 'quota'; quantity: number }
  /** A small open economy at a world price, optionally with a tariff or an import quota. */
  | { kind: 'trade'; worldPrice: number; tariff?: number; importQuota?: number }

export type ScenarioKind = MarketScenario['kind']

export interface MarketSpec {
  demand: CurveSpec
  supply: CurveSpec
  scenario: MarketScenario
}

export type ShiftDirection = 'increase' | 'decrease' | 'none' | 'rotation'
export type ChangeDirection = 'increase' | 'decrease' | 'unchanged'

/**
 * The four textbook cases when both curves shift: one of price and quantity
 * is determined, the other depends on the sizes of the shifts.
 */
export const BOTH_SHIFT_CASES = [
  { demand: 'increase', supply: 'increase', price: 'ambiguous', quantity: 'increase' },
  { demand: 'decrease', supply: 'decrease', price: 'ambiguous', quantity: 'decrease' },
  { demand: 'increase', supply: 'decrease', price: 'increase', quantity: 'ambiguous' },
  { demand: 'decrease', supply: 'increase', price: 'decrease', quantity: 'ambiguous' },
] as const

export type BothShiftCase = (typeof BOTH_SHIFT_CASES)[number]

export interface ShiftAnalysis {
  demand: ShiftDirection
  supply: ShiftDirection
  /** Set when both curves move in a definite direction. */
  case?: BothShiftCase
  /** The variable whose direction the textbook case leaves open… */
  ambiguous?: 'price' | 'quantity'
  /** …and how these particular numbers resolve it. */
  resolved?: ChangeDirection
}

export interface SurplusTotals {
  cs: MarketNumber | null
  ps: MarketNumber
  /** Tax revenue (+), subsidy cost (−), tariff revenue (+). */
  government: MarketNumber
  /** Quota rent (production quota or import quota). */
  rent: MarketNumber
  /** cs + ps + government + rent (null when cs is unbounded). */
  total: MarketNumber | null
}

export interface MarketSolution {
  scenario: ScenarioKind
  demand: MarketCurve
  supply: MarketCurve
  /** The curves drawn after the change (shifted, or shifted by a tax / subsidy). */
  newDemand?: MarketCurve
  newSupply?: MarketCurve
  /** The original (no-policy) equilibrium. */
  original: MarketPoint
  /**
   * The outcome: the new equilibrium (shift), or the traded quantity at the
   * price buyers pay (tax, subsidy, controls, quota, trade).
   */
  outcome: MarketPoint
  deltaP: MarketNumber
  deltaQ: MarketNumber
  /** False for a non-binding ceiling / floor / quota / import quota. */
  binding: boolean
  buyerPrice?: MarketNumber
  sellerPrice?: MarketNumber
  /** Price posted in the market (the one buyers hand to sellers). */
  postedPrice?: MarketNumber
  /** Per-unit tax (or subsidy) wedge. */
  wedge?: MarketNumber
  incidence?: {
    buyersPerUnit: MarketNumber
    sellersPerUnit: MarketNumber
    /** Shares of the wedge, summing to 1. */
    buyersShare: MarketNumber
    sellersShare: MarketNumber
  }
  /** Ceiling / floor: quantities demanded and supplied at the controlled price. */
  control?: {
    price: MarketNumber
    quantityDemanded: MarketNumber
    quantitySupplied: MarketNumber
    /** Shortage (ceiling) or surplus (floor), ≥ 0. */
    gap: MarketNumber
    gapKind: 'shortage' | 'surplus'
    /** Highest price buyers would pay for the quantity traded (ceiling). */
    demandPriceAtTraded?: MarketNumber
  }
  trade?: {
    worldPrice: MarketNumber
    domesticPrice: MarketNumber
    role: 'importer' | 'exporter' | 'none'
    quantityDemanded: MarketNumber
    quantitySupplied: MarketNumber
    /** Imports (importer) or exports (exporter) after any tariff / quota. */
    volume: MarketNumber
    /** Imports or exports at the world price with no tariff / quota. */
    freeTradeVolume: MarketNumber
    /** Total surplus under free trade minus autarky. */
    gainsFromTrade: MarketNumber | null
  }
  before: SurplusTotals
  after: SurplusTotals
  change: { cs: MarketNumber | null; ps: MarketNumber; total: MarketNumber | null }
  deadweightLoss: MarketNumber | null
  /** P·Q at the original and new outcome (price paid by buyers). */
  totalRevenue: { before: MarketNumber; after: MarketNumber }
  /** Every shaded region: before / after surplus, policy rectangles, DWL, change regions. */
  areas: MarketArea[]
  elasticity: {
    demandAtOriginal: Elasticity | null
    supplyAtOriginal: Elasticity | null
    /** Midpoint elasticity along the curve that did not move (shift with one curve). */
    alongUnshifted?: { side: CurveSide; value: Elasticity }
  }
  shift?: ShiftAnalysis
  /** Bracket for a shortage / surplus / import gap: from q0 to q1 at price p. */
  gap?: { q0: number; q1: number; p: number; kind: 'shortage' | 'surplus' | 'imports' | 'exports' }
}

export type MarketResult =
  { ok: true; solution: MarketSolution } | { ok: false; reason: MarketRejectReason }

function positiveNumber(value: number, allowZero = false): Rational | null {
  const r = toRational(value)
  if (!r) return null
  return allowZero ? (lt(r, ZERO) ? null : r) : gt(r, ZERO) ? r : null
}

function directionOf(
  before: MarketCurve,
  after: MarketCurve,
  side: CurveSide,
  at: PlotPointExact,
): ShiftDirection {
  if (isHorizontal(before) && isHorizontal(after)) {
    const diff = cmp(priceAt(after, ZERO)!, priceAt(before, ZERO)!)
    if (diff === 0) return 'none'
    // Demand up = increase; supply up = decrease (higher cost at every quantity).
    return (side === 'demand') === diff > 0 ? 'increase' : 'decrease'
  }
  const q0 = quantityAt(before, at.p)
  const q1 = quantityAt(after, at.p)
  if (q0 === null || q1 === null) return 'rotation'
  const diff = cmp(q1, q0)
  if (diff !== 0) return diff > 0 ? 'increase' : 'decrease'
  const same =
    before.kind === after.kind &&
    (before.kind === 'vertical'
      ? R.equal(before.q, (after as typeof before).q)
      : R.equal(before.a, (after as typeof before).a) &&
        R.equal(before.b, (after as typeof before).b))
  return same ? 'none' : 'rotation'
}

const changeOf = (value: Rational): ChangeDirection =>
  sign(value) > 0 ? 'increase' : sign(value) < 0 ? 'decrease' : 'unchanged'

function totals(
  cs: Rational | null,
  ps: Rational,
  government: Rational = ZERO,
  rent: Rational = ZERO,
): SurplusTotals {
  return {
    cs: cs ? mn(cs) : null,
    ps: mn(ps),
    government: mn(government),
    rent: mn(rent),
    total: cs ? mn(R.add(R.add(cs, ps), R.add(government, rent))) : null,
  }
}

/** Solve one market exactly. Never throws. */
export function solveMarket(spec: MarketSpec): MarketResult {
  try {
    return solve(spec)
  } catch {
    return { ok: false, reason: 'invalid-number' }
  }
}

function solve(spec: MarketSpec): MarketResult {
  const d = resolveCurve(spec.demand, 'demand')
  if (!d.ok) return d
  const s = resolveCurve(spec.supply, 'supply')
  if (!s.ok) return s
  const demand = d.value
  const supply = s.value
  const eq = equilibriumOf(demand, supply)
  if (!eq.ok) return eq
  const e0 = { q: eq.value.q.exact, p: eq.value.p.exact }
  const builder = new AreaBuilder(demand, supply)

  const cs0Shape = builder.cs(e0.p, e0.q)
  const ps0Shape = builder.ps(e0.p, e0.q)
  const before = totals(cs0Shape?.area ?? null, ps0Shape.area)
  const elasticityBase = {
    demandAtOriginal: pointElasticity(demand, e0, 'demand'),
    supplyAtOriginal: pointElasticity(supply, e0, 'supply'),
  }

  const finish = (input: {
    outcome: PlotPointExact
    after: SurplusTotals
    dwl: Rational | null
    binding?: boolean
    rest?: Partial<MarketSolution>
  }): MarketResult => {
    const { outcome } = input
    if (lt(outcome.p, ZERO) || lt(outcome.q, ZERO)) return fail('negative-price')
    const csChange =
      input.after.cs && before.cs ? mn(R.sub(input.after.cs.exact, before.cs.exact)) : null
    const totalChange =
      input.after.total && before.total
        ? mn(R.sub(input.after.total.exact, before.total.exact))
        : null
    return {
      ok: true,
      solution: {
        scenario: spec.scenario.kind,
        demand,
        supply,
        original: eq.value,
        outcome: point(outcome.q, outcome.p),
        deltaP: mn(R.sub(outcome.p, e0.p)),
        deltaQ: mn(R.sub(outcome.q, e0.q)),
        binding: input.binding ?? true,
        before,
        after: input.after,
        change: {
          cs: csChange,
          ps: mn(R.sub(input.after.ps.exact, before.ps.exact)),
          total: totalChange,
        },
        deadweightLoss: input.dwl ? mn(input.dwl) : null,
        totalRevenue: {
          before: mn(R.mul(e0.p, e0.q)),
          after: mn(R.mul(outcome.p, outcome.q)),
        },
        areas: builder.areas,
        elasticity: elasticityBase,
        ...input.rest,
      },
    }
  }

  const addBefore = () => {
    builder.add('cs-before', 'cs', 'before', cs0Shape)
    builder.add('ps-before', 'ps', 'before', ps0Shape)
  }

  const scenario = spec.scenario
  switch (scenario.kind) {
    case 'equilibrium': {
      addBefore()
      builder.add('total-revenue', 'total_revenue', 'before', builder.rect(ZERO, e0.q, ZERO, e0.p))
      return finish({ outcome: e0, after: before, dwl: ZERO })
    }

    case 'shift': {
      if (!scenario.demand && !scenario.supply) return fail('invalid-scenario')
      const nd = scenario.demand ? shiftCurve(demand, scenario.demand, 'demand', e0) : okv(demand)
      if (!nd.ok) return nd
      const ns = scenario.supply ? shiftCurve(supply, scenario.supply, 'supply', e0) : okv(supply)
      if (!ns.ok) return ns
      const cross = intersect(nd.value, ns.value)
      if (!cross) return fail('no-equilibrium')
      if (!gt(cross.q, ZERO) || !gt(cross.p, ZERO)) return fail('new-equilibrium-not-positive')
      const after = new AreaBuilder(nd.value, ns.value)
      addBefore()
      const cs1 = after.cs(cross.p, cross.q)
      const ps1 = after.ps(cross.p, cross.q)
      builder.add('cs-after', 'cs', 'after', cs1)
      builder.add('ps-after', 'ps', 'after', ps1)
      builder.add(
        'total-revenue-before',
        'total_revenue',
        'before',
        builder.rect(ZERO, e0.q, ZERO, e0.p),
      )
      builder.add(
        'total-revenue-after',
        'total_revenue',
        'after',
        builder.rect(ZERO, cross.q, ZERO, cross.p),
      )
      const dirD = scenario.demand ? directionOf(demand, nd.value, 'demand', e0) : 'none'
      const dirS = scenario.supply ? directionOf(supply, ns.value, 'supply', e0) : 'none'
      const shift: ShiftAnalysis = { demand: dirD, supply: dirS }
      const found = BOTH_SHIFT_CASES.find((c) => c.demand === dirD && c.supply === dirS)
      if (found) {
        shift.case = found
        shift.ambiguous = found.price === 'ambiguous' ? 'price' : 'quantity'
        shift.resolved = changeOf(
          shift.ambiguous === 'price' ? R.sub(cross.p, e0.p) : R.sub(cross.q, e0.q),
        )
      }
      const elasticityRest: MarketSolution['elasticity'] = { ...elasticityBase }
      if (!scenario.demand || !scenario.supply) {
        const along = midpointElasticity(e0, cross)
        if (along)
          elasticityRest.alongUnshifted = {
            side: scenario.demand ? 'supply' : 'demand',
            value: along,
          }
      }
      return finish({
        outcome: cross,
        after: totals(cs1?.area ?? null, ps1.area),
        dwl: ZERO,
        rest: {
          ...(scenario.demand ? { newDemand: nd.value } : {}),
          ...(scenario.supply ? { newSupply: ns.value } : {}),
          shift,
          elasticity: elasticityRest,
        },
      })
    }

    case 'tax':
    case 'subsidy': {
      const amount = positiveNumber(scenario.amount)
      if (!amount) return fail('invalid-scenario')
      const isTax = scenario.kind === 'tax'
      // The buyer price exceeds the seller price by the tax (or falls short by the subsidy).
      const gapValue = isTax ? amount : neg(amount)
      const solved = wedgeQuantity(demand, supply, gapValue)
      if (!solved) return fail('no-equilibrium')
      const { q: qt, pb, ps } = solved
      if (!gt(qt, ZERO)) return fail('market-shut-down')
      if (lt(pb, ZERO) || lt(ps, ZERO)) return fail('negative-price')
      addBefore()
      const cs1 = builder.cs(pb, qt)
      const ps1 = builder.ps(ps, qt)
      builder.add('cs-after', 'cs', 'after', cs1)
      builder.add('ps-after', 'ps', 'after', ps1)
      const rect = builder.rect(ZERO, qt, ps, pb)
      builder.add(isTax ? 'revenue' : 'cost', isTax ? 'revenue' : 'cost', 'after', rect)
      const dwlShape = builder.dwl(qt, e0.q)
      builder.add('dwl', 'dwl', 'after', dwlShape)
      if (isTax) {
        builder.csChange(e0.p, e0.q, pb, qt)
        builder.psChange(e0.p, e0.q, ps, qt)
      }
      const government = isTax ? rect.area : neg(rect.area)
      const buyersPerUnit = isTax ? R.sub(pb, e0.p) : R.sub(e0.p, pb)
      const sellersPerUnit = isTax ? R.sub(e0.p, ps) : R.sub(ps, e0.p)
      const onSellers = scenario.on === 'sellers'
      const drawn = isTax ? amount : neg(amount)
      return finish({
        outcome: { q: qt, p: pb },
        after: totals(cs1?.area ?? null, ps1.area, government),
        dwl: dwlShape?.area ?? null,
        rest: {
          ...(onSellers
            ? { newSupply: raise(supply, drawn) }
            : { newDemand: raise(demand, neg(drawn)) }),
          buyerPrice: mn(pb),
          sellerPrice: mn(ps),
          // The market price is what buyers pay when sellers are taxed (or subsidised),
          // and what sellers receive when buyers are.
          postedPrice: mn(onSellers ? pb : ps),
          wedge: mn(amount),
          incidence: {
            buyersPerUnit: mn(buyersPerUnit),
            sellersPerUnit: mn(sellersPerUnit),
            buyersShare: mn(R.div(buyersPerUnit, amount)),
            sellersShare: mn(R.div(sellersPerUnit, amount)),
          },
        },
      })
    }

    case 'ceiling':
    case 'floor': {
      if (isHorizontal(demand) || isHorizontal(supply) || demand.kind === 'vertical')
        return fail('control-needs-sloped-curves')
      const price = positiveNumber(scenario.price, true)
      if (!price) return fail('negative-price')
      const ceiling = scenario.kind === 'ceiling'
      const binding = ceiling ? lt(price, e0.p) : gt(price, e0.p)
      if (!binding) {
        addBefore()
        return finish({
          outcome: e0,
          after: before,
          dwl: ZERO,
          binding: false,
          rest: { control: controlInfo(price, demand, supply, ceiling) },
        })
      }
      const qd = quantityAt(demand, price)!
      const qs = quantityAt(supply, price)!
      const traded = min(qd, qs)
      addBefore()
      const cs1 = builder.cs(price, traded)
      const ps1 = builder.ps(price, traded)
      builder.add('cs-after', 'cs', 'after', cs1)
      builder.add('ps-after', 'ps', 'after', ps1)
      const dwlShape = builder.dwl(traded, e0.q)
      builder.add('dwl', 'dwl', 'after', dwlShape)
      builder.add('transfer', 'transfer', 'after', builder.rect(ZERO, traded, price, e0.p))
      builder.csChange(e0.p, e0.q, price, traded)
      builder.psChange(e0.p, e0.q, price, traded)
      return finish({
        outcome: { q: traded, p: price },
        after: totals(cs1?.area ?? null, ps1.area),
        dwl: dwlShape?.area ?? null,
        rest: {
          control: controlInfo(price, demand, supply, ceiling),
          gap: {
            q0: toNumber(min(qd, qs)),
            q1: toNumber(max(qd, qs)),
            p: toNumber(price),
            kind: ceiling ? 'shortage' : 'surplus',
          },
        },
      })
    }

    case 'quota': {
      if (demand.kind === 'vertical') return fail('control-needs-sloped-curves')
      const limit = positiveNumber(scenario.quantity)
      if (!limit) return fail('invalid-scenario')
      if (!lt(limit, e0.q)) {
        addBefore()
        return finish({ outcome: e0, after: before, dwl: ZERO, binding: false })
      }
      const pb = priceAt(demand, limit)!
      const ps = costFn(supply)(limit)
      addBefore()
      const cs1 = builder.cs(pb, limit)
      const ps1 = builder.ps(ps, limit)
      builder.add('cs-after', 'cs', 'after', cs1)
      builder.add('ps-after', 'ps', 'after', ps1)
      const rent = builder.rect(ZERO, limit, ps, pb)
      builder.add('rent', 'rent', 'after', rent)
      const dwlShape = builder.dwl(limit, e0.q)
      builder.add('dwl', 'dwl', 'after', dwlShape)
      builder.csChange(e0.p, e0.q, pb, limit)
      builder.psChange(e0.p, e0.q, pb, limit)
      return finish({
        outcome: { q: limit, p: pb },
        after: totals(cs1?.area ?? null, ps1.area, ZERO, rent.area),
        dwl: dwlShape?.area ?? null,
        rest: { buyerPrice: mn(pb), sellerPrice: mn(ps), wedge: mn(R.sub(pb, ps)) },
      })
    }

    case 'trade':
      return solveTrade(scenario, demand, supply, e0, builder, before, finish, addBefore)
  }
  return fail('invalid-scenario')
}

/** Quantity where the buyer price exceeds the seller price by `gap` (negative for a subsidy). */
function wedgeQuantity(
  demand: MarketCurve,
  supply: MarketCurve,
  gap: Rational,
): { q: Rational; pb: Rational; ps: Rational } | null {
  if (demand.kind === 'sloped' && supply.kind === 'sloped') {
    const den = R.sub(supply.b, demand.b)
    if (R.isZero(den)) return null
    const q = R.div(R.sub(R.sub(demand.a, supply.a), gap), den)
    const pb = R.add(demand.a, R.mul(demand.b, q))
    return { q, pb, ps: R.sub(pb, gap) }
  }
  if (demand.kind === 'vertical' && supply.kind === 'sloped') {
    const ps = R.add(supply.a, R.mul(supply.b, demand.q))
    return { q: demand.q, pb: R.add(ps, gap), ps }
  }
  if (supply.kind === 'vertical' && demand.kind === 'sloped') {
    const pb = R.add(demand.a, R.mul(demand.b, supply.q))
    return { q: supply.q, pb, ps: R.sub(pb, gap) }
  }
  return null
}

function controlInfo(
  price: Rational,
  demand: MarketCurve,
  supply: MarketCurve,
  ceiling: boolean,
): NonNullable<MarketSolution['control']> {
  const qd = quantityAt(demand, price)!
  const qs = quantityAt(supply, price)!
  const gap = ceiling ? max(ZERO, R.sub(qd, qs)) : max(ZERO, R.sub(qs, qd))
  const traded = min(qd, qs)
  const willing = priceAt(demand, traded)
  return {
    price: mn(price),
    quantityDemanded: mn(qd),
    quantitySupplied: mn(qs),
    gap: mn(gap),
    gapKind: ceiling ? 'shortage' : 'surplus',
    ...(ceiling && willing ? { demandPriceAtTraded: mn(willing) } : {}),
  }
}

type Finish = (input: {
  outcome: PlotPointExact
  after: SurplusTotals
  dwl: Rational | null
  binding?: boolean
  rest?: Partial<MarketSolution>
}) => MarketResult

function solveTrade(
  scenario: Extract<MarketScenario, { kind: 'trade' }>,
  demand: MarketCurve,
  supply: MarketCurve,
  e0: PlotPointExact,
  builder: AreaBuilder,
  before: SurplusTotals,
  finish: Finish,
  addBefore: () => void,
): MarketResult {
  if (demand.kind !== 'sloped' || isHorizontal(demand) || isHorizontal(supply))
    return fail('control-needs-sloped-curves')
  const pw = positiveNumber(scenario.worldPrice, true)
  if (!pw) return fail('negative-price')
  const tariff = scenario.tariff !== undefined ? positiveNumber(scenario.tariff, true) : ZERO
  const quota =
    scenario.importQuota !== undefined ? positiveNumber(scenario.importQuota, true) : null
  if (tariff === null || (scenario.importQuota !== undefined && quota === null))
    return fail('invalid-scenario')
  const restricted = gt(tariff, ZERO) || quota !== null
  if (gt(tariff, ZERO) && quota !== null) return fail('tariff-and-quota')
  const role = lt(pw, e0.p) ? 'importer' : gt(pw, e0.p) ? 'exporter' : 'none'
  if (role !== 'importer' && restricted) return fail('tariff-needs-imports')

  const qdAt = (p: Rational) => quantityAt(demand, p)!
  const qsAt = (p: Rational) => quantityAt(supply, p)!
  const freeQd = qdAt(pw)
  const freeQs = qsAt(pw)
  const freeVolume = abs(R.sub(freeQd, freeQs))
  const freeCs = builder.cs(pw, freeQd)
  const freePs = builder.ps(pw, freeQs)
  const gains =
    freeCs && before.total ? mn(R.sub(R.add(freeCs.area, freePs.area), before.total.exact)) : null

  let pd = pw
  let binding = role !== 'none'
  if (role === 'importer' && gt(tariff, ZERO)) pd = min(R.add(pw, tariff), e0.p)
  if (role === 'importer' && quota !== null) {
    const solved = quotaPrice(demand, supply, quota)
    if (!le(solved, pw)) pd = min(solved, e0.p)
    else binding = false
  }
  if (role === 'importer' && restricted && R.equal(pd, pw)) binding = false

  const qd = qdAt(pd)
  const qs = qsAt(pd)
  addBefore()
  const cs1 = builder.cs(pd, qd)
  const ps1 = builder.ps(pd, qs)
  builder.add('cs-after', 'cs', 'after', cs1)
  builder.add('ps-after', 'ps', 'after', ps1)
  let government = ZERO
  let rent = ZERO
  let dwl: Rational | null = ZERO
  if (role === 'importer' && gt(pd, pw)) {
    const rect = builder.rect(qs, qd, pw, pd)
    if (quota !== null) rent = builder.add('rent', 'rent', 'after', rect)!
    else government = builder.add('tariff', 'tariff', 'after', rect)!
    const production = region(costFn(supply), constant(pw), freeQs, qs, costKinks(supply))
    const mb = benefitFn(demand)!
    const consumption = region(mb, constant(pw), qd, freeQd)
    builder.add('dwl-production', 'dwl', 'after', production)
    builder.add('dwl-consumption', 'dwl', 'after', consumption)
    dwl = R.add(production.area, consumption.area)
  }
  return finish({
    outcome: { q: qd, p: pd },
    after: totals(cs1?.area ?? null, ps1.area, government, rent),
    dwl,
    binding,
    rest: {
      trade: {
        worldPrice: mn(pw),
        domesticPrice: mn(pd),
        role,
        quantityDemanded: mn(qd),
        quantitySupplied: mn(qs),
        volume: mn(abs(R.sub(qd, qs))),
        freeTradeVolume: mn(freeVolume),
        gainsFromTrade: gains,
      },
      ...(role !== 'none'
        ? {
            gap: {
              q0: toNumber(min(qd, qs)),
              q1: toNumber(max(qd, qs)),
              p: toNumber(pd),
              kind: role === 'importer' ? ('imports' as const) : ('exports' as const),
            },
          }
        : {}),
    },
  })
}

/** Domestic price at which imports Qd(P) − Qs(P) equal the quota. */
function quotaPrice(demand: MarketCurve, supply: MarketCurve, quota: Rational): Rational {
  const d = demand as Extract<MarketCurve, { kind: 'sloped' }>
  const onlyDemand = R.add(d.a, R.mul(d.b, quota)) // supply is 0 there
  if (supply.kind === 'vertical') return R.add(d.a, R.mul(d.b, R.add(quota, supply.q)))
  // (P − aD)/bD − (P − aS)/bS = quota
  const coef = R.sub(R.div(ONE, d.b), R.div(ONE, supply.b))
  if (R.isZero(coef)) return onlyDemand
  const p = R.div(R.add(quota, R.sub(R.div(d.a, d.b), R.div(supply.a, supply.b))), coef)
  return lt(p, supply.a) ? onlyDemand : p
}

// --- exploration (dragging curves and policy lines) -----------------------------

/** Move a written curve: `dp` up (price), `dq` to the right (quantity). */
export function nudgeCurveSpec(spec: CurveSpec, delta: { dp?: number; dq?: number }): CurveSpec {
  const dp = delta.dp ?? 0
  const dq = delta.dq ?? 0
  switch (spec.form) {
    case 'price':
      return { ...spec, intercept: spec.intercept + dp - spec.slope * dq }
    case 'quantity':
      // Q = c + d·P: up by dp → c − d·dp; right by dq → c + dq.
      return { ...spec, intercept: spec.intercept - spec.slope * dp + dq }
    case 'points':
      return {
        form: 'points',
        points: spec.points.map((pt) => ({ q: pt.q + dq, p: pt.p + dp })) as [PlotPoint, PlotPoint],
      }
    case 'vertical':
      return { ...spec, quantity: spec.quantity + dq }
    case 'horizontal':
      return { ...spec, price: spec.price + dp }
  }
}

export interface MarketExploration {
  demand?: { dp?: number; dq?: number }
  supply?: { dp?: number; dq?: number }
  /** Replaces the scenario's controlled price, world price or quota quantity. */
  policy?: number
}

/** Which axis the scenario's policy line lives on (null when it has none). */
export function policyAxis(scenario: MarketScenario): 'price' | 'quantity' | null {
  return scenario.kind === 'ceiling' || scenario.kind === 'floor' || scenario.kind === 'trade'
    ? 'price'
    : scenario.kind === 'quota'
      ? 'quantity'
      : null
}

export function policyValue(scenario: MarketScenario): number | null {
  switch (scenario.kind) {
    case 'ceiling':
    case 'floor':
      return scenario.price
    case 'trade':
      return scenario.worldPrice
    case 'quota':
      return scenario.quantity
    default:
      return null
  }
}

/**
 * A spec with curves dragged and the policy line moved. In a `shift`
 * scenario the moved side's *new* curve moves; otherwise the curve itself.
 */
export function exploreMarket(spec: MarketSpec, exploration: MarketExploration): MarketSpec {
  let { demand, supply, scenario } = spec
  const move = (side: CurveSide, delta: { dp?: number; dq?: number } | undefined) => {
    if (!delta || (!delta.dp && !delta.dq)) return
    if (scenario.kind === 'shift' && scenario[side]) {
      const shift = scenario[side]!
      const moved: CurveShift = shift.to
        ? { to: nudgeCurveSpec(shift.to, delta) }
        : { ...shift, dp: (shift.dp ?? 0) + (delta.dp ?? 0), dq: (shift.dq ?? 0) + (delta.dq ?? 0) }
      scenario = { ...scenario, [side]: moved }
    } else if (side === 'demand') demand = nudgeCurveSpec(demand, delta)
    else supply = nudgeCurveSpec(supply, delta)
  }
  move('demand', exploration.demand)
  move('supply', exploration.supply)
  if (exploration.policy !== undefined) {
    const value = exploration.policy
    if (scenario.kind === 'ceiling' || scenario.kind === 'floor')
      scenario = { ...scenario, price: value }
    else if (scenario.kind === 'trade') scenario = { ...scenario, worldPrice: value }
    else if (scenario.kind === 'quota') scenario = { ...scenario, quantity: value }
  }
  return { demand, supply, scenario }
}

/** A curve as an equation: `P = 180 − 2Q`, `Q = 50`, `P = 10`. */
export function formatCurveEquation(curve: MarketCurve): string {
  const text = (value: Rational) => {
    const shown = formatMarketNumber(value, 4)
    return shown.startsWith('≈') ? formatRational(value) : shown
  }
  if (curve.kind === 'vertical') return `Q = ${text(curve.q)}`
  if (R.isZero(curve.b)) return `P = ${text(curve.a)}`
  const slope = abs(curve.b)
  const coefficient = R.equal(slope, ONE) ? '' : slope.d === 1n ? text(slope) : `(${text(slope)})`
  const op = sign(curve.b) < 0 ? '−' : '+'
  if (R.isZero(curve.a)) return `P = ${sign(curve.b) < 0 ? '−' : ''}${coefficient}Q`
  return `P = ${text(curve.a)} ${op} ${coefficient}Q`
}

// --- interpolation (animation / sliders) -----------------------------------------

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * The scenario `fraction` (0…1) of the way from "no change" to its full
 * change: shifts scale their amounts (a stated new curve is blended with the
 * old one), taxes and subsidies their amount, controls move from the
 * equilibrium price (or quantity) to the stated value, trade from the
 * autarky price to the world price. Returns the spec unchanged for 1, and the
 * plain equilibrium for 0.
 */
export function scaleScenario(spec: MarketSpec, fraction: number): MarketSpec {
  const t = Math.min(1, Math.max(0, fraction))
  if (t >= 1) return spec
  const scenario = spec.scenario
  if (t <= 0) return { ...spec, scenario: { kind: 'equilibrium' } }
  const base = solveMarket({ ...spec, scenario: { kind: 'equilibrium' } })
  if (!base.ok) return spec
  const { p, q } = base.solution.original
  const scaleShift = (shift: CurveShift | undefined, side: CurveSide): CurveShift | undefined => {
    if (!shift) return undefined
    if (shift.to) {
      const from = side === 'demand' ? base.solution.demand : base.solution.supply
      const to = resolveCurve(shift.to, side)
      if (!to.ok) return shift
      if (from.kind === 'vertical' && to.value.kind === 'vertical')
        return {
          to: { form: 'vertical', quantity: mix(toNumber(from.q), toNumber(to.value.q), t) },
        }
      if (from.kind === 'sloped' && to.value.kind === 'sloped')
        return {
          to: {
            form: 'price',
            intercept: mix(toNumber(from.a), toNumber(to.value.a), t),
            slope: mix(toNumber(from.b), toNumber(to.value.b), t),
          },
        }
      return t < 0.5 ? { dq: 0 } : shift
    }
    const scaled: CurveShift = {}
    if (shift.dq !== undefined) scaled.dq = shift.dq * t
    if (shift.dp !== undefined) scaled.dp = shift.dp * t
    if (shift.slope !== undefined) {
      const from = side === 'demand' ? base.solution.demand : base.solution.supply
      if (from.kind === 'sloped') scaled.slope = mix(toNumber(from.b), shift.slope, t)
      if (shift.pivot) scaled.pivot = shift.pivot
    }
    return scaled
  }
  switch (scenario.kind) {
    case 'shift': {
      const demand = scaleShift(scenario.demand, 'demand')
      const supply = scaleShift(scenario.supply, 'supply')
      return {
        ...spec,
        scenario: { kind: 'shift', ...(demand ? { demand } : {}), ...(supply ? { supply } : {}) },
      }
    }
    case 'tax':
    case 'subsidy':
      return { ...spec, scenario: { ...scenario, amount: scenario.amount * t } }
    case 'ceiling':
    case 'floor':
      return { ...spec, scenario: { ...scenario, price: mix(p.value, scenario.price, t) } }
    case 'quota':
      return { ...spec, scenario: { ...scenario, quantity: mix(q.value, scenario.quantity, t) } }
    case 'trade':
      return {
        ...spec,
        scenario: {
          kind: 'trade',
          worldPrice: mix(p.value, scenario.worldPrice, t),
          ...(scenario.tariff !== undefined ? { tariff: scenario.tariff * t } : {}),
          ...(scenario.importQuota !== undefined ? { importQuota: scenario.importQuota } : {}),
        },
      }
    default:
      return spec
  }
}

// --- units -----------------------------------------------------------------------

export type QuantityScale = 'units' | 'thousands' | 'millions' | 'billions'

export const QUANTITY_SCALES: readonly QuantityScale[] = [
  'units',
  'thousands',
  'millions',
  'billions',
]

export function quantityScaleFactor(scale: QuantityScale | undefined): number {
  return scale === 'thousands' ? 1e3 : scale === 'millions' ? 1e6 : scale === 'billions' ? 1e9 : 1
}

/** An area (price × quantity) in base units, e.g. 1800 with quantities in thousands → 1 800 000. */
export function areaInBaseUnits(
  area: MarketNumber,
  scale: QuantityScale | undefined,
): MarketNumber {
  const factor = R.of(BigInt(quantityScaleFactor(scale)))
  return mn(R.mul(area.exact, factor))
}
