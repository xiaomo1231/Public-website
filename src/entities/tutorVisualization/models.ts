/**
 * Quantitative models from chemistry, biology and statistics: integrated rate
 * laws, the Arrhenius equation, Michaelis–Menten kinetics with inhibitors,
 * population growth, least-squares regression and confidence intervals.
 *
 * The model supplies the constants and data from the lesson; every curve,
 * half-life, fitted parameter, R², band and interval is computed here.
 */
import { cdf, quantile } from './distribution'

export const GAS_CONSTANT = 8.314462618

// --- reaction kinetics -------------------------------------------------------

export type ReactionOrder = 0 | 1 | 2

/** [A](t) for a reaction of the given order. */
export function concentrationAt(order: ReactionOrder, k: number, a0: number, t: number): number {
  if (order === 0) return Math.max(0, a0 - k * t)
  if (order === 1) return a0 * Math.exp(-k * t)
  return 1 / (1 / a0 + k * t)
}

export function halfLife(order: ReactionOrder, k: number, a0: number): number {
  return order === 0 ? a0 / (2 * k) : order === 1 ? Math.LN2 / k : 1 / (k * a0)
}

/** The quantity that is linear in t: [A], ln[A] or 1/[A]. */
export function linearized(order: ReactionOrder, concentration: number): number {
  return order === 0 ? concentration : order === 1 ? Math.log(concentration) : 1 / concentration
}

/** A time span that shows the reaction well: four half-lives (order 0: until depletion). */
export function kineticsSpan(order: ReactionOrder, k: number, a0: number): number {
  return order === 0 ? (a0 / k) * 1.1 : 4 * halfLife(order, k, a0)
}

// --- Arrhenius ---------------------------------------------------------------

export interface ArrheniusFit {
  /** J/mol. */
  ea: number
  a: number
  /** Present when fitted from data. */
  r2?: number
}

/** Ea and A from measured (T, k): ln k = ln A − Ea / (R T). */
export function fitArrhenius(points: Array<{ t: number; k: number }>): ArrheniusFit | null {
  const fit = linearFit(points.map((p) => ({ x: 1 / p.t, y: Math.log(p.k) })))
  if (!fit) return null
  return { ea: -fit.slope * GAS_CONSTANT, a: Math.exp(fit.intercept), r2: fit.r2 }
}

export function arrheniusK(ea: number, a: number, t: number): number {
  return a * Math.exp(-ea / (GAS_CONSTANT * t))
}

// --- enzyme kinetics ---------------------------------------------------------

export type InhibitionType = 'competitive' | 'noncompetitive' | 'uncompetitive' | 'mixed'

export interface Inhibitor {
  type: InhibitionType
  /** [I], same unit as Ki. */
  concentration: number
  /** Dissociation constant for the free enzyme (competitive, noncompetitive, mixed). */
  ki: number
  /** Dissociation constant for the ES complex (uncompetitive, mixed); defaults to ki. */
  kiPrime?: number
}

/** Apparent Vmax and Km with an inhibitor present. */
export function apparentConstants(vmax: number, km: number, inhibitor?: Inhibitor): { vmax: number; km: number } {
  if (!inhibitor) return { vmax, km }
  const alpha = 1 + inhibitor.concentration / inhibitor.ki
  const alphaPrime = 1 + inhibitor.concentration / (inhibitor.kiPrime ?? inhibitor.ki)
  switch (inhibitor.type) {
    case 'competitive':
      return { vmax, km: km * alpha }
    case 'noncompetitive':
      return { vmax: vmax / alpha, km }
    case 'uncompetitive':
      return { vmax: vmax / alphaPrime, km: km / alphaPrime }
    case 'mixed':
      return { vmax: vmax / alphaPrime, km: (km * alpha) / alphaPrime }
  }
}

export function michaelisMenten(vmax: number, km: number, s: number): number {
  return (vmax * s) / (km + s)
}

// --- population growth -------------------------------------------------------

export type GrowthModel = 'exponential' | 'logistic'

