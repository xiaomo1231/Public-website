import {
  formatRational,
  matrixToLatex,
  parseMatrix,
  rational,
  rationalToLatex,
  rref,
  sameReducedMatrix,
  solutionKind,
  type Rational,
  type SolutionKind,
} from '@/infrastructure/math/rref'
import type { Rng } from './random'
import type { LinearStyleHints } from '@/entities/questionHabits/types'
import type { PracticePart } from './types'

/**
 * Local construction of linear systems with a chosen solution type.
 *
 * A target RREF `R` is written first (pivots, free columns, a `0 = 1` row for
 * no solution), then scrambled with a random unimodular integer matrix `E`
 * (row additions with small multipliers and a row shuffle). `A = E·R` has the
 * same RREF, integer entries and a fraction-free elimination path. Candidates
 * with large entries, zero rows / columns or an elimination that needs many
 * fractions are rejected and redrawn. The reference RREF and solution are
 * recomputed from `A` with exact fractions (`rref.ts`) — never assumed.
 */

export interface SystemSpec {
  /** Equations (2–4). */
  rows: number
  /** Unknowns (2–5). */
  vars: number
  solution: SolutionKind
  /** Free variables for `infinite` (1–2); 0 otherwise. */
  free: number
}

export interface BuiltSystem {
  spec: SystemSpec
  augmented: Rational[][]
  reduced: Rational[][]
  pivots: number[]
}

const MAX_COEFFICIENT = 9
const MAX_RHS = 20
const MAX_FRACTIONS = 2
const MAX_TRIES = 400

/** A shape that can have the requested solution type (clamped to friendly sizes). */
export function normalizeSpec(raw: Partial<SystemSpec> & { solution: SolutionKind }): SystemSpec {
  let rows = clamp(raw.rows ?? 3, 2, 4)
  let vars = clamp(raw.vars ?? 3, 2, 5)
  if (raw.solution === 'unique') {
    if (rows < vars) {
      if (vars <= 4) rows = vars
      else vars = rows
    }
    return { rows, vars, solution: 'unique', free: 0 }
  }
  if (raw.solution === 'infinite') {
    let free = clamp(raw.free ?? 1, 1, 2)
    if (free >= vars) free = vars - 1
    // The pivots must fit in the equations.
    if (vars - free > rows) {
      if (vars - rows <= 2) free = vars - rows
      else vars = rows + free
    }
    return { rows, vars, solution: 'infinite', free }
  }
  return { rows, vars, solution: 'none', free: 0 }
}

/**
 * `spec` moved into the professor's usual sizes (教授出题习惯, read locally
 * from the profile): rows and unknowns are clamped into the hinted ranges,
 * then made feasible again. Without hints the spec is unchanged.
 */
export function applyLinearHints(spec: SystemSpec, hints: LinearStyleHints): SystemSpec {
  if (!hints.rows && !hints.vars) return spec
  return normalizeSpec({
    ...spec,
    rows: hints.rows ? clamp(spec.rows, hints.rows.min, hints.rows.max) : spec.rows,
    vars: hints.vars ? clamp(spec.vars, hints.vars.min, hints.vars.max) : spec.vars,
  })
}

/**
 * Build one friendly system for `spec`; null when no candidate passed
 * (practically never). `maxFractions: 0` asks for a fraction-free hand
 * elimination (the professor keeps to integers).
 */
export function buildLinearSystem(
  raw: SystemSpec,
  rng: Rng,
  options: { maxFractions?: number } = {},
): BuiltSystem | null {
  const spec = normalizeSpec(raw)
  const maxFractions = options.maxFractions ?? MAX_FRACTIONS
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    const target = targetRref(spec, rng)
    const augmented = scramble(target.matrix, rng)
    if (!friendly(augmented, maxFractions)) continue
    const reduced = rref(augmented)
    if (!sameReducedMatrix(reduced, target.matrix)) continue
    if (solutionKind(reduced) !== spec.solution) continue
    if (spec.solution === 'infinite' && freeCount(reduced) !== spec.free) continue
    return { spec, augmented, reduced, pivots: target.pivots }
  }
  return null
}

