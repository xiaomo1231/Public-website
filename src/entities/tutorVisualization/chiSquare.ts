/**
 * Chi-square goodness-of-fit test (genetics ratios, categorical data).
 *
 * The model supplies the categories with observed counts and either the
 * expected counts or the expected ratio (e.g. 9 : 3 : 3 : 1) from the lesson;
 * the expected counts, χ², degrees of freedom, p-value and critical value are
 * computed here.
 */
import { cdf, quantile } from './distribution'

export interface ChiSquareCategory {
  label: string
  observed: number
  expected: number
}

export interface ChiSquareResult {
  statistic: number
  df: number
  pValue: number
  critical: number
  alpha: number
  /** True when the null hypothesis (the expected distribution) is rejected. */
  rejects: boolean
  /** (O − E)² / E per category. */
  contributions: number[]
  /** Some expected count is below 5: the χ² approximation is unreliable. */
  smallExpected: boolean
}

export const MAX_CHI_SQUARE_CATEGORIES = 12

/** Expected counts from a ratio, scaled to the observed total. */
export function expectedFromRatio(observed: number[], ratio: number[]): number[] {
  const total = observed.reduce((a, b) => a + b, 0)
  const parts = ratio.reduce((a, b) => a + b, 0)
  return ratio.map((r) => (total * r) / parts)
}

export function chiSquareTest(categories: ChiSquareCategory[], df: number, alpha: number): ChiSquareResult {
  const contributions = categories.map(({ observed, expected }) => (observed - expected) ** 2 / expected)
  const statistic = contributions.reduce((a, b) => a + b, 0)
  const distribution = { family: 'chisquare' as const, df }
  const pValue = Math.min(1, Math.max(0, 1 - cdf(distribution, statistic)))
  const critical = quantile(distribution, 1 - alpha)
  return {
    statistic,
    df,
    pValue,
    critical,
    alpha,
    rejects: pValue < alpha,
    contributions,
    smallExpected: categories.some((category) => category.expected < 5),
  }
}
