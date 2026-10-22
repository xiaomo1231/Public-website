/**
 * Row-reduction steps in a walkthrough, recognised at display time.
 *
 * A step is a sentence naming row operations ("作 $R_3 \to R_3 - 3R_1 - 2R_2$")
 * followed by the matrix they produce, or a display formula chaining matrices
 * with labelled arrows (`A \xrightarrow{R_2 - 2R_1} B`). The page shows each
 * one as a step card with the matrix before and after, highlights the rows
 * that changed and, from the previous matrix and the parsed operations,
 * computes every changed entry locally with exact fractions — so a written
 * entry that disagrees is flagged with the value it should have.
 *
 * Everything here is conservative: whatever cannot be read exactly (an
 * unfamiliar cell, an operation described in words, a matrix of another size)
 * is left as ordinary text, and a step whose written matrix changed rows the
 * stated operations do not touch is not checked at all, so no mistake is
 * claimed that cannot be proven. Nothing stored is rewritten.
 */
import { parseRational, rational, type Rational } from '@/infrastructure/math/rref'

export interface LatexMatrix {
  rows: Rational[][]
  /** The column index the augmented bar sits before, when there is one. */
  bar?: number
}

export type RowOp =
  | { kind: 'swap'; a: number; b: number; latex: string }
  | {
      kind: 'combine'
      /** 0-based row replaced by the combination. */
      target: number
      terms: Array<{ row: number; coef: Rational }>
      latex: string
    }

/** How one row of a step's result was produced. */
export type RowProvenance =
  | { kind: 'swap'; from: number }
  | {
      kind: 'combine'
      terms: Array<{ row: number; coef: Rational }>
      /** The entries each term read, per column (same order as `terms`). */
      values: Rational[][]
    }

export interface StepMismatch {
  row: number
  col: number
  /** What the operations give. */
  expected: Rational
  /** What the walkthrough wrote. */
  written: Rational
}

export interface WalkthroughStep {
  /** 1-based within its sub-part. */
  number: number
  /** The sentence that named the operations, when it says more than them. */
  intro?: string
  ops: RowOp[]
  before: LatexMatrix
  /** As written in the walkthrough. */
  after: LatexMatrix
  /** Computed locally from `before` and `ops`. */
  computed: Rational[][]
  provenance: Array<RowProvenance | undefined>
  changedRows: number[]
  mismatches: StepMismatch[]
}

export type BodyChunk = { kind: 'text'; text: string } | { kind: 'step'; step: WalkthroughStep }

// --- Matrices ----------------------------------------------------------------

const MATRIX_ENVS = 'bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix|array'
const BEGIN = new RegExp(String.raw`\\begin\{(${MATRIX_ENVS})\}`, 'g')
const MAX_SIZE = 12

/** Read `{…}` starting at `from` (which must be `{`); returns content and end. */
function braced(text: string, from: number): { value: string; end: number } | null {
  if (text[from] !== '{') return null
  let depth = 0
  for (let index = from; index < text.length; index++) {
    const char = text[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { value: text.slice(from + 1, index), end: index + 1 }
    }
  }
  return null
}

function stripBraces(text: string): string {
  let value = text
  while (value.startsWith('{') && braced(value, 0)?.end === value.length) value = value.slice(1, -1)
  return value
}

/** One matrix entry: `3`, `-\dfrac{1}{2}`, `\frac{-1}{2}`, `{-4}`, `0.5`, `\mathbf{1}`. */
export function parseCell(raw: string): Rational | null {
  let text = raw
    .replace(/\\(?:,|;|:|!|quad|qquad)/g, '')
    .replace(/\\(?:phantom|hphantom)\{[^{}]*\}/g, '')
    .replace(/\\(?:textcolor|colorbox)\{[^{}]*\}\{([^{}]*)\}/g, '$1')
    .replace(/\\color\{[^{}]*\}/g, '')
    .replace(
      /\\(?:mathbf|boldsymbol|bm|textbf|mathrm|text|underline|boxed|mathit)\{([^{}]*)\}/g,
      '$1',
    )
    .replace(/[−‒–]/g, '-')
    .replace(/\s+/g, '')
  text = stripBraces(text)
  if (!text) return null
  let negative = false
  while (text.startsWith('+') || text.startsWith('-')) {
    if (text[0] === '-') negative = !negative
    text = stripBraces(text.slice(1))
  }
  const frac = /^\\[dt]?frac\{([+-]?\d{1,30})\}\{([+-]?\d{1,30})\}$/.exec(text)
  let value: Rational | null
  if (frac) {
    const n = BigInt(frac[1]!)
    const d = BigInt(frac[2]!)
    value = d === 0n ? null : rational.of(n, d)
  } else {
    value = parseRational(text)
  }
  if (!value) return null
  return negative ? rational.mul(rational.of(-1n), value) : value
}