function targetRref(spec: SystemSpec, rng: Rng): { matrix: Rational[][]; pivots: number[] } {
  const { rows, vars } = spec
  const rank =
    spec.solution === 'unique'
      ? vars
      : spec.solution === 'infinite'
        ? vars - spec.free
        : Math.max(1, Math.min(vars, rows - 1) - (vars > 2 && rng.next() < 0.4 ? 1 : 0))
  // Free columns are never the first one, so the first unknown always leads.
  const freeColumns = new Set(
    rng.shuffle(Array.from({ length: vars - 1 }, (_, index) => index + 1)).slice(0, vars - rank),
  )
  const pivots = Array.from({ length: vars }, (_, index) => index).filter(
    (column) => !freeColumns.has(column),
  )
  const zero = (): Rational => rational.of(0n)
  const matrix: Rational[][] = Array.from({ length: rows }, () =>
    Array.from({ length: vars + 1 }, zero),
  )
  pivots.forEach((pivot, row) => {
    matrix[row]![pivot] = rational.of(1n)
    for (const column of freeColumns) {
      if (column > pivot) matrix[row]![column] = rational.of(BigInt(rng.int(-3, 3)))
    }
    matrix[row]![vars] = rational.of(BigInt(rng.int(-6, 6)))
  })
  if (spec.solution === 'none') matrix[rank]![vars] = rational.of(1n)
  return { matrix, pivots }
}

/** E·R with E a random unimodular integer matrix (row additions + a shuffle). */
function scramble(target: readonly Rational[][], rng: Rng): Rational[][] {
  let rows = target.map((row) => [...row])
  const height = rows.length
  const steps = height * 3
  for (let step = 0; step < steps; step += 1) {
    const i = rng.int(0, height - 1)
    let j = rng.int(0, height - 2)
    if (j >= i) j += 1
    const factor = rational.of(BigInt(rng.pick([1, -1, 1, -1, 2, -2])))
    rows[i] = rows[i]!.map((entry, column) =>
      rational.add(entry, rational.mul(factor, rows[j]![column]!)),
    )
  }
  rows = rng.shuffle(rows)
  return rows
}

const isInteger = (value: Rational): boolean => value.d === 1n
const magnitude = (value: Rational): number => Math.abs(Number(value.n) / Number(value.d))

function friendly(matrix: readonly Rational[][], maxFractions: number): boolean {
  const vars = matrix[0]!.length - 1
  for (const row of matrix) {
    if (row.every((entry) => entry.n === 0n)) return false
    if (row.slice(0, vars).every((entry) => entry.n === 0n) && row[vars]!.n === 0n) return false
    if (row.slice(0, vars).some((entry) => magnitude(entry) > MAX_COEFFICIENT)) return false
    if (magnitude(row[vars]!) > MAX_RHS) return false
  }
  for (let column = 0; column < vars; column += 1) {
    if (matrix.every((row) => row[column]!.n === 0n)) return false
  }
  // An easy first pivot: some equation starts with ±1 or ±2.
  if (!matrix.some((row) => row[0]!.n !== 0n && magnitude(row[0]!) <= 2)) return false
  return eliminationFractions(matrix) <= maxFractions
}

/**
 * The most non-integer entries met at any step of a sensible hand
 * elimination (the pivot row is the one with the smallest leading entry, ±1
 * first). A low count means the system can be solved with few fractions.
 */
