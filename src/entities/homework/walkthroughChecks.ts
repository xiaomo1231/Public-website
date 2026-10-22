import {
  homogeneousKind,
  matrixToLatex,
  parseArrayLatex,
  parseMatrix,
  parseRational,
  rational,
  rref,
  sameReducedMatrix,
  solutionKind,
  type Rational,
  type SolutionKind,
} from '@/infrastructure/math/rref'
import type { LinearSystemCheck } from './walkthrough'

/**
 * One linear system as the model (or an imported walkthrough) states it.
 *
 * New shape: `coefficients` (A) + `rhs` (b, one entry per row, or the string
 * `"homogeneous"` for A x = 0). Old shape: `augmented` [A | b] — which models
 * sometimes fill with a coefficient matrix only (a linear independence test
 * α₁v₁ + α₂v₃ = 0 sent as [v₁ v₃]); `homogeneous: true` says so explicitly.
 */
export interface ClaimedLinearSystem {
  label: string
  augmented?: unknown
  coefficients?: unknown
  rhs?: unknown
  homogeneous?: boolean
  rref: unknown
  solution?: SolutionKind
}

const ZERO = rational.of(0n)

/** `"homogeneous"` → 'homogeneous'; readable entries → b; anything else (symbols, wrong length) → null. */
function readRhs(raw: unknown, rows: number): 'homogeneous' | Rational[] | null {
  if (typeof raw === 'string' && /^\s*homogeneous\s*$/i.test(raw)) return 'homogeneous'
  if (raw === 0 || raw === '0') return 'homogeneous'
  const list = Array.isArray(raw)
    ? raw.map((entry) => (Array.isArray(entry) && entry.length === 1 ? entry[0] : entry))
    : null
  if (!list || list.length !== rows) return null
  const values = list.map(parseRational)
  if (values.some((value) => value === null)) return null
  const b = values as Rational[]
  return b.every(rational.isZero) ? 'homogeneous' : b
}

/** The homogeneous system A x = 0 checked against the claimed RREF (of A or of [A | 0]). */
function homogeneousCheck(
  label: string,
  a: Rational[][],
  claimed: Rational[][],
  solution: SolutionKind | undefined,
): LinearSystemCheck | null {
  const system = a.map((row) => [...row, ZERO])
  const computed = rref(system)
  const width = claimed[0]!.length
  if (width !== system[0]!.length && width !== a[0]!.length) return null
  const rrefMatches =
    width === system[0]!.length
      ? sameReducedMatrix(computed, claimed)
      : sameReducedMatrix(rref(a), claimed)
  const computedKind = solutionKind(computed)
  return {
    label,
    rrefMatches,
    kindMatches: solution ? solution === computedKind : true,
    ...(solution ? { claimedKind: solution } : {}),
    computedKind,
    computedRref: matrixToLatex(computed),
    matrix: matrixToLatex(system),
    homogeneous: true,
  }
}

/** The system [A | b] checked against the claimed RREF of the same width. */
function augmentedCheck(
  label: string,
  system: Rational[][],
  claimed: Rational[][],
  solution: SolutionKind | undefined,
): LinearSystemCheck | null {
  if (claimed[0]!.length !== system[0]!.length) return null
  const computed = rref(system)
  const computedKind = solutionKind(computed)
  return {
    label,
    rrefMatches: sameReducedMatrix(computed, claimed),
    kindMatches: solution ? solution === computedKind : true,
    ...(solution ? { claimedKind: solution } : {}),
    computedKind,
    computedRref: matrixToLatex(computed),
    matrix: matrixToLatex(system),
  }
}

function checkOne(claim: ClaimedLinearSystem): LinearSystemCheck | null {
  const claimed = parseMatrix(claim.rref, 1)
  if (!claimed) return null
  const { label, solution } = claim

  if (claim.coefficients !== undefined) {
    const a = parseMatrix(claim.coefficients, 1)
    if (!a) return null
    const rhs = claim.homogeneous ? 'homogeneous' : readRhs(claim.rhs, a.length)
    // A symbolic or unreadable right-hand side (a spanning question's general
    // vector) is never checked: no conflict can be proved from it.
    if (!rhs) return null
    if (rhs === 'homogeneous') return homogeneousCheck(label, a, claimed, solution)
    return augmentedCheck(
      label,
      a.map((row, r) => [...row, rhs[r]!]),
      claimed,
      solution,
    )
  }

  const matrix = parseMatrix(claim.augmented, claim.homogeneous ? 1 : 2)
  if (!matrix) return null
  if (claim.homogeneous) return homogeneousCheck(label, matrix, claimed, solution)
  const check = augmentedCheck(label, matrix, claimed, solution)
  if (!check || check.kindMatches) return check
  // The old shape cannot say whether the last column is b or one more
  // unknown. When the model's own RREF, read as [A | b], does not give its
  // claim either, but the coefficient-only reading A x = 0 does (e.g. "only
  // the trivial solution" for [v₁ v₃]), the conflict is not certain, so the
  // matrix is read that way and only a wrong RREF is reported.
  if (solutionKind(claimed) !== solution && homogeneousKind(rref(matrix)) === solution) {
    return homogeneousCheck(label, matrix, claimed, solution)
  }
  return check
}

/**
 * Re-do the row reduction the model claims to have done.
 *
 * Only what can be read exactly — and read one way only — is checked: a
 * system whose matrices do not parse, whose right-hand side is symbolic, or
 * whose RREF has another width is skipped rather than reported, so the check
 * never claims a mistake it cannot prove. It verifies the model's own
 * arithmetic — from the matrix it wrote to the RREF it wrote — not whether
 * that matrix was set up correctly from the question.
 */
export function checkLinearSystems(claims: readonly ClaimedLinearSystem[]): LinearSystemCheck[] {
  const checks: LinearSystemCheck[] = []
  for (const claim of claims) {
    const check = checkOne(claim)
    if (check) checks.push(check)
  }
  return checks
}

/**
 * A check saved before `matrix` was recorded whose only conflict is the
 * solution kind, and whose claim fits the coefficient-only reading A x = 0:
 * the old checker took the last column as b, so the conflict is not certain.
 */
export function isAmbiguousLegacyCheck(check: LinearSystemCheck): boolean {
  if (check.matrix !== undefined || !check.rrefMatches || check.kindMatches) return false
  if (!check.claimedKind) return false
  const reduced = parseArrayLatex(check.computedRref)
  return reduced !== null && homogeneousKind(reduced) === check.claimedKind
}

/** The check shows a conflict worth reporting to the student. */
export function checkHasConflict(check: LinearSystemCheck): boolean {
  if (check.rrefMatches && check.kindMatches) return false
  return !isAmbiguousLegacyCheck(check)
}

/** Cues that a question involves solving a linear system by row reduction. */
export function involvesRowReduction(text: string): boolean {
  return /augmented|row[- ]?echelon|\bRREF\b|row[- ]reduc|gaussian elimination|linear (?:system|equations)|system of (?:linear )?equations|增广|行阶梯|行化简|初等行变换|线性方程组|高斯消元/i.test(
    text,
  )
}
