import type { LatexMatrix } from '@/entities/homework/walkthroughSteps'

type Rational = LatexMatrix['rows'][number][number]

/** Width of a typeset digit and of a minus sign, in em of the cell text (KaTeX scale). */
const DIGIT_EM = 0.61
const MINUS_EM = 0.94

/** Approximate typeset width of one entry: an integer, or a `\dfrac` (its wider part). */
export function entryWidthEm(value: Rational): number {
  const negative = value.n < 0n
  const digits = (n: bigint) => (n < 0n ? -n : n).toString().length
  const body = value.d === 1n ? digits(value.n) : Math.max(digits(value.n), digits(value.d))
  return body * DIGIT_EM + (negative ? MINUS_EM : 0)
}

/**
 * One minimum width per column, shared by the matrix before and after a step,
 * so both matrices space their entries identically (the widest entry of the
 * column in either matrix sets it).
 */
export function sharedColumnWidths(...matrices: LatexMatrix[]): number[] {
  const widths: number[] = []
  for (const matrix of matrices)
    for (const row of matrix.rows)
      row.forEach((value, col) => {
        widths[col] = Math.max(widths[col] ?? 0, entryWidthEm(value))
      })
  return widths.map((width) => Math.round(width * 100) / 100)
}