export function eliminationFractions(matrix: readonly Rational[][]): number {
  const rows = matrix.map((row) => [...row])
  const height = rows.length
  const width = rows[0]!.length
  let worst = 0
  let pivotRow = 0
  for (let column = 0; column < width - 1 && pivotRow < height; column += 1) {
    let best = -1
    for (let r = pivotRow; r < height; r += 1) {
      const entry = rows[r]![column]!
      if (entry.n === 0n) continue
      if (best < 0 || magnitude(entry) < magnitude(rows[best]![column]!)) best = r
    }
    if (best < 0) continue
    ;[rows[pivotRow], rows[best]] = [rows[best]!, rows[pivotRow]!]
    const pivot = rows[pivotRow]![column]!
    rows[pivotRow] = rows[pivotRow]!.map((entry) => rational.div(entry, pivot))
    for (let r = 0; r < height; r += 1) {
      if (r === pivotRow) continue
      const factor = rows[r]![column]!
      if (factor.n === 0n) continue
      rows[r] = rows[r]!.map((entry, c) =>
        rational.sub(entry, rational.mul(factor, rows[pivotRow]![c]!)),
      )
    }
    worst = Math.max(worst, rows.flat().filter((entry) => !isInteger(entry)).length)
    pivotRow += 1
  }
  return worst
}

/** Free variables of a consistent system, read from its RREF. */
export function freeCount(reduced: readonly (readonly Rational[])[]): number {
  const vars = (reduced[0]?.length ?? 1) - 1
  const pivots = reduced.filter((row) => {
    const lead = row.findIndex((entry) => entry.n !== 0n)
    return lead >= 0 && lead < vars
  }).length
  return vars - pivots
}

/** Shape of a system from the locally computed RREF of a walkthrough check (LaTeX). */
export function systemFromRrefLatex(
  latex: string,
  solution: SolutionKind,
): (Omit<SystemSpec, 'free'> & { free: number }) | null {
  const body = /\\begin\{array\}\{[^}]*\}([\s\S]*?)\\end\{array\}/.exec(latex)?.[1]
  if (!body) return null
  const rows = body
    .split('\\\\')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split('&').map((cell) => cell.trim()))
  const matrix = parseMatrix(rows)
  if (!matrix) return null
  return {
    rows: matrix.length,
    vars: matrix[0]!.length - 1,
    solution,
    free: solution === 'infinite' ? freeCount(matrix) : 0,
  }
}

// --- Text ----------------------------------------------------------------------

export type PracticeLanguage = 'zh' | 'en'

const variable = (index: number): string => `x_${index + 1}`

/** The system as equations, e.g. `x_1 + 2x_2 - x_3 = 4`. */
export function equationsLatex(matrix: readonly Rational[][]): string {
  const vars = matrix[0]!.length - 1
  const lines = matrix.map((row) => {
    let text = ''
    for (let column = 0; column < vars; column += 1) {
      const coefficient = row[column]!
      if (coefficient.n === 0n) continue
      const negative = coefficient.n < 0n
      const absolute = rational.of(negative ? -coefficient.n : coefficient.n, coefficient.d)
      const shown =
        absolute.n === 1n && absolute.d === 1n ? '' : rationalToLatex(absolute).replace('-', '')
      const term = `${shown}${variable(column)}`
      text = text ? `${text} ${negative ? '-' : '+'} ${term}` : `${negative ? '-' : ''}${term}`
    }
    return `${text || '0'} &= ${rationalToLatex(row[vars]!)}`
  })
  return `\\begin{aligned} ${lines.join(' \\\\ ')} \\end{aligned}`
}

