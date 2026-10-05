/**
 * Probability distributions for `distribution_2d` diagrams.
 *
 * The model only names a family and its parameters (copied from the lesson);
 * every density, mass, probability, mean and variance is computed here, so a
 * figure can never show a number the maths does not support.
 */

export type DistributionFamily = 'normal' | 'binomial' | 'poisson' | 'uniform' | 'exponential'

export const DISTRIBUTION_FAMILIES: readonly DistributionFamily[] = [
  'normal',
  'binomial',
  'poisson',
  'uniform',
  'exponential',
]

export type DistributionParams =
  | { family: 'normal'; mu: number; sigma: number }
  | { family: 'binomial'; n: number; p: number }
  | { family: 'poisson'; lambda: number }
  | { family: 'uniform'; a: number; b: number }
  | { family: 'exponential'; lambda: number }

/** A closed interval [from, to]; either end may be open-ended (±∞). */
export interface ProbabilityInterval {
  from?: number
  to?: number
}

export const DISTRIBUTION_LIMITS = {
  maxBinomialN: 60,
  maxPoissonLambda: 50,
  maxMagnitude: 1e6,
} as const

export function isDiscrete(params: DistributionParams): boolean {
  return params.family === 'binomial' || params.family === 'poisson'
}

/** Validate untrusted parameters; null when they do not define a distribution. */
export function validateParams(
  family: DistributionFamily,
  raw: Record<string, unknown>,
): DistributionParams | null {
  const num = (key: string): number | null => {
    const value = raw[key]
    return typeof value === 'number' && Number.isFinite(value) &&
      Math.abs(value) <= DISTRIBUTION_LIMITS.maxMagnitude
      ? value
      : null
  }
  switch (family) {
    case 'normal': {
      const mu = num('mu')
      const sigma = num('sigma')
      return mu !== null && sigma !== null && sigma > 0 ? { family, mu, sigma } : null
    }
    case 'binomial': {
      const n = num('n')
      const p = num('p')
      return n !== null && p !== null && Number.isInteger(n) && n >= 1 &&
        n <= DISTRIBUTION_LIMITS.maxBinomialN && p >= 0 && p <= 1
        ? { family, n, p }
        : null
    }
    case 'poisson': {
      const lambda = num('lambda')
      return lambda !== null && lambda > 0 && lambda <= DISTRIBUTION_LIMITS.maxPoissonLambda
        ? { family, lambda }
        : null
    }
    case 'uniform': {
      const a = num('a')
      const b = num('b')
      return a !== null && b !== null && a < b ? { family, a, b } : null
    }
    case 'exponential': {
      const lambda = num('lambda')
      return lambda !== null && lambda > 0 ? { family, lambda } : null
    }
  }
}

// --- special functions -------------------------------------------------------

/** Error function, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return sign * y
}

function logFactorial(k: number): number {
  let sum = 0
  for (let i = 2; i <= k; i++) sum += Math.log(i)
  return sum
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

// --- density / mass and distribution functions -----------------------------

/** Density (continuous) or mass (discrete) at x. */
export function density(params: DistributionParams, x: number): number {
  switch (params.family) {
    case 'normal': {
      const z = (x - params.mu) / params.sigma
      return Math.exp(-0.5 * z * z) / (params.sigma * Math.sqrt(2 * Math.PI))
    }
    case 'binomial': {
      const { n, p } = params
      if (!Number.isInteger(x) || x < 0 || x > n) return 0
      if (p === 0) return x === 0 ? 1 : 0
      if (p === 1) return x === n ? 1 : 0
      return Math.exp(logChoose(n, x) + x * Math.log(p) + (n - x) * Math.log(1 - p))
    }
    case 'poisson': {
      if (!Number.isInteger(x) || x < 0) return 0
      return Math.exp(x * Math.log(params.lambda) - params.lambda - logFactorial(x))
    }
    case 'uniform':
      return x >= params.a && x <= params.b ? 1 / (params.b - params.a) : 0
    case 'exponential':
      return x < 0 ? 0 : params.lambda * Math.exp(-params.lambda * x)
  }
}

