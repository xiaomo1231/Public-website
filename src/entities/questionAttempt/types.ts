import type { TranslationKey } from '@/i18n/types'

export type EvaluationMethod =
  | 'exact'
  | 'case_insensitive'
  | 'numeric'
  | 'numeric_tolerance'
  | 'math_equivalent'
  | 'unit_conversion'
  | 'exact_output'
  | 'rubric_ai'
  | 'chem_equation'
  | 'order_match'
  | 'multi_select'
  | 'match_items'
  | 'blank_match'
  | 'option_id'
  | 'ai'
  | 'unverified'

export const EVAL_METHOD_LABEL_KEYS: Record<EvaluationMethod, TranslationKey> = {
  exact: 'evalMethod.exact',
  case_insensitive: 'evalMethod.case_insensitive',
  numeric: 'evalMethod.numeric',
  numeric_tolerance: 'evalMethod.numeric_tolerance',
  math_equivalent: 'evalMethod.math_equivalent',
  unit_conversion: 'evalMethod.unit_conversion',
  exact_output: 'evalMethod.exact_output',
  rubric_ai: 'evalMethod.rubric_ai',
  chem_equation: 'evalMethod.chem_equation',
  order_match: 'evalMethod.order_match',
  multi_select: 'evalMethod.multi_select',
  match_items: 'evalMethod.match_items',
  blank_match: 'evalMethod.blank_match',
  option_id: 'evalMethod.option_id',
  ai: 'evalMethod.ai',
  unverified: 'evalMethod.unverified',
}

export interface QuestionEvaluation {
  /** null when the answer could not be verified automatically. */
  isCorrect: boolean | null
  method: EvaluationMethod
  /** 0–1 confidence in the verdict. */
  confidence: number
  expected?: string
  normalizedUser?: string
  normalizedExpected?: string
  explanation?: string
  /** Human-readable note, e.g. "Unable to verify automatically". */
  note?: string
  /**
   * Partial credit (short answer): scoring points covered out of the total.
   * The question counts as `earned / total` of a question in the quiz score;
   * `isCorrect` is true only for full coverage.
   */
  score?: { earned: number; total: number }
  /** Short answer: the per-point result, with the student's own words as evidence. */
  rubric?: RubricPointResult[]
  /** Short answer: statements in the answer that contradict the reference. */
  contradictions?: string[]
  /** Fill-blank: each blank's answer, whether it was accepted, and how. */
  blanks?: BlankResult[]
  /**
   * The student disputed this AI judgement. A disputed answer is kept for
   * reference but excluded from the score, the mistake book and mastery.
   */
  disputed?: boolean
}

export interface BlankResult {
  given: string
  accepted: string[]
  correct: boolean
  /** Accepted by the AI as an equivalent term (not in the accepted list). */
  byAi?: boolean
}

export interface RubricPointResult {
  pointId: string
  text: string
  covered: boolean
  /** Verbatim excerpt of the student's answer; verified locally. */
  evidence?: string
}

export interface QuestionAttempt {
  id: string
  projectId: string
  questionId: string
  quizId?: string
  topicId?: string
  knowledgePoint: string
  questionType: string
  difficulty: string
  userAnswer: string
  evaluation: QuestionEvaluation
  durationMs?: number
  hintsUsed: number
  createdAt: number
}