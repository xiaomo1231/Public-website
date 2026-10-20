import {
  matrixToLatex,
  parseMatrix,
  rref,
  sameReducedMatrix,
  solutionKind,
} from '@/infrastructure/math/rref'
import type { LinearSystemCheck } from './walkthrough'

export interface ClaimedLinearSystem {
  label: string
  augmented: unknown
  rref: unknown
  solution?: 'none' | 'unique' | 'infinite'
}

/**
 * Re-do the row reduction the model claims to have done.
 *
 * Only what can be read exactly is checked: a system whose matrices do not
 * parse (or do not have the same width) is skipped rather than reported, so
 * the check never claims a mistake it cannot prove. It verifies the model's
 * own arithmetic — from the augmented matrix it wrote to the RREF it wrote —
 * not whether that augmented matrix was set up correctly from the question.
 */
export function checkLinearSystems(claims: readonly ClaimedLinearSystem[]): LinearSystemCheck[] {
  const checks: LinearSystemCheck[] = []
  for (const claim of claims) {
    const augmented = parseMatrix(claim.augmented)
    const claimed = parseMatrix(claim.rref)
    if (!augmented || !claimed) continue
    if (claimed[0]!.length !== augmented[0]!.length) continue
    const computed = rref(augmented)
    const computedKind = solutionKind(computed)
    checks.push({
      label: claim.label,
      rrefMatches: sameReducedMatrix(computed, claimed),
      kindMatches: claim.solution ? claim.solution === computedKind : true,
      ...(claim.solution ? { claimedKind: claim.solution } : {}),
      computedKind,
      computedRref: matrixToLatex(computed),
    })
  }
  return checks
}

/** Cues that a question involves solving a linear system by row reduction. */
export function involvesRowReduction(text: string): boolean {
  return /augmented|row[- ]?echelon|\bRREF\b|row[- ]reduc|gaussian elimination|linear (?:system|equations)|system of (?:linear )?equations|增广|行阶梯|行化简|初等行变换|线性方程组|高斯消元/i.test(text)
}