/** Where the bar of an `array` column spec sits (`ccc|c` → 3). */
function barOf(spec: string): number | undefined {
  const expanded = spec
    .replace(/@\{[^{}]*\}/g, '')
    .replace(/\*\{(\d+)\}\{([^{}]*)\}/g, (_, count: string, cols: string) =>
      cols.repeat(Math.min(Number(count), MAX_SIZE)),
    )
  const index = expanded.indexOf('|')
  if (index < 0) return undefined
  const before = expanded.slice(0, index).replace(/[^lcr]/g, '').length
  return before > 0 ? before : undefined
}

function parseMatrixBody(body: string, spec?: string): LatexMatrix | null {
  const cleaned = body
    .replace(/\\\\\s*\[[^\]]*\]/g, '\\\\')
    .replace(/\\(?:hline|hdashline)/g, '')
    .replace(/\\cline\{[^{}]*\}/g, '')
  const lines = cleaned.split(/\\\\/).map((line) => line.trim())
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length < 2 || lines.length > MAX_SIZE || lines.some((line) => line === '')) return null
  const rows: Rational[][] = []
  for (const line of lines) {
    const cells = line.split(/(?<!\\)&/)
    if (cells.length < 2 || cells.length > MAX_SIZE) return null
    const parsed = cells.map(parseCell)
    if (parsed.some((cell) => cell === null)) return null
    rows.push(parsed as Rational[])
  }
  const width = rows[0]!.length
  if (!rows.every((row) => row.length === width)) return null
  const bar = spec ? barOf(spec) : undefined
  return { rows, ...(bar !== undefined && bar < width ? { bar } : {}) }
}

export interface FoundMatrix {
  start: number
  end: number
  matrix: LatexMatrix | null
}

/** Every matrix environment of a formula, in order (nested ones are not read). */
export function findMatrices(latex: string): FoundMatrix[] {
  const found: FoundMatrix[] = []
  BEGIN.lastIndex = 0
  for (let match = BEGIN.exec(latex); match; match = BEGIN.exec(latex)) {
    const env = match[1]!
    let contentStart = match.index + match[0].length
    let spec: string | undefined
    if (env === 'array') {
      const arg = braced(latex, contentStart)
      if (!arg) break
      spec = arg.value
      contentStart = arg.end
    }
    const close = `\\end{${env}}`
    const end = latex.indexOf(close, contentStart)
    if (end < 0) break
    const body = latex.slice(contentStart, end)
    found.push({
      start: match.index,
      end: end + close.length,
      matrix: body.includes('\\begin{') ? null : parseMatrixBody(body, spec),
    })
    BEGIN.lastIndex = end + close.length
  }
  return found
}

// --- Row operations ----------------------------------------------------------

const ROW_TOKEN = /[Rr]_?\{?(\d{1,2})\}?/g
const SWAP = /\\longleftrightarrow|\\leftrightarrow|↔|\\rightleftharpoons|\\Leftrightarrow/g
const ARROW = /\\longrightarrow|\\rightarrow|\\to(?![a-zA-Z])|→|\\mapsto/g
const LEFT_ARROW = /\\leftarrow|\\gets|←/g
const NUMBER = String.raw`(?:\\[dt]?frac\{\d+\}\{\d+\}|\\[dt]?frac\d\d|\d+(?:\.\d+)?(?:\/\d+)?)`
const TERM = new RegExp(
  String.raw`([+-]?)(${NUMBER}|\((?:[+-]?${NUMBER})\))?@(\d+);(?:\/(\d+))?`,
  'y',
)

