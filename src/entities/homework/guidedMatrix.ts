/**
 * 引导练习 for row reduction: the walkthrough's row-reduction steps, replayed
 * locally, become exercises the student works one step at a time — first the
 * operation, then the resulting matrix, cell by cell.
 *
 * Everything is exact (BigInt fractions) and local; no AI is involved. The
 * walkthrough's route is the reference, but any valid elementary operation
 * that makes progress towards the reduced row echelon form is accepted too
 * (a different pivot, a swap the walkthrough did not make…). Only invertible
 * operations count, so every matrix the student reaches stays row-equivalent
 * to the starting one, and the final RREF necessarily agrees with the
 * walkthrough's.
 */
import { rational, rref, sameReducedMatrix, type Rational } from '@/infrastructure/math/rref'
import {
  applyRowOps,
  entryArithmetic,
  entryText,
  parseCell,
  parseRowOps,
  splitSteps,
  type RowOp,
  type RowProvenance,
} from './walkthroughSteps'

export type Matrix = Rational[][]
export type OpMode = 'together' | 'sequence'

export interface GuidedMatrixStep {
  ops: RowOp[]
  mode: OpMode
  /** LaTeX of the operations (normalised spelling). */
  opLatex: string
  /** The walkthrough's explanation of this step, when it gave one. */
  hint?: string
  result: Matrix
}

/** One row reduction of the walkthrough: a starting matrix and its steps. */
export interface GuidedChain {
  /** The sub-part heading it appeared under, e.g. `(a) 解方程组`. */
  label?: string
  start: Matrix
  /** Column the augmented bar sits before. */
  bar?: number
  steps: GuidedMatrixStep[]
  /** The walkthrough's last matrix. */
  final: Matrix
}

// --- Small matrix helpers ------------------------------------------------------

export function sameMatrix(
  a: readonly (readonly Rational[])[],
  b: readonly (readonly Rational[])[],
) {
  return (
    a.length === b.length &&
    a.every(
      (row, r) =>
        row.length === b[r]!.length && row.every((cell, c) => rational.equal(cell, b[r]![c]!)),
    )
  )
}

const ZERO = rational.of(0n)
const ONE = rational.of(1n)
const copy = (matrix: readonly (readonly Rational[])[]): Matrix => matrix.map((row) => [...row])

export function isRref(matrix: Matrix): boolean {
  return sameMatrix(rref(matrix), matrix)
}

// --- Operations: spelling -----------------------------------------------------

const negative = (value: Rational) => value.n < 0n
const abs = (value: Rational) => (negative(value) ? rational.mul(rational.of(-1n), value) : value)

function coefLatex(value: Rational): string {
  if (value.d === 1n) return value.n.toString()
  return `\\tfrac{${value.n}}{${value.d}}`
}

const rowLatex = (row: number) => `R_${row + 1}`

/** `R_2 \to R_2 - 2R_1`, `R_1 \leftrightarrow R_3`, `R_2 \to \tfrac{1}{3}R_2`. */
export function rowOpLatex(op: RowOp): string {
  if (op.kind === 'swap') return `${rowLatex(op.a)} \\leftrightarrow ${rowLatex(op.b)}`
  const terms = op.terms
    .filter((term) => !rational.isZero(term.coef))
    .map((term, index) => {
      const magnitude = abs(term.coef)
      const coef = rational.equal(magnitude, ONE) ? '' : coefLatex(magnitude)
      const sign = negative(term.coef) ? (index === 0 ? '-' : ' - ') : index === 0 ? '' : ' + '
      return `${sign}${coef}${rowLatex(term.row)}`
    })
  return `${rowLatex(op.target)} \\to ${terms.join('') || '0'}`
}

export function opsLatex(ops: readonly RowOp[]): string {
  // `,\quad` both reads well and splits again in `parseRowOps`.
  return ops.map(rowOpLatex).join(',\\quad ')
}

// --- Operations: what the student types ----------------------------------------

/**
 * Typed operation → the LaTeX-ish spelling `parseRowOps` reads. Accepts
 * `R2 -> R2 - 2R1`, `R_2→R_2-2R_1`, `R2 = R2 - 2R1`, `R1 <-> R2`, `R1↔R2`,
 * `交换 R1 R2`, `R2 / 3`, `1/2 R2`, `(1/2)R2`, `R₂ → R₂ − 2R₁` and LaTeX.
 */