/** P(X ≤ x). */
export function cdf(params: DistributionParams, x: number): number {
  switch (params.family) {
    case 'normal':
      return 0.5 * (1 + erf((x - params.mu) / (params.sigma * Math.SQRT2)))
    case 'uniform':
      return x <= params.a ? 0 : x >= params.b ? 1 : (x - params.a) / (params.b - params.a)
    case 'exponential':
      return x <= 0 ? 0 : 1 - Math.exp(-params.lambda * x)
    case 'binomial':
    case 'poisson': {
      if (x < 0) return 0
      let sum = 0
      const last = Math.floor(params.family === 'binomial' ? Math.min(x, params.n) : x)
      for (let k = 0; k <= last; k++) sum += density(params, k)
      return Math.min(1, sum)
    }
  }
}

/**
 * P(from ≤ X ≤ to), both ends inclusive (which matters only for discrete
 * distributions). A missing end is unbounded.
 */
export function intervalProbability(params: DistributionParams, interval: ProbabilityInterval): number {
  const from = interval.from ?? -Infinity
  const to = interval.to ?? Infinity
  if (from > to) return 0
  if (isDiscrete(params)) {
    const below = Number.isFinite(from) ? cdf(params, Math.ceil(from) - 1) : 0
    const upTo = Number.isFinite(to) ? cdf(params, Math.floor(to)) : 1
    return clamp01(upTo - below)
  }
  const upTo = Number.isFinite(to) ? cdf(params, to) : 1
  const below = Number.isFinite(from) ? cdf(params, from) : 0
  return clamp01(upTo - below)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function moments(params: DistributionParams): { mean: number; variance: number } {
  switch (params.family) {
    case 'normal':
      return { mean: params.mu, variance: params.sigma ** 2 }
    case 'binomial':
      return { mean: params.n * params.p, variance: params.n * params.p * (1 - params.p) }
    case 'poisson':
      return { mean: params.lambda, variance: params.lambda }
    case 'uniform':
      return { mean: (params.a + params.b) / 2, variance: (params.b - params.a) ** 2 / 12 }
    case 'exponential':
      return { mean: 1 / params.lambda, variance: 1 / params.lambda ** 2 }
  }
}

/** The x-range worth drawing: where essentially all the probability lies. */
export function plotRange(params: DistributionParams): { min: number; max: number } {
  switch (params.family) {
    case 'normal':
      return { min: params.mu - 4 * params.sigma, max: params.mu + 4 * params.sigma }
    case 'binomial':
      return { min: 0, max: params.n }
    case 'poisson':
      return {
        min: 0,
        max: Math.max(8, Math.ceil(params.lambda + 4 * Math.sqrt(params.lambda))),
      }
    case 'uniform': {
      const pad = (params.b - params.a) * 0.25
      return { min: params.a - pad, max: params.b + pad }
    }
    case 'exponential':
      return { min: 0, max: 5 / params.lambda }
  }
}

/** Compact parameter text, e.g. `N(μ = 0, σ = 1)` or `B(n = 10, p = 0.5)`. */
export function describeParams(params: DistributionParams): string {
  const f = formatNumber
  switch (params.family) {
    case 'normal':
      return `N(μ = ${f(params.mu)}, σ = ${f(params.sigma)})`
    case 'binomial':
      return `B(n = ${params.n}, p = ${f(params.p)})`
    case 'poisson':
      return `Poisson(λ = ${f(params.lambda)})`
    case 'uniform':
      return `U(${f(params.a)}, ${f(params.b)})`
    case 'exponential':
      return `Exp(λ = ${f(params.lambda)})`
  }
}

export function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return String(value)
  return Number.parseFloat(value.toPrecision(digits)).toString()
}

/** "P(a ≤ X ≤ b)", "P(X ≥ a)" or "P(X ≤ b)" for the shaded interval. */
export function intervalLabel(interval: ProbabilityInterval | undefined): string | null {
  if (!interval) return null
  const { from, to } = interval
  if (from !== undefined && to !== undefined) {
    return from === to
      ? `P(X = ${formatNumber(from)})`
      : `P(${formatNumber(from)} ≤ X ≤ ${formatNumber(to)})`
  }
  if (from !== undefined) return `P(X ≥ ${formatNumber(from)})`
  if (to !== undefined) return `P(X ≤ ${formatNumber(to)})`
  return null
}