export function populationAt(model: GrowthModel, n0: number, r: number, t: number, k?: number): number {
  if (model === 'exponential' || k === undefined) return n0 * Math.exp(r * t)
  return k / (1 + ((k - n0) / n0) * Math.exp(-r * t))
}

export interface PopulationFacts {
  doublingTime: number
  /** Logistic only: time and size at the inflection point (N = K/2), and the maximum growth rate rK/4. */
  inflectionTime?: number
  maxGrowthRate?: number
}

export function populationFacts(model: GrowthModel, n0: number, r: number, k?: number): PopulationFacts {
  const facts: PopulationFacts = { doublingTime: Math.LN2 / r }
  if (model === 'logistic' && k !== undefined) {
    facts.maxGrowthRate = (r * k) / 4
    if (n0 < k / 2) facts.inflectionTime = Math.log((k - n0) / n0) / r
  }
  return facts
}

export function populationSpan(model: GrowthModel, n0: number, r: number, k?: number): number {
  if (model === 'logistic' && k !== undefined && n0 < k) {
    // Until the population is within 2 % of the carrying capacity.
    return Math.log((0.98 * k * (k - n0)) / (n0 * 0.02 * k)) / r
  }
  return 4 * (Math.LN2 / r)
}

// --- regression and confidence intervals ------------------------------------

export interface LinearFit {
  slope: number
  intercept: number
  r: number
  r2: number
  n: number
  /** Residual standard error s = √(SSE / (n − 2)). */
  residualSe: number
  slopeSe: number
  meanX: number
  sxx: number
}

export function linearFit(points: Array<{ x: number; y: number }>): LinearFit | null {
  const n = points.length
  if (n < 2) return null
  const meanX = points.reduce((s, p) => s + p.x, 0) / n
  const meanY = points.reduce((s, p) => s + p.y, 0) / n
  const sxx = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0)
  const syy = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0)
  const sxy = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0)
  if (sxx === 0) return null
  const slope = sxy / sxx
  const intercept = meanY - slope * meanX
  const sse = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0)
  const r = syy === 0 ? 1 : sxy / Math.sqrt(sxx * syy)
  const residualSe = n > 2 ? Math.sqrt(sse / (n - 2)) : 0
  return { slope, intercept, r, r2: r * r, n, residualSe, slopeSe: residualSe / Math.sqrt(sxx), meanX, sxx }
}

/** Half-widths of the confidence band (mean response) and prediction band at x. */
export function regressionBands(fit: LinearFit, x: number, level = 0.95): { confidence: number; prediction: number } {
  if (fit.n <= 2) return { confidence: 0, prediction: 0 }
  const t = quantile({ family: 't', df: fit.n - 2 }, 1 - (1 - level) / 2)
  const leverage = 1 / fit.n + (x - fit.meanX) ** 2 / fit.sxx
  return {
    confidence: t * fit.residualSe * Math.sqrt(leverage),
    prediction: t * fit.residualSe * Math.sqrt(1 + leverage),
  }
}

/** Two-sided p-value of H₀: slope = 0 (t test with n − 2 df). */
export function slopePValue(fit: LinearFit): number | null {
  if (fit.n <= 2 || fit.slopeSe === 0) return null
  const t = Math.abs(fit.slope / fit.slopeSe)
  const df = fit.n - 2
  return Math.min(1, 2 * (1 - cdf({ family: 't', df }, t)))
}

export interface ConfidenceInterval {
  standardError: number
  critical: number
  margin: number
  lower: number
  upper: number
  /** 'z' when σ is known, otherwise 't' with n − 1 degrees of freedom. */
  distribution: 'z' | 't'
}

export function confidenceInterval(mean: number, sd: number, n: number, level: number, sigmaKnown: boolean): ConfidenceInterval {
  const standardError = sd / Math.sqrt(n)
  const p = 1 - (1 - level) / 2
  const critical = sigmaKnown ? quantile({ family: 'normal', mu: 0, sigma: 1 }, p) : quantile({ family: 't', df: n - 1 }, p)
  const margin = critical * standardError
  return { standardError, critical, margin, lower: mean - margin, upper: mean + margin, distribution: sigmaKnown ? 'z' : 't' }
}