export function normalizeTypedOps(input: string): string {
  return (
    input
      .normalize('NFKC')
      // Row names however they were typed or handwritten: `R 1`, `R _1`, `r1`,
      // `row 1`, `第1行` → `R1` (Scribble and autocorrect insert spaces).
      .replace(/第\s*(\d+)\s*行/g, 'R$1')
      .replace(/\brow\s*(\d+)/gi, 'R$1')
      .replace(/(^|[^A-Za-z\\])[Rr]\s*_?\s*\{?\s*(\d+)\s*\}?/g, '$1R$2')
      .replace(/⁄/g, '/')
      .replace(/[−‒–—]/g, '-')
      .replace(/[×✕]/g, '*')
      .replace(/÷/g, '/')
      .replace(
        /(?:swap|exchange|interchange|交换|互换)\s*([Rr]_?\{?\d+\}?)\s*(?:,|，|和|与|及|and|with|&)?\s*([Rr]_?\{?\d+\}?)/gi,
        '$1 \\leftrightarrow $2',
      )
      .replace(
        /([Rr]_?\{?\d+\}?)\s*(?:和|与|及|and|with)\s*([Rr]_?\{?\d+\}?)\s*(?:互换|交换|对调|swapped|swap)/gi,
        '$1 \\leftrightarrow $2',
      )
      .replace(/<->|<=>|<-->|⇔|⟷|↔/g, ' \\leftrightarrow ')
      .replace(/-->|->|=>|⟶|⇒|→|↦/g, ' \\to ')
      .replace(/<-|←/g, ' \\gets ')
      .replace(/([Rr]_?\{?\d+\}?)\s*(?::=|=)(?!>)/g, '$1 \\to ')
      .replace(/[“”"']/g, '')
      .trim()
  )
}

/** The operations a student typed, or null when they cannot be read. */
export function parseTypedOps(input: string): RowOp[] | null {
  const text = normalizeTypedOps(input)
  if (!text) return null
  const ops = parseRowOps(text, true)
  return ops && ops.length > 0 ? ops : null
}

// --- Applying ----------------------------------------------------------------

export interface Applied {
  matrix: Matrix
  provenance: Array<RowProvenance | undefined>
  mode: OpMode
}

/** Several operations at once read the matrix before them; otherwise in order. */
export function applyOps(matrix: Matrix, ops: readonly RowOp[]): Applied | null {
  const together = applyRowOps(matrix, ops, 'together')
  if (together) return { ...together, mode: 'together' }
  const sequence = applyRowOps(matrix, ops, 'sequence')
  return sequence ? { ...sequence, mode: 'sequence' } : null
}

function identity(size: number): Matrix {
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => (r === c ? ONE : ZERO)),
  )
}

/** An elementary (invertible) change: `R_2 \to 2R_1` or `R_2 \to 0R_2` is not. */
export function isInvertible(ops: readonly RowOp[], height: number, mode: OpMode): boolean {
  const applied = applyRowOps(identity(height), ops, mode)
  if (!applied) return false
  return sameMatrix(rref(applied.matrix), identity(height))
}

/** Replay a walkthrough step, choosing the reading that gives what it wrote. */
function replay(before: Matrix, ops: readonly RowOp[], written: Matrix): Applied | null {
  const together = applyRowOps(before, ops, 'together')
  const sequence = applyRowOps(before, ops, 'sequence')
  if (together && sameMatrix(together.matrix, written)) return { ...together, mode: 'together' }
  if (sequence && sameMatrix(sequence.matrix, written)) return { ...sequence, mode: 'sequence' }
  if (together) return { ...together, mode: 'together' }
  return sequence ? { ...sequence, mode: 'sequence' } : null
}

// --- Chains from a walkthrough -----------------------------------------------

const HEADING_LINE = /^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/
const MAX_HINT = 600

/** The paragraph right before a step, as its explanation. */
function hintFrom(text: string): string | undefined {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    // Headings and bare display formulas (the matrix itself) say nothing about the step.
    .filter(
      (paragraph) =>
        paragraph &&
        !/^#{1,6}\s/.test(paragraph) &&
        !/^(?:\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\])[\s.,，。:：]*$/.test(paragraph),
    )
  const last = paragraphs[paragraphs.length - 1]
  if (!last) return undefined
  return last.length > MAX_HINT ? `${last.slice(0, MAX_HINT - 1)}…` : last
}

