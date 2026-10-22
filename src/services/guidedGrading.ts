/**
 * Grading of 引导练习 blanks, always local: each blank kind uses the grader
 * the rest of the app uses for that kind of answer.
 *
 *   expression → `compareMath` (symbolic / sampled equivalence)
 *   number     → `numericEquivalent` (relative tolerance, default 1%)
 *   quantity   → `compareQuantity` (value + unit, 1%, any unit of the same dimension)
 *   chemistry  → `compareEquations` (species, conservation, proportional coefficients)
 *   text       → `blankAccepted` (accepted answers; width / case / punctuation ignored)
 *   exact      → program-output comparison (line endings / trailing spaces only)
 *
 * `unverified` means the grader could not decide (the reference itself could
 * not be read); it is never counted wrong. A student answer that cannot be
 * read while the reference can is `wrong` with reason `unreadable` — otherwise
 * typing anything unparsable would pass the step.
 */
import {
  compareMath,
  numericEquivalent,
  previewExpression,
} from '@/infrastructure/math/expressionEvaluator'
import { compareQuantity, splitQuantity } from '@/infrastructure/math/quantityAnswer'
import { compareEquations, parseEquation } from '@/infrastructure/chemistry/equation'
import type { GuidedBlank } from '@/entities/homework/guided'
import { blankAccepted, normalizeProgramOutput } from './answerEvaluationService'

export type BlankVerdict = 'empty' | 'correct' | 'wrong' | 'unverified'

/** Why a non-correct answer was judged so (for a specific message). */
export type BlankReason =
  'missing-unit' | 'wrong-dimension' | 'unbalanced' | 'species' | 'coefficients' | 'unreadable'

export interface BlankGrade {
  verdict: BlankVerdict
  reason?: BlankReason
}

export function gradeBlank(blank: GuidedBlank, given: string): BlankGrade {
  const answer = given.trim()
  if (!answer) return { verdict: 'empty' }
  switch (blank.kind) {
    case 'expression': {
      const result = compareMath(answer, blank.answer).equivalent
      if (result !== null) return { verdict: result ? 'correct' : 'wrong' }
      return readableMath(blank.answer) && !readableMath(answer)
        ? { verdict: 'wrong', reason: 'unreadable' }
        : { verdict: 'unverified' }
    }
    case 'number': {
      const result = numericEquivalent(answer, blank.answer, blank.tolerance ?? 1e-2)
      if (result !== null) return { verdict: result ? 'correct' : 'wrong' }
      return readableNumber(blank.answer) && !readableNumber(answer)
        ? { verdict: 'wrong', reason: 'unreadable' }
        : { verdict: 'unverified', reason: 'unreadable' }
    }
    case 'quantity': {
      const reference = splitQuantity(blank.answer)
      if (!reference || !reference.unitText) {
        const result = numericEquivalent(answer, blank.answer)
        if (result !== null) return { verdict: result ? 'correct' : 'wrong' }
        return readableNumber(blank.answer) && !readableNumber(answer)
          ? { verdict: 'wrong', reason: 'unreadable' }
          : { verdict: 'unverified' }
      }
      const result = compareQuantity(answer, String(reference.value), reference.unitText)
      if (result.isCorrect === null)
        return splitQuantity(answer) === null && !readableNumber(answer)
          ? { verdict: 'wrong', reason: 'unreadable' }
          : { verdict: 'unverified', reason: 'unreadable' }
      if (result.isCorrect) return { verdict: 'correct' }
      if (result.outcome === 'missing-unit') return { verdict: 'wrong', reason: 'missing-unit' }
      if (result.outcome === 'wrong-dimension')
        return { verdict: 'wrong', reason: 'wrong-dimension' }
      return { verdict: 'wrong' }
    }
    case 'chemistry': {
      const reference = parseEquation(blank.answer)
      if (!reference.ok) {
        // Not an equation (a formula, a name): compare as an accepted answer.
        return { verdict: blankAccepted(answer, [blank.answer]) ? 'correct' : 'wrong' }
      }
      const result = compareEquations(answer, reference.equation)
      switch (result.verdict) {
        case 'correct':
          return { verdict: 'correct' }
        case 'unreadable':
          // The reference parses (above), so it is the student's text.
          return parseEquation(answer).ok
            ? { verdict: 'unverified', reason: 'unreadable' }
            : { verdict: 'wrong', reason: 'unreadable' }
        case 'isomers':
          return { verdict: 'unverified', reason: 'unreadable' }
        case 'unbalanced':
          return { verdict: 'wrong', reason: 'unbalanced' }
        case 'species':
          return { verdict: 'wrong', reason: 'species' }
        default:
          return { verdict: 'wrong', reason: 'coefficients' }
      }
    }
    case 'exact':
      return {
        verdict:
          normalizeProgramOutput(answer) === normalizeProgramOutput(blank.answer)
            ? 'correct'
            : 'wrong',
      }
    default:
      return {
        verdict: blankAccepted(answer, [blank.answer, ...(blank.accepted ?? [])])
          ? 'correct'
          : 'wrong',
      }
  }
}

/** The text parses as a number (compared with itself). */
function readableNumber(text: string): boolean {
  return numericEquivalent(text, text) !== null
}

/** The text parses as a math expression (exactly as the grader reads it). */
function readableMath(text: string): boolean {
  return previewExpression(text).status === 'ok'
}

/** A step is complete when no blank is wrong or empty (undecidable ones pass). */
export function stepComplete(grades: readonly BlankGrade[]): boolean {
  return grades.every((grade) => grade.verdict === 'correct' || grade.verdict === 'unverified')
}