/** The general solution, read from the RREF (parameters t, s for free variables). */
export function solutionAnswer(built: BuiltSystem, language: PracticeLanguage): string {
  const { reduced } = built
  const kind = solutionKind(reduced)
  if (kind === 'none') return language === 'zh' ? '无解' : 'No solution'
  const vars = reduced[0]!.length - 1
  const pivotOf = new Map<number, Rational[]>()
  for (const row of reduced) {
    const lead = row.findIndex((entry) => entry.n !== 0n)
    if (lead >= 0 && lead < vars) pivotOf.set(lead, row)
  }
  const params = ['t', 's', 'u']
  const freeNames = new Map<number, string>()
  for (let column = 0; column < vars; column += 1) {
    if (!pivotOf.has(column)) freeNames.set(column, params[freeNames.size] ?? `t_${column}`)
  }
  const parts: string[] = []
  for (let column = 0; column < vars; column += 1) {
    const row = pivotOf.get(column)
    if (!row) {
      parts.push(`${variable(column)} = ${freeNames.get(column)}`)
      continue
    }
    let text = formatRational(row[vars]!)
    for (const [free, name] of freeNames) {
      const coefficient = row[free]!
      if (coefficient.n === 0n) continue
      // x_p + c·x_f = d  →  x_p = d − c·t
      const negated = rational.sub(rational.of(0n), coefficient)
      const negative = negated.n < 0n
      const absolute = rational.of(negative ? -negated.n : negated.n, negated.d)
      const shown = absolute.n === 1n && absolute.d === 1n ? '' : `${formatRational(absolute)}*`
      const term = `${shown}${name}`
      text =
        text === '0' ? `${negative ? '-' : ''}${term}` : `${text} ${negative ? '-' : '+'} ${term}`
    }
    parts.push(`${variable(column)} = ${text}`)
  }
  return parts.join(', ')
}

/** A practice part for one built system: prompt, answer, worked solution, grader. */
export function linearSystemPart(
  built: BuiltSystem,
  options: { label?: string; language: PracticeLanguage; asMatrix: boolean },
): PracticePart {
  const { language } = options
  const display = options.asMatrix
    ? matrixToLatex(built.augmented)
    : equationsLatex(built.augmented)
  const prompt = options.asMatrix
    ? language === 'zh'
      ? `增广矩阵为 $$${display}$$`
      : `The augmented matrix is $$${display}$$`
    : `$$${display}$$`
  const answer = solutionAnswer(built, language)
  const kind = solutionKind(built.reduced)
  const free = kind === 'infinite' ? freeCount(built.reduced) : 0
  const verdict =
    language === 'zh'
      ? kind === 'none'
        ? '出现 $0 = 1$ 的行，方程组无解。'
        : kind === 'unique'
          ? '每个未知数都有主元，方程组有唯一解：'
          : `有 ${free} 个自由变量，方程组有无穷多解：`
      : kind === 'none'
        ? 'A row reads $0 = 1$, so the system has no solution.'
        : kind === 'unique'
          ? 'Every unknown has a pivot, so the solution is unique:'
          : `There ${free === 1 ? 'is 1 free variable' : `are ${free} free variables`}, so there are infinitely many solutions:`
  const solution = [
    language === 'zh'
      ? `增广矩阵 $$${matrixToLatex(built.augmented)}$$ 化为简化行阶梯形：`
      : `Row-reduce the augmented matrix $$${matrixToLatex(built.augmented)}$$ to RREF:`,
    `$$${matrixToLatex(built.reduced)}$$`,
    verdict,
    ...(kind === 'none' ? [] : [`$${answer.replace(/\*/g, '')}$`]),
  ].join('\n\n')
  return {
    ...(options.label ? { label: options.label } : {}),
    prompt,
    answer,
    solution,
    grader: {
      kind: 'linear_system',
      augmented: built.augmented.map((row) => row.map(formatRational)),
      rref: built.reduced.map((row) => row.map(formatRational)),
      solution: kind,
      free,
    },
  }
}

/** The shared statement of a linear-system question. */
export function linearSystemStem(language: PracticeLanguage, asMatrix: boolean): string {
  if (language === 'zh')
    return asMatrix
      ? '对下列每个增广矩阵所对应的线性方程组：化为简化行阶梯形（RREF），判断解的情况（无解 / 唯一解 / 无穷多解），有解时写出全部解。'
      : '解下列线性方程组：写出增广矩阵并化为简化行阶梯形（RREF），判断解的情况（无解 / 唯一解 / 无穷多解），有解时写出全部解。'
  return asMatrix
    ? 'For the linear system of each augmented matrix below: reduce it to RREF, decide whether it has no solution, a unique solution or infinitely many, and give all solutions when there are any.'
    : 'Solve each linear system below: write its augmented matrix, reduce it to RREF, decide whether it has no solution, a unique solution or infinitely many, and give all solutions when there are any.'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)))
}
