/**
 * Exact row reduction for small augmented matrices.
 *
 * Used to check the arithmetic in an AI-written walkthrough: the model states
 * the augmented matrix it starts from and the RREF it reached, and this module
 * recomputes the RREF with exact fractions (BigInt numerator / denominator),
 * so 19/5 stays 19/5 and no floating-point tolerance is needed.
 */

export interface Rational {
  n: bigint
  d: bigint
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

function make(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new Error('zero denominator')
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = gcd(n, d) || 1n
  return { n: n / g, d: d / g }
}

const sub = (a: Rational, b: Rational) => make(a.n * b.d - b.n * a.d, a.d * b.d)
const mul = (a: Rational, b: Rational) => make(a.n * b.n, a.d * b.d)
const div = (a: Rational, b: Rational) => make(a.n * b.d, a.d * b.n)
const isZero = (a: Rational) => a.n === 0n
const equal = (a: Rational, b: Rational) => a.n === b.n && a.d === b.d

/** Exact arithmetic for callers that replay row operations (walkthrough steps). */
export const rational = {
  of: (n: bigint, d = 1n): Rational => make(n, d),
  add: (a: Rational, b: Rational): Rational => make(a.n * b.d + b.n * a.d, a.d * b.d),
  sub,
  mul,
  div,
  isZero,
  equal,
}

const MAX_DIGITS = 30

/**
 * Read one matrix entry: `3`, `-2`, `0.5`, `19/5`, `-22/5`, `\frac{19}{5}`,
 * `-\tfrac{1}{10}`, `\tfrac12`, `−4` (Unicode minus). Anything else → null.
 */
export function parseRational(raw: unknown): Rational | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null
    return parseRational(String(raw))
  }
  if (typeof raw !== 'string') return null
  let text = raw
    .replace(/[−‒–]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^\$|\$$/g, '')
  if (!text) return null
  let sign = 1n
  while (text.startsWith('+') || text.startsWith('-')) {
    if (text[0] === '-') sign = -sign
    text = text.slice(1)
  }
  const frac = /^\\[dt]?frac(?:\{(\d+)\}\{(\d+)\}|(\d)(\d))$/.exec(text)
  if (frac) {
    const num = frac[1] ?? frac[3]!
    const den = frac[2] ?? frac[4]!
    return den === '0' ? null : make(sign * BigInt(num), BigInt(den))
  }
  const slash = /^(\d{1,30})\/(\d{1,30})$/.exec(text)
  if (slash)
    return slash[2] === '0' || /^0+$/.test(slash[2]!)
      ? null
      : make(sign * BigInt(slash[1]!), BigInt(slash[2]!))
  const decimal = /^(\d{1,30})(?:\.(\d{1,12}))?$/.exec(text)
  if (decimal) {
    const whole = decimal[1]!
    const fraction = decimal[2] ?? ''
    if (whole.length + fraction.length > MAX_DIGITS) return null
    return make(sign * BigInt(whole + fraction), 10n ** BigInt(fraction.length))
  }
  return null
}

export function formatRational(value: Rational): string {
  return value.d === 1n ? value.n.toString() : `${value.n}/${value.d}`
}

/** LaTeX for one entry, e.g. `-\tfrac{19}{5}`. */
export function rationalToLatex(value: Rational): string {
  if (value.d === 1n) return value.n.toString()
  const negative = value.n < 0n
  return `${negative ? '-' : ''}\\tfrac{${negative ? -value.n : value.n}}{${value.d}}`
}

/** `minWidth` is 2 by default (an augmented matrix); a coefficient matrix may have 1 column. */
export function parseMatrix(raw: unknown, minWidth = 2): Rational[][] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) return null
  const rows: Rational[][] = []
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < minWidth || row.length > 12) return null
    const parsed = row.map(parseRational)
    if (parsed.some((entry) => entry === null)) return null
    rows.push(parsed as Rational[])
  }
  const width = rows[0]!.length
  return rows.every((row) => row.length === width) ? rows : null
}

/** Reduced row echelon form of a matrix (every column takes part). */
export function rref(matrix: readonly (readonly Rational[])[]): Rational[][] {
  const rows = matrix.map((row) => [...row])
  const height = rows.length
  const width = rows[0]?.length ?? 0
  let pivotRow = 0
  for (let col = 0; col < width && pivotRow < height; col += 1) {
    let found = -1
    for (let r = pivotRow; r < height; r += 1) {
      if (!isZero(rows[r]![col]!)) {
        found = r
        break
      }
    }
    if (found < 0) continue
    ;[rows[pivotRow], rows[found]] = [rows[found]!, rows[pivotRow]!]
    const pivot = rows[pivotRow]![col]!
    rows[pivotRow] = rows[pivotRow]!.map((entry) => div(entry, pivot))
    for (let r = 0; r < height; r += 1) {
      if (r === pivotRow) continue
      const factor = rows[r]![col]!
      if (isZero(factor)) continue
      rows[r] = rows[r]!.map((entry, c) => sub(entry, mul(factor, rows[pivotRow]![c]!)))
    }
    pivotRow += 1
  }
  return rows
}

export type SolutionKind = 'none' | 'unique' | 'infinite'

/** How many solutions the system has, read from the RREF of its augmented matrix. */
export function solutionKind(reduced: readonly (readonly Rational[])[]): SolutionKind {
  const variables = (reduced[0]?.length ?? 1) - 1
  let pivots = 0
  for (const row of reduced) {
    const lead = row.findIndex((entry) => !isZero(entry))
    if (lead < 0) continue
    if (lead === variables) return 'none'
    pivots += 1
  }
  return pivots === variables ? 'unique' : 'infinite'
}

/**
 * How many solutions the HOMOGENEOUS system `M x = 0` has, read from the RREF
 * of `M` itself (every column is an unknown): `unique` means only the trivial
 * solution. Never `none` — a homogeneous system is always consistent.
 */
export function homogeneousKind(reduced: readonly (readonly Rational[])[]): SolutionKind {
  const width = reduced[0]?.length ?? 0
  return nonZeroRows(reduced).length === width ? 'unique' : 'infinite'
}

/** The rows of a `\begin{array}{…} … \end{array}` written by `matrixToLatex`. */
export function parseArrayLatex(latex: string): Rational[][] | null {
  const body = /\\begin\{array\}\{[^}]*\}([\s\S]*?)\\end\{array\}/.exec(latex)?.[1]
  if (!body) return null
  const rows = body
    .split('\\\\')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split('&').map((cell) => cell.trim()))
  return parseMatrix(rows)
}

const nonZeroRows = (matrix: readonly (readonly Rational[])[]) =>
  matrix.filter((row) => row.some((entry) => !isZero(entry)))

/** Same matrix once all-zero rows are ignored (a written RREF often drops them). */
export function sameReducedMatrix(
  a: readonly (readonly Rational[])[],
  b: readonly (readonly Rational[])[],
): boolean {
  const left = nonZeroRows(a)
  const right = nonZeroRows(b)
  if (left.length !== right.length) return false
  return left.every(
    (row, r) =>
      row.length === right[r]!.length && row.every((entry, c) => equal(entry, right[r]![c]!)),
  )
}

export function matrixToLatex(matrix: readonly (readonly Rational[])[], augmented = true): string {
  const width = matrix[0]?.length ?? 0
  const spec = augmented && width > 1 ? `${'c'.repeat(width - 1)}|c` : 'c'.repeat(width)
  const body = matrix.map((row) => row.map(rationalToLatex).join('&')).join('\\\\ ')
  return `\\left[\\begin{array}{${spec}} ${body} \\end{array}\\right]`
}
