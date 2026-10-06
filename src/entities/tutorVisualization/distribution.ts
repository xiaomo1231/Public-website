/**
 * Probability distributions for `distribution_2d` diagrams.
 *
 * The model only names a family and its parameters (copied from the lesson);
 * every density, mass, probability, mean and variance is computed here, so a
 * figure can never show a number the maths does not support.
 */

export type DistributionFamily =
  | 'normal'
  | 'binomial'
  | 'poisson'
  | 'uniform'
  | 'exponential'
  | 't'
  | 'chisquare'
  | 'f'

export const DISTRIBUTION_FAMILIES: readonly DistributionFamily[] = [
  'normal',
  'binomial',
  'poisson',
  'uniform',
  'exponential',
  't',
  'chisquare',
  'f',
]

export type DistributionParams =
  | { family: 'normal'; mu: number; sigma: number }
  | { family: 'binomial'; n: number; p: number }
  | { family: 'poisson'; lambda: number }
  | { family: 'uniform'; a: number; b: number }
  | { family: 'exponential'; lambda: number }
  | { family: 't'; df: number }
  | { family: 'chisquare'; df: number }
  | { family: 'f'; df1: number; df2: number }

/** A closed interval [from, to]; either end may be open-ended (±∞). */
export interface ProbabilityInterval {
  from?: number
  to?: number
}

export const DISTRIBUTION_LIMITS = {
  maxBinomialN: 60,
  maxPoissonLambda: 50,
  maxDegreesOfFreedom: 1000,
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
    case 't':
    case 'chisquare': {
      const df = degreesOfFreedom(num('df'))
      return df !== null ? { family, df } : null
    }
    case 'f': {
      const df1 = degreesOfFreedom(num('df1'))
      const df2 = degreesOfFreedom(num('df2'))
      return df1 !== null && df2 !== null ? { family, df1, df2 } : null
    }
  }
}

/** Degrees of freedom: positive (Welch's t may be fractional), bounded. */
function degreesOfFreedom(value: number | null): number | null {
  return value !== null && value > 0 && value <= DISTRIBUTION_LIMITS.maxDegreesOfFreedom ? value : null
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

/** ln Γ(x) for x > 0 (Lanczos, g = 7). */
export function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  const z = x - 1
  let a = c[0]!
  const t = z + 7.5
  for (let i = 1; i < 9; i++) a += c[i]! / (z + i)
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b)
}

const TINY = 1e-300

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    // Series.
    let sum = 1 / a
    let term = sum
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break
    }
    return clamp01(sum * Math.exp(-x + a * Math.log(x) - logGamma(a)))
  }
  // Continued fraction for Q(a, x) (modified Lentz).
  let b = x + 1 - a
  let c = 1 / TINY
  let d = 1 / b
  let h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < TINY) d = TINY
    c = b + an / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  return clamp01(1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h)
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let h = d
  for (let m = 1; m < 500; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
export function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b))
  return x < (a + 1) / (a + b + 2)
    ? clamp01((front * betaContinuedFraction(a, b, x)) / a)
    : clamp01(1 - (front * betaContinuedFraction(b, a, 1 - x)) / b)
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
    case 't': {
      const v = params.df
      return Math.exp(
        logGamma((v + 1) / 2) - logGamma(v / 2) - 0.5 * Math.log(v * Math.PI) - ((v + 1) / 2) * Math.log(1 + (x * x) / v),
      )
    }
    case 'chisquare': {
      if (x <= 0) return 0
      const k = params.df / 2
      return Math.exp((k - 1) * Math.log(x) - x / 2 - k * Math.LN2 - logGamma(k))
    }
    case 'f': {
      if (x <= 0) return 0
      const { df1: a, df2: b } = params
      return Math.exp(
        0.5 * (a * Math.log(a * x) + b * Math.log(b) - (a + b) * Math.log(a * x + b)) - Math.log(x) - logBeta(a / 2, b / 2),
      )
    }
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
    case 't': {
      const tail = 0.5 * betaI(params.df / 2, 0.5, params.df / (params.df + x * x))
      return x >= 0 ? 1 - tail : tail
    }
    case 'chisquare':
      return gammaP(params.df / 2, Math.max(0, x) / 2)
    case 'f':
      return x <= 0 ? 0 : betaI(params.df1 / 2, params.df2 / 2, (params.df1 * x) / (params.df1 * x + params.df2))
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

/**
 * The x with P(X ≤ x) = p for a continuous distribution (bisection on the
 * CDF); used for critical values.
 */
export function quantile(params: DistributionParams, p: number): number {
  const range = plotRange(params)
  let lo = params.family === 'chisquare' || params.family === 'f' || params.family === 'exponential' ? 0 : range.min
  let hi = range.max
  while (cdf(params, lo) > p && lo > -1e6) lo = lo * 2 - 1
  while (cdf(params, hi) < p && hi < 1e6) hi = hi * 2 + 1
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (cdf(params, mid) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Mean and variance; NaN where a moment does not exist (t with ν ≤ 1, F with
 * d₂ ≤ 2) and Infinity where it diverges.
 */
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
    case 't': {
      const v = params.df
      return { mean: v > 1 ? 0 : NaN, variance: v > 2 ? v / (v - 2) : v > 1 ? Infinity : NaN }
    }
    case 'chisquare':
      return { mean: params.df, variance: 2 * params.df }
    case 'f': {
      const { df1: a, df2: b } = params
      return {
        mean: b > 2 ? b / (b - 2) : NaN,
        variance: b > 4 ? (2 * b * b * (a + b - 2)) / (a * (b - 2) ** 2 * (b - 4)) : b > 2 ? Infinity : NaN,
      }
    }
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
    case 't': {
      const half = params.df <= 2 ? 8 : params.df <= 5 ? 6 : 4.5
      return { min: -half, max: half }
    }
    case 'chisquare':
      return { min: 0, max: Math.max(8, params.df + 5 * Math.sqrt(2 * params.df)) }
    case 'f': {
      const { mean, variance } = moments(params)
      const spread = Number.isFinite(variance) ? mean + 4 * Math.sqrt(variance) : 8
      return { min: 0, max: Math.min(20, Math.max(4, spread)) }
    }
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
    case 't':
      return `t(ν = ${f(params.df)})`
    case 'chisquare':
      return `χ²(k = ${f(params.df)})`
    case 'f':
      return `F(d₁ = ${f(params.df1)}, d₂ = ${f(params.df2)})`
  }
}

/** Densities that are unbounded at 0 (χ² with k < 2, F with d₁ < 2). */
export function unboundedAtZero(params: DistributionParams): boolean {
  return (params.family === 'chisquare' && params.df < 2) || (params.family === 'f' && params.df1 < 2)
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