/** The math of an operation, reduced to `@2;->@2;-2@1;`. */
function normalizeOp(text: string): string {
  return text
    .replace(/\\(?:left|right|big|Big|bigl|bigr)(?![a-zA-Z])/g, '')
    .replace(/\\(?:,|;|:|!|quad|qquad)|~/g, '')
    .replace(/\\(?:cdot|times)(?![a-zA-Z])|\*|·/g, '')
    .replace(/\\(?:mathrm|mathbf|text)\{([Rr])\}/g, '$1')
    .replace(/[−‒–]/g, '-')
    .replace(SWAP, '<>')
    .replace(ARROW, '->')
    .replace(LEFT_ARROW, '<-')
    .replace(ROW_TOKEN, '@$1;')
    .replace(/\\[dt]?frac\{@(\d+);\}\{(\d+)\}/g, '@$1;/$2')
    .replace(/\s+/g, '')
}

function parseCoefficient(raw: string | undefined): Rational | null {
  if (!raw) return rational.of(1n)
  let text = raw
  if (text.startsWith('(')) text = text.slice(1, -1)
  let negative = false
  if (text.startsWith('+') || text.startsWith('-')) {
    negative = text[0] === '-'
    text = text.slice(1)
  }
  const value = parseRational(text)
  if (!value) return null
  return negative ? rational.mul(rational.of(-1n), value) : value
}

function parseCombination(expr: string): Array<{ row: number; coef: Rational }> | null {
  const terms: Array<{ row: number; coef: Rational }> = []
  let index = 0
  while (index < expr.length) {
    TERM.lastIndex = index
    const match = TERM.exec(expr)
    if (!match) return null
    if (!match[1] && terms.length > 0) return null
    let coef = parseCoefficient(match[2])
    if (!coef) return null
    if (match[1] === '-') coef = rational.mul(rational.of(-1n), coef)
    if (match[4]) {
      if (/^0+$/.test(match[4])) return null
      coef = rational.div(coef, rational.of(BigInt(match[4])))
    }
    const row = Number(match[3]) - 1
    if (row < 0) return null
    const same = terms.find((term) => term.row === row)
    if (same) same.coef = rational.add(same.coef, coef)
    else terms.push({ row, coef })
    index = TERM.lastIndex
  }
  return terms.length > 0 ? terms : null
}

/**
 * One operation. With `short` (an arrow label), `R_2 - 2R_1` means
 * `R_2 \to R_2 - 2R_1` and `\frac12 R_2` scales row 2.
 */
export function parseRowOp(latex: string, short = false): RowOp | null {
  const text = normalizeOp(latex)
  const swap = /^@(\d+);<>@(\d+);$/.exec(text)
  if (swap) {
    const a = Number(swap[1]) - 1
    const b = Number(swap[2]) - 1
    return a >= 0 && b >= 0 && a !== b ? { kind: 'swap', a, b, latex: latex.trim() } : null
  }
  const assign = /^@(\d+);(?:->|<-)(.+)$/.exec(text)
  if (assign) {
    const target = Number(assign[1]) - 1
    const terms = parseCombination(assign[2]!)
    return target >= 0 && terms ? { kind: 'combine', target, terms, latex: latex.trim() } : null
  }
  if (!short || /->|<-|<>/.test(text)) return null
  const terms = parseCombination(text)
  if (!terms) return null
  if (terms.length === 1 && !rational.isZero(terms[0]!.coef))
    return { kind: 'combine', target: terms[0]!.row, terms, latex: latex.trim() }
  if (rational.equal(terms[0]!.coef, rational.of(1n)))
    return { kind: 'combine', target: terms[0]!.row, terms, latex: latex.trim() }
  return null
}