/**
 * The row reductions of a walkthrough body, as guided exercises. A chain is
 * dropped when one of its steps cannot be replayed or is not an elementary
 * (invertible) operation; written arithmetic slips are corrected by replaying
 * the stated operations exactly.
 */
export function buildGuidedChains(body: string): GuidedChain[] {
  interface Building {
    chain: GuidedChain
    lastWritten: Matrix
    broken: boolean
  }
  const chains: GuidedChain[] = []
  let label: string | undefined
  let lastText = ''
  const state: { current: Building | null } = { current: null }
  const close = (): void => {
    const building = state.current
    if (building && !building.broken && building.chain.steps.length > 0) chains.push(building.chain)
    state.current = null
  }
  for (const chunk of splitSteps(body)) {
    if (chunk.kind === 'text') {
      for (const line of chunk.text.split('\n')) {
        const heading = HEADING_LINE.exec(line)
        if (heading) {
          label = heading[1]!.replace(/[*_`]/g, '').trim()
          close()
        }
      }
      lastText = chunk.text
      continue
    }
    const step = chunk.step
    let building = state.current
    if (!building || step.number === 1 || !sameMatrix(step.before.rows, building.lastWritten)) {
      close()
      building = {
        chain: {
          ...(label ? { label } : {}),
          start: copy(step.before.rows),
          ...(step.before.bar !== undefined ? { bar: step.before.bar } : {}),
          steps: [],
          final: copy(step.before.rows),
        },
        lastWritten: step.before.rows,
        broken: false,
      }
      state.current = building
    }
    const { chain } = building
    const before =
      chain.steps.length > 0 ? chain.steps[chain.steps.length - 1]!.result : chain.start
    const applied = replay(before, step.ops, step.after.rows)
    if (!applied || !isInvertible(step.ops, before.length, applied.mode)) building.broken = true
    else {
      const hint = step.intro ?? hintFrom(lastText)
      chain.steps.push({
        ops: step.ops,
        mode: applied.mode,
        opLatex: opsLatex(step.ops),
        ...(hint ? { hint } : {}),
        result: applied.matrix,
      })
      chain.final = applied.matrix
    }
    building.lastWritten = step.after.rows
    lastText = ''
  }
  close()
  return chains
}

// --- Standard Gauss–Jordan (for help off the walkthrough's route) -------------

function scaleOp(row: number, factor: Rational): RowOp {
  const op: RowOp = { kind: 'combine', target: row, terms: [{ row, coef: factor }], latex: '' }
  return { ...op, latex: rowOpLatex(op) }
}

function eliminateOp(target: number, pivot: number, factor: Rational): RowOp {
  const op: RowOp = {
    kind: 'combine',
    target,
    terms: [
      { row: target, coef: ONE },
      { row: pivot, coef: rational.mul(rational.of(-1n), factor) },
    ],
    latex: '',
  }
  return { ...op, latex: rowOpLatex(op) }
}

function swapOp(a: number, b: number): RowOp {
  const op: RowOp = { kind: 'swap', a, b, latex: '' }
  return { ...op, latex: rowOpLatex(op) }
}

/** The operations plain Gauss–Jordan elimination takes from `matrix` to its RREF. */
export function standardOps(matrix: Matrix, limit = 400): RowOp[] {
  let rows = copy(matrix)
  const ops: RowOp[] = []
  const push = (op: RowOp): void => {
    ops.push(op)
    rows = applyRowOps(rows, [op], 'sequence')!.matrix
  }
  const height = rows.length
  const width = rows[0]?.length ?? 0
  let pivotRow = 0
  for (let col = 0; col < width && pivotRow < height && ops.length < limit; col++) {
    let found = -1
    for (let r = pivotRow; r < height; r++) {
      if (!rational.isZero(rows[r]![col]!)) {
        found = r
        break
      }
    }
    if (found < 0) continue
    if (found !== pivotRow) push(swapOp(pivotRow, found))
    const pivot = rows[pivotRow]![col]!
    if (!rational.equal(pivot, ONE)) push(scaleOp(pivotRow, rational.div(ONE, pivot)))
    for (let r = 0; r < height; r++) {
      if (r === pivotRow) continue
      const factor = rows[r]![col]!
      if (!rational.isZero(factor)) push(eliminateOp(r, pivotRow, factor))
    }
    pivotRow += 1
  }
  return ops
}

/** Zeros in the coefficient part plus leading ones: grows as a reduction proceeds. */
function tidiness(matrix: Matrix, bar?: number): number {
  const width = bar ?? matrix[0]?.length ?? 0
  let score = 0
  for (const row of matrix) {
    for (let c = 0; c < width; c++) if (rational.isZero(row[c]!)) score += 1
    const lead = row.findIndex((value) => !rational.isZero(value))
    if (lead >= 0 && lead < width && rational.equal(row[lead]!, ONE)) score += 1
  }
  return score
}

// --- Judging one typed step --------------------------------------------------

export type OpRejection =
  'unreadable' | 'out-of-range' | 'not-invertible' | 'no-change' | 'no-progress'

export type OpVerdict =
  | {
      ok: true
      ops: RowOp[]
      applied: Applied
      /** The walkthrough position reached (index into `matrices(chain)`), or null off its route. */
      position: number | null
    }
  | { ok: false; reason: OpRejection; ops?: RowOp[] }

/** start, then the result of each walkthrough step. */
export function chainMatrices(chain: GuidedChain): Matrix[] {
  return [chain.start, ...chain.steps.map((step) => step.result)]
}

/** Where `matrix` is on the walkthrough's route (the furthest match), or null. */
export function routePosition(chain: GuidedChain, matrix: Matrix): number | null {
  const all = chainMatrices(chain)
  for (let index = all.length - 1; index >= 0; index--)
    if (sameMatrix(all[index]!, matrix)) return index
  return null
}

/**
 * `applyOps`, but when the two readings of several operations (together /
 * one after another) give different matrices, the one that lands further on
 * the walkthrough's route wins — the walkthrough may have meant them in
 * order, and the same operations typed by the student (or replayed from 看这一
 * 步答案) must follow it.
 */
export function applyOpsOnRoute(
  chain: GuidedChain,
  current: Matrix,
  ops: readonly RowOp[],
): Applied | null {
  const first = applyOps(current, ops)
  if (!first || ops.length < 2) return first
  const otherMode: OpMode = first.mode === 'together' ? 'sequence' : 'together'
  const other = applyRowOps(current, ops, otherMode)
  if (!other || sameMatrix(other.matrix, first.matrix)) return first
  const from = routePosition(chain, current) ?? -1
  const at = (matrix: Matrix) => routePosition(chain, matrix) ?? -1
  const firstAt = at(first.matrix)
  const otherAt = at(other.matrix)
  return otherAt > from && otherAt > firstAt ? { ...other, mode: otherMode } : first
}

/**
 * Judge the operations a student typed for the next step from `current`:
 * the walkthrough's step (or a later point of its route), or any other
 * elementary operation that moves towards the RREF.
 */
export function judgeOps(chain: GuidedChain, current: Matrix, typed: string): OpVerdict {
  const ops = parseTypedOps(typed)
  if (!ops) return { ok: false, reason: 'unreadable' }
  const height = current.length
  const inRange = ops.every((op) =>
    op.kind === 'swap'
      ? op.a < height && op.b < height
      : op.target < height && op.terms.every((term) => term.row < height),
  )
  if (!inRange) return { ok: false, reason: 'out-of-range', ops }
  const applied = applyOpsOnRoute(chain, current, ops)
  if (!applied) return { ok: false, reason: 'unreadable', ops }
  if (!isInvertible(ops, height, applied.mode)) return { ok: false, reason: 'not-invertible', ops }
  if (sameMatrix(applied.matrix, current)) return { ok: false, reason: 'no-change', ops }
  const from = routePosition(chain, current)
  const to = routePosition(chain, applied.matrix)
  if (to !== null && (from === null || to > from)) return { ok: true, ops, applied, position: to }
  const before = standardOps(current).length
  const after = standardOps(applied.matrix).length
  const progress =
    after < before ||
    (after <= before + 1 && tidiness(applied.matrix, chain.bar) > tidiness(current, chain.bar))
  if (!progress) return { ok: false, reason: 'no-progress', ops }
  return { ok: true, ops, applied, position: to }
}

/** The step to show for 看这一步答案 / the hint: the walkthrough's when on its route. */
export function nextReferenceStep(
  chain: GuidedChain,
  current: Matrix,
): { ops: RowOp[]; opLatex: string; hint?: string; fromWalkthrough: boolean } | null {
  const position = routePosition(chain, current)
  if (position !== null && position < chain.steps.length) {
    const step = chain.steps[position]!
    return {
      ops: step.ops,
      opLatex: step.opLatex,
      ...(step.hint ? { hint: step.hint } : {}),
      fromWalkthrough: true,
    }
  }
  const op = standardOps(current)[0]
  return op ? { ops: [op], opLatex: op.latex, fromWalkthrough: false } : null
}

/** The chain is finished: the walkthrough's last matrix, or the (same) RREF. */
export function chainFinished(chain: GuidedChain, current: Matrix): boolean {
  if (sameMatrix(current, chain.final)) return true
  return isRref(current) && sameReducedMatrix(current, rref(chain.final))
}

/** The student's final matrix agrees with the walkthrough's result (same RREF). */
export function agreesWithWalkthrough(chain: GuidedChain, current: Matrix): boolean {
  return sameReducedMatrix(rref(current), rref(chain.final))
}

// --- Cells -------------------------------------------------------------------

export type CellStatus = 'empty' | 'correct' | 'wrong' | 'unreadable' | 'inexact'

export interface CellCheck {
  status: CellStatus
  /** How the entry is computed (left-hand side only, so the value is not given away). */
  arithmetic?: { latex: string; text: string }
  /** The row was not changed by this step: copy it. */
  unchangedRow?: boolean
}

/** A typed entry: `-2/5`, `−0.4`, `\frac{-2}{5}`, `3`, `½`. */
export function parseTypedCell(raw: string): Rational | null {
  const text = raw.normalize('NFKC').replace(/⁄/g, '/').trim()
  if (!text) return null
  return parseCell(text)
}

const TERMINATING = (value: Rational) => {
  let d = value.d
  while (d % 2n === 0n) d /= 2n
  while (d % 5n === 0n) d /= 5n
  return d === 1n
}

function lhs(arithmetic: { latex: string; text: string }): { latex: string; text: string } {
  const cut = (value: string) => {
    const at = value.lastIndexOf(' = ')
    return at > 0 ? value.slice(0, at) : value
  }
  return { latex: cut(arithmetic.latex), text: cut(arithmetic.text) }
}

/** Check typed cells against the step's result, exactly. */
export function checkCells(
  expected: Matrix,
  typed: readonly (readonly string[])[],
  provenance: ReadonlyArray<RowProvenance | undefined>,
): CellCheck[][] {
  return expected.map((row, r) =>
    row.map((value, c): CellCheck => {
      const raw = typed[r]?.[c] ?? ''
      if (!raw.trim()) return { status: 'empty' }
      const parsed = parseTypedCell(raw)
      if (!parsed) return { status: 'unreadable' }
      if (rational.equal(parsed, value)) return { status: 'correct' }
      const origin = provenance[r]
      const help = origin
        ? { arithmetic: lhs(entryArithmetic(origin, c, value)) }
        : { unchangedRow: true }
      if (/[.]/.test(raw) && !TERMINATING(value)) {
        const close =
          Math.abs(Number(parsed.n) / Number(parsed.d) - Number(value.n) / Number(value.d)) <=
          0.005 * Math.max(1, Math.abs(Number(value.n) / Number(value.d)))
        if (close) return { status: 'inexact', ...help }
      }
      return { status: 'wrong', ...help }
    }),
  )
}

export const allCorrect = (checks: readonly (readonly CellCheck[])[]) =>
  checks.every((row) => row.every((cell) => cell.status === 'correct'))

/** Fill the rows this step leaves unchanged with their values (others untouched). */
export function fillUnchanged(
  typed: readonly (readonly string[])[],
  previous: Matrix,
  provenance: ReadonlyArray<RowProvenance | undefined>,
): string[][] {
  return previous.map((row, r) =>
    provenance[r]
      ? [...(typed[r] ?? row.map(() => ''))]
      : row.map((value) => entryText(value).replace('−', '-')),
  )
}

/** The whole result, as typed text (看这一步答案). */
export function matrixText(matrix: Matrix): string[][] {
  return matrix.map((row) => row.map((value) => entryText(value).replace('−', '-')))
}

export function emptyCells(matrix: Matrix): string[][] {
  return matrix.map((row) => row.map(() => ''))
}
