/**
 * A numeric answer is judged on three separate dimensions — the VALUE, the
 * UNIT and the SIGNIFICANT FIGURES — and the feedback names exactly which one
 * is off. How a significant-figure slip counts is never decided silently by
 * the platform: it is the course's rule (`Project.sigFigPolicy`), shown with
 * its source next to every result.
 *
 *   hint   仅提示，不扣分 (default): the answer counts as correct; the slip is
 *          still recorded in the mistake book (tag `sigfig`) for follow-up.
 *   deduct 扣一定比例: the answer earns (100 − percent)% of the question.
 *
 * `source` says who set the rule: `professor` (教授规则, entered from the
 * professor's rubric) or `platform` (平台拟定规则, the platform's default).
 */
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'

/** Why a question requires its number of significant figures. */
export type SigFigBasis =
  /** The question itself asks for it ("to 3 significant figures"). */
  | 'stated'
  /** Implied by the precision of the data the question gives. */
  | 'data'
  /** The professor's habit (题目习惯档案 / course rule). */
  | 'professor'

export const SIG_FIG_BASES: readonly SigFigBasis[] = ['stated', 'data', 'professor']

export type SigFigRuleMode = 'hint' | 'deduct'
export type GradingRuleSource = 'professor' | 'platform'

export interface SigFigPolicy {
  mode: SigFigRuleMode
  /** `deduct` only: the share of the question deducted, 1–100. */
  percent?: number
  source: GradingRuleSource
}

export const DEFAULT_SIG_FIG_POLICY: SigFigPolicy = { mode: 'hint', source: 'platform' }

/** A stored / typed policy made safe: unknown values fall back to the default. */
export function normalizeSigFigPolicy(value: unknown): SigFigPolicy {
  if (!value || typeof value !== 'object') return DEFAULT_SIG_FIG_POLICY
  const raw = value as Partial<SigFigPolicy>
  const source: GradingRuleSource = raw.source === 'professor' ? 'professor' : 'platform'
  if (raw.mode === 'deduct') {
    const percent = Math.round(Number(raw.percent))
    if (Number.isFinite(percent) && percent >= 1 && percent <= 100)
      return { mode: 'deduct', percent, source }
  }
  return { mode: 'hint', source }
}

export type ValueStatus = 'correct' | 'wrong' | 'unreadable'

export type UnitStatus =
  /** The expected unit, or an equivalent one that converts to the right value. */
  | 'correct'
  /** A bare number where a unit is required. */
  | 'missing'
  /** A unit of another kind of quantity (N for an energy). */
  | 'wrong-dimension'
  /** The right number in a convertible but wrong unit (9.8 cm/s² for 9.8 m/s²). */
  | 'wrong-unit'
  /** The unit text could not be read. */
  | 'unreadable'

export type SigFigDimensionStatus = 'correct' | 'too-many' | 'too-few' | 'unreadable'

export interface AnswerDimensions {
  value: ValueStatus
  /** Present when the question has a unit. */
  unit?: {
    status: UnitStatus
    /** The unit the answer is expected in. */
    expected: string
    /** The unit the student wrote (normalised), when one was read. */
    given?: string
    /** The student's unit differs from `expected` and was converted. */
    converted?: boolean
  }
  /** Present when the question requires a number of significant figures. */
  sigFigs?: {
    status: SigFigDimensionStatus
    required: number
    /** What the answer shows: a range when trailing zeros are ambiguous (1500 → 2–4). */
    given?: { min: number; max: number }
    /** Accepted only because trailing zeros of an integer are ambiguous. */
    ambiguous?: boolean
    basis?: SigFigBasis
  }
}

/** The course rule that was applied to a significant-figure slip, shown with the result. */
export interface SigFigRuleApplied {
  mode: SigFigRuleMode
  percent?: number
  source: GradingRuleSource
  /** Whether credit was actually deducted for this answer. */
  deducted: boolean
}

/** The answer's significant figures were checked and are off. */
export function hasSigFigIssue(evaluation: Pick<QuestionEvaluation, 'dimensions'>): boolean {
  const status = evaluation.dimensions?.sigFigs?.status
  return status === 'too-many' || status === 'too-few'
}

/**
 * Value and unit are right; only the significant figures are off. This is
 * the case the mistake book records even when the course rule deducts
 * nothing, and the case a follow-up question can target ("practise sig figs").
 */
export function isSigFigOnlyError(
  evaluation: Pick<QuestionEvaluation, 'dimensions' | 'disputed'>,
): boolean {
  const dimensions = evaluation.dimensions
  if (!dimensions || evaluation.disputed) return false
  return (
    hasSigFigIssue(evaluation) &&
    dimensions.value === 'correct' &&
    (!dimensions.unit || dimensions.unit.status === 'correct')
  )
}

/** Machine-readable mistake tags for an evaluated numeric answer. */
export type AnswerIssueTag = 'value' | 'unit' | 'sigfig'

export function answerIssueTags(
  evaluation: Pick<QuestionEvaluation, 'dimensions'>,
): AnswerIssueTag[] {
  const dimensions = evaluation.dimensions
  if (!dimensions) return []
  const tags: AnswerIssueTag[] = []
  if (dimensions.value === 'wrong') tags.push('value')
  if (
    dimensions.unit &&
    dimensions.unit.status !== 'correct' &&
    dimensions.unit.status !== 'unreadable'
  )
    tags.push('unit')
  if (hasSigFigIssue(evaluation)) tags.push('sigfig')
  return tags
}

/**
 * Credit for an answer whose value and unit are right but whose significant
 * figures are off, under the course rule: 1 for `hint`, 1 − percent/100 for
 * `deduct`.
 */
export function sigFigCredit(policy: SigFigPolicy): number {
  return policy.mode === 'deduct' ? Math.max(0, 1 - (policy.percent ?? 0) / 100) : 1
}