/** Math that names a row operation (whether or not it can be read). */
export function looksLikeRowOp(latex: string): boolean {
  if (!/[Rr]_?\{?\d/.test(latex)) return false
  return /\\(?:long)?(?:left)?(?:right)?arrow|\\to(?![a-zA-Z])|\\gets|\\mapsto|→|←|↔|\\leftrightarrow/.test(
    latex,
  )
}

/** Several operations in one formula, separated by commas, `\quad` or words. */
export function parseRowOps(latex: string, short = false): RowOp[] | null {
  const pieces = latex
    .split(/(?<!\\),|;|，|；|\\q?quad|\\text\{[^{}]*\}|\\\\/)
    .map((piece) => piece.trim())
    .filter(Boolean)
  const ops: RowOp[] = []
  for (const piece of pieces) {
    if (!/[Rr]_?\{?\d/.test(piece)) continue
    const op = parseRowOp(piece, short)
    if (!op) return null
    ops.push(op)
  }
  return ops
}

// --- Replaying a step --------------------------------------------------------

interface Applied {
  matrix: Rational[][]
  provenance: Array<RowProvenance | undefined>
}

function inRange(op: RowOp, height: number): boolean {
  if (op.kind === 'swap') return op.a < height && op.b < height
  return op.target < height && op.terms.every((term) => term.row < height)
}

function combine(
  source: readonly (readonly Rational[])[],
  op: Extract<RowOp, { kind: 'combine' }>,
): { row: Rational[]; provenance: RowProvenance } {
  const width = source[0]!.length
  const values = op.terms.map((term) => [...source[term.row]!])
  const row = Array.from({ length: width }, (_, col) =>
    op.terms.reduce(
      (sum, term, index) => rational.add(sum, rational.mul(term.coef, values[index]![col]!)),
      rational.of(0n),
    ),
  )
  return { row, provenance: { kind: 'combine', terms: op.terms, values } }
}

/**
 * Apply a step's operations. `together`: every operation reads the matrix
 * before the step (how a line of several operations is meant); `sequence`:
 * one after the other.
 */
export function applyRowOps(
  matrix: readonly (readonly Rational[])[],
  ops: readonly RowOp[],
  mode: 'together' | 'sequence',
): Applied | null {
  if (ops.some((op) => !inRange(op, matrix.length))) return null
  let current = matrix.map((row) => [...row])
  const provenance: Array<RowProvenance | undefined> = matrix.map(() => undefined)
  if (mode === 'together') {
    const targets = new Set<number>()
    for (const op of ops) {
      for (const row of op.kind === 'swap' ? [op.a, op.b] : [op.target]) {
        if (targets.has(row)) return null
        targets.add(row)
      }
    }
    const next = current.map((row) => [...row])
    for (const op of ops) {
      if (op.kind === 'swap') {
        next[op.a] = [...matrix[op.b]!]
        next[op.b] = [...matrix[op.a]!]
        provenance[op.a] = { kind: 'swap', from: op.b }
        provenance[op.b] = { kind: 'swap', from: op.a }
      } else {
        const { row, provenance: origin } = combine(matrix, op)
        next[op.target] = row
        provenance[op.target] = origin
      }
    }
    return { matrix: next, provenance }
  }
  for (const op of ops) {
    if (op.kind === 'swap') {
      const a = current[op.a]!
      current[op.a] = current[op.b]!
      current[op.b] = a
      const pa = provenance[op.a]
      provenance[op.a] = provenance[op.b] ?? { kind: 'swap', from: op.b }
      provenance[op.b] = pa ?? { kind: 'swap', from: op.a }
    } else {
      const { row, provenance: origin } = combine(current, op)
      current = current.map((existing, index) => (index === op.target ? row : existing))
      provenance[op.target] = origin
    }
  }
  return { matrix: current, provenance }
}

function sameMatrix(a: readonly (readonly Rational[])[], b: readonly (readonly Rational[])[]) {
  return (
    a.length === b.length &&
    a.every(
      (row, r) =>
        row.length === b[r]!.length && row.every((cell, c) => rational.equal(cell, b[r]![c]!)),
    )
  )
}

/**
 * Check one step: the matrix written after it against the operations applied
 * to the matrix before it. Null when it cannot be checked fairly (other size,
 * rows changed that no operation touches, or nothing changed at all).
 */
export function checkStep(
  before: LatexMatrix,
  after: LatexMatrix,
  ops: readonly RowOp[],
): Pick<WalkthroughStep, 'computed' | 'provenance' | 'changedRows' | 'mismatches'> | null {
  if (ops.length === 0) return null
  if (before.rows.length !== after.rows.length) return null
  if (before.rows[0]!.length !== after.rows[0]!.length) return null
  if (sameMatrix(before.rows, after.rows)) return null
  const together = applyRowOps(before.rows, ops, 'together')
  const sequence = applyRowOps(before.rows, ops, 'sequence')
  const applied =
    together && sameMatrix(together.matrix, after.rows)
      ? together
      : sequence && sameMatrix(sequence.matrix, after.rows)
        ? sequence
        : (together ?? sequence)
  if (!applied) return null
  const changedRows = applied.provenance
    .map((origin, row) => (origin ? row : -1))
    .filter((row) => row >= 0)
  const mismatches: StepMismatch[] = []
  for (const [row, cells] of after.rows.entries()) {
    for (const [col, written] of cells.entries()) {
      const expected = applied.matrix[row]![col]!
      if (rational.equal(expected, written)) continue
      // A row the operations do not touch changed: the sentence probably
      // described more than the formula says. Do not claim a mistake.
      if (!changedRows.includes(row)) return null
      mismatches.push({ row, col, expected, written })
    }
  }
  return { computed: applied.matrix, provenance: applied.provenance, changedRows, mismatches }
}

// --- Per-entry arithmetic ------------------------------------------------------

const ONE = rational.of(1n)
const MINUS_ONE = rational.of(-1n)
const negative = (value: Rational) => value.n < 0n
const abs = (value: Rational) => (negative(value) ? rational.mul(MINUS_ONE, value) : value)

function latexOf(value: Rational): string {
  if (value.d === 1n) return value.n.toString()
  const sign = negative(value) ? '-' : ''
  return `${sign}\\tfrac{${negative(value) ? -value.n : value.n}}{${value.d}}`
}

function textOf(value: Rational): string {
  const sign = negative(value) ? '−' : ''
  const magnitude = abs(value)
  return `${sign}${magnitude.d === 1n ? magnitude.n.toString() : `${magnitude.n}/${magnitude.d}`}`
}

/**
 * How one entry of a changed row comes about, e.g. `1 - 3\cdot 2 - 2\cdot 0 = -5`
 * (`latex`) and `1 − 3·2 − 2·0 = −5` (`text`, for screen readers).
 */
export function entryArithmetic(
  origin: RowProvenance,
  col: number,
  result: Rational,
  rowName: (row: number) => string = (row) => `R_${row + 1}`,
): { latex: string; text: string } {
  if (origin.kind === 'swap') {
    const from = rowName(origin.from)
    return {
      latex: `${latexOf(result)}\\ (\\text{${from.replace(/_/g, '')}})`,
      text: `${textOf(result)} (${from.replace(/_/g, '')})`,
    }
  }
  const latexParts: string[] = []
  const textParts: string[] = []
  origin.terms.forEach((term, index) => {
    const value = origin.values[index]![col]!
    const wrapLatex = negative(value) ? `(${latexOf(value)})` : latexOf(value)
    const wrapText = negative(value) ? `(${textOf(value)})` : textOf(value)
    const first = index === 0
    const coefNegative = negative(term.coef)
    const magnitude = abs(term.coef)
    const unit = rational.equal(magnitude, ONE)
    const sign = first ? (coefNegative ? '-' : '') : coefNegative ? ' - ' : ' + '
    const signText = first ? (coefNegative ? '−' : '') : coefNegative ? ' − ' : ' + '
    if (unit) {
      // `1 - …`: a leading value with coefficient 1 needs no brackets.
      latexParts.push(`${sign}${first && !coefNegative ? latexOf(value) : wrapLatex}`)
      textParts.push(`${signText}${first && !coefNegative ? textOf(value) : wrapText}`)
    } else {
      latexParts.push(`${sign}${latexOf(magnitude)}\\cdot ${wrapLatex}`)
      textParts.push(`${signText}${textOf(magnitude)}·${wrapText}`)
    }
  })
  return {
    latex: `${latexParts.join('')} = ${latexOf(result)}`,
    text: `${textParts.join('')} = ${textOf(result)}`,
  }
}

/** LaTeX of one entry for a matrix cell (`\dfrac` so fractions stay readable). */
export function cellLatex(value: Rational): string {
  if (value.d === 1n) return value.n.toString()
  const sign = negative(value) ? '-' : ''
  return `${sign}\\dfrac{${negative(value) ? -value.n : value.n}}{${value.d}}`
}

export function entryText(value: Rational): string {
  return textOf(value)
}

// --- Finding steps in a section ----------------------------------------------

interface DisplayBlock {
  start: number
  end: number
  latex: string
}

const HEADING = /^\s{0,3}(#{1,6})\s/
const FENCE = /^\s*```/
const LIST_OR_QUOTE = /^\s*(?:[-*+]\s|\d+[.)]\s|>)/
const TABLE_LINE = /^\s*\|/
/** A line belonging to a display formula (or code), never part of a step's sentence. */
const DISPLAY_MARK = /\$\$|\\\[|\\\]|```/

/** A display formula that occupies whole lines from `index`. */
function displayAt(lines: readonly string[], index: number): DisplayBlock | null {
  const line = lines[index]!
  const opener = /^\s*(\$\$|\\\[)/.exec(line)
  if (!opener) return null
  const closer = opener[1] === '$$' ? '$$' : '\\]'
  const rest = line.slice(opener[0].length)
  const tail = /^[\s.,，。;；:：]*$/
  const sameLine = rest.indexOf(closer)
  if (sameLine >= 0) {
    if (!tail.test(rest.slice(sameLine + closer.length))) return null
    return { start: index, end: index, latex: rest.slice(0, sameLine) }
  }
  const parts = [rest]
  for (let next = index + 1; next < lines.length; next++) {
    const current = lines[next]!
    const at = current.indexOf(closer)
    if (at >= 0) {
      if (!tail.test(current.slice(at + closer.length))) return null
      parts.push(current.slice(0, at))
      return { start: index, end: next, latex: parts.join('\n') }
    }
    if (current.trim() === '') return null
    parts.push(current)
  }
  return null
}

const INLINE_MATH = /\\\(([\s\S]+?)\\\)|(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g

/** Row operations named in a paragraph; null when one is named but unreadable. */
function paragraphOps(text: string): { ops: RowOp[]; rest: string } | null {
  const ops: RowOp[] = []
  let rest = text
  INLINE_MATH.lastIndex = 0
  for (let match = INLINE_MATH.exec(text); match; match = INLINE_MATH.exec(text)) {
    const math = match[1] ?? match[2] ?? ''
    if (!looksLikeRowOp(math)) continue
    const parsed = parseRowOps(math)
    if (!parsed || parsed.length === 0) return null
    ops.push(...parsed)
    rest = rest.replace(match[0], '')
  }
  return { ops, rest }
}

/** Only connecting words are left once the operations are taken out. */
const FILLER =
  /^[\s,，;；:：.。、!！()（）*]*(?:(?:第?\s*[\d①-⑳]+\s*步|step\s*\d+|then|next|now|apply(?:ing)?|perform|do|we\s+get|gives?|to\s+get|and|再|然后|接着|作|做|对|进行|执行|行变换|得到|得|可得|于是|和|及|以及)[\s,，;；:：.。、!！()（）*]*)*$/i

/** Labelled arrows between the matrices of one display formula. */
function arrowLabel(between: string): { ops: RowOp[] | null; arrow: boolean } {
  const label =
    /\\xrightarrow(?:\[([^\]]*)\])?\{/.exec(between) ?? /\\(?:overset|stackrel)\{/.exec(between)
  if (label) {
    const open = label.index + label[0].length - 1
    const above = braced(between, open)
    const text = [above?.value ?? '', label[1] ?? ''].filter(Boolean).join(',')
    const ops = text ? parseRowOps(text, true) : []
    return { ops: ops && ops.length > 0 ? ops : null, arrow: true }
  }
  const plain = between
    .replace(/\\(?:left|right)[.\])|]?/g, '')
    .replace(/\\(?:,|;|:|!|quad|qquad)|[\s[\]|.]/g, '')
  if (/^(?:\\sim|\\to|\\rightarrow|\\longrightarrow|\\Rightarrow|→|~|=|\\sim\\sim)$/.test(plain))
    return { ops: [], arrow: true }
  return { ops: null, arrow: false }
}

/**
 * Split a section's Markdown into ordinary text and recognised steps. The
 * text chunks, joined, are the input minus the lines that became steps.
 */
export function splitSteps(body: string): BodyChunk[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const chunks: BodyChunk[] = []
  let buffer: string[] = []
  let last: LatexMatrix | undefined
  let number = 0
  let inFence = false
  const flush = (): void => {
    const text = buffer.join('\n')
    if (text.trim()) chunks.push({ kind: 'text', text })
    buffer = []
  }
  const pushStep = (step: Omit<WalkthroughStep, 'number'>): void => {
    number += 1
    chunks.push({ kind: 'step', step: { ...step, number } })
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (FENCE.test(line)) inFence = !inFence
    if (inFence || FENCE.test(line)) {
      buffer.push(line)
      continue
    }
    const heading = HEADING.exec(line)
    if (heading && heading[1]!.length <= 3) {
      // A new sub-part: numbering and the running matrix start again.
      last = undefined
      number = 0
    }
    const display = displayAt(lines, index)
    if (!display) {
      buffer.push(line)
      continue
    }
    const found = findMatrices(display.latex)
    const source = lines.slice(display.start, display.end + 1)
    index = display.end
    if (found.length === 0) {
      buffer.push(...source)
      continue
    }
    const matrices = found.map((item) => item.matrix)
    const readable = matrices.every(Boolean) ? (matrices as LatexMatrix[]) : null

    // The paragraph just before (blank lines allowed), if it names operations.
    let paraEnd = buffer.length - 1
    while (paraEnd >= 0 && buffer[paraEnd]!.trim() === '') paraEnd -= 1
    let paraStart = paraEnd
    while (
      paraStart > 0 &&
      buffer[paraStart - 1]!.trim() !== '' &&
      !HEADING.test(buffer[paraStart - 1]!) &&
      !TABLE_LINE.test(buffer[paraStart - 1]!) &&
      !DISPLAY_MARK.test(buffer[paraStart - 1]!)
    )
      paraStart -= 1
    const paragraphLines = paraEnd >= 0 ? buffer.slice(paraStart, paraEnd + 1) : []
    const paragraphUsable =
      paragraphLines.length > 0 &&
      !paragraphLines.some(
        (item) => HEADING.test(item) || TABLE_LINE.test(item) || DISPLAY_MARK.test(item),
      ) &&
      !LIST_OR_QUOTE.test(paragraphLines[0]!)
    const paragraph = paragraphUsable
      ? paragraphOps(paragraphLines.join('\n'))
      : { ops: [], rest: '' }

    const steps: Array<Omit<WalkthroughStep, 'number'>> = []
    let usedParagraph = false
    let ok = readable !== null && paragraph !== null
    if (ok && readable) {
      // What separates the matrices (and what comes before the first one).
      const separators = found.map((item, i) =>
        display.latex.slice(i === 0 ? 0 : found[i - 1]!.end, item.start),
      )
      const pairs: Array<{ before: LatexMatrix; after: LatexMatrix; ops: RowOp[] }> = []
      for (let i = 0; i < readable.length; i++) {
        const before = i === 0 ? last : readable[i - 1]
        if (i === 0) {
          // Only a step when the formula is just this matrix (`\sim` / arrow allowed).
          const leadText = separators[0]!.replace(/\\(?:left|right)[.[\]|]?|\s/g, '')
          const plainLead =
            leadText === '' || /^[A-Za-z]?(?:_\{?\w+\}?)?(?:'|\^\{?\w+\}?)?=$/.test(leadText)
          const lead = plainLead ? { ops: [], arrow: true } : arrowLabel(separators[0]!)
          if (!before || !lead.arrow || lead.ops === null) continue
          // The sentence's operations lead to this matrix only when it stands alone.
          const fromParagraph = lead.ops.length === 0 && readable.length === 1
          const ops = fromParagraph ? (paragraph?.ops ?? []) : lead.ops
          if (ops.length === 0) continue
          if (fromParagraph) usedParagraph = true
          pairs.push({ before, after: readable[0]!, ops })
          continue
        }
        const sep = arrowLabel(separators[i]!)
        if (!sep.arrow || sep.ops === null) {
          ok = false
          break
        }
        let ops = sep.ops
        if (ops.length === 0 && readable.length === 2 && paragraph && paragraph.ops.length > 0) {
          ops = paragraph.ops
          usedParagraph = true
        }
        if (ops.length === 0) {
          ok = false
          break
        }
        pairs.push({ before: before!, after: readable[i]!, ops })
      }
      if (ok) {
        for (const pair of pairs) {
          const checked = checkStep(pair.before, pair.after, pair.ops)
          if (!checked) {
            ok = false
            break
          }
          steps.push({ ops: pair.ops, before: pair.before, after: pair.after, ...checked })
        }
      }
    }
    last = matrices[matrices.length - 1] ?? undefined

    if (!ok || steps.length === 0) {
      buffer.push(...source)
      continue
    }
    let intro: string | undefined
    if (usedParagraph) {
      const text = paragraphLines.join('\n')
      if (!FILLER.test(paragraph!.rest)) intro = text
      buffer = buffer.slice(0, paraStart)
    }
    flush()
    steps.forEach((step, i) => pushStep(i === 0 && intro ? { ...step, intro } : step))
  }
  flush()
  return chunks
}
