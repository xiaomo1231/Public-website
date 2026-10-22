import type { HomeworkAnswerCheck } from '@/entities/homework/answerCheck'
import type { MockExamQuestionResult } from './types'

/**
 * Platform estimates for a mock exam. Every number here is an estimate made by
 * the platform (a local check or an AI reading against the reference answer);
 * it is never presented as the teacher's marks. The professor's own marking
 * scheme, when the answer key states one, is shown separately and verbatim.
 */

/** Share of a question judged right; `undefined` when the check could not decide. */
export function checkFraction(
  check: Pick<HomeworkAnswerCheck, 'verdict' | 'similarityPercent'>,
): number | undefined {
  switch (check.verdict) {
    case 'correct':
      return 1
    case 'incorrect':
      return 0
    case 'partial': {
      const percent = check.similarityPercent
      return typeof percent === 'number' && Number.isFinite(percent)
        ? Math.min(0.99, Math.max(0.01, percent / 100))
        : 0.5
    }
    default:
      return undefined
  }
}

/** Round to half marks (how papers are usually marked). */
export function roundMarks(value: number): number {
  return Math.round(value * 2) / 2
}

export function resultFromCheck(
  questionId: string,
  marks: number | undefined,
  check: Pick<HomeworkAnswerCheck, 'verdict' | 'similarityPercent' | 'method' | 'feedback'>,
): MockExamQuestionResult {
  const fraction = checkFraction(check)
  if (fraction === undefined)
    return {
      questionId,
      status: 'uncertain',
      method: check.method,
      ...(marks !== undefined ? { marks } : {}),
      note: check.feedback,
    }
  return {
    questionId,
    status: 'checked',
    verdict: check.verdict,
    method: check.method,
    fraction,
    ...(marks !== undefined ? { marks, estimatedMarks: roundMarks(marks * fraction) } : {}),
    note: check.feedback,
  }
}

export interface MockExamScore {
  /** Questions with a verdict. */
  checked: number
  /** Questions whose answer is blank. */
  unanswered: number
  /** Questions that could not be decided / failed. */
  undecided: number
  /** Share right over decided + blank questions (0–1); null when none. */
  fraction: number | null
  /**
   * Marks: only when every question states its marks. `estimated` is the
   * platform's estimate (blank = 0; undecided questions are left out of both
   * numbers and reported separately).
   */
  marks?: { estimated: number; available: number; undecidedMarks: number }
  /** Some verdicts came from an AI reading: the total is an estimate. */
  aiChecked: boolean
}

export function scoreMockExam(results: readonly MockExamQuestionResult[]): MockExamScore {
  const decided = results.filter((item) => item.status === 'checked')
  const blank = results.filter((item) => item.status === 'unanswered')
  const undecided = results.length - decided.length - blank.length
  const counted = decided.length + blank.length
  const fraction =
    counted > 0 ? decided.reduce((sum, item) => sum + (item.fraction ?? 0), 0) / counted : null
  const allMarked = results.length > 0 && results.every((item) => item.marks !== undefined)
  const marks = allMarked
    ? {
        estimated: roundMarks(decided.reduce((sum, item) => sum + (item.estimatedMarks ?? 0), 0)),
        available: results
          .filter((item) => item.status === 'checked' || item.status === 'unanswered')
          .reduce((sum, item) => sum + (item.marks ?? 0), 0),
        undecidedMarks: results
          .filter((item) => item.status === 'uncertain' || item.status === 'failed')
          .reduce((sum, item) => sum + (item.marks ?? 0), 0),
      }
    : undefined
  return {
    checked: decided.length,
    unanswered: blank.length,
    undecided,
    fraction,
    ...(marks ? { marks } : {}),
    aiChecked: decided.some((item) => item.method === 'ai'),
  }
}
