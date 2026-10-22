import type { TranslationKey } from '@/i18n/types'
import { isReferenceOnlyMaterial } from '@/entities/document/types'

/**
 * How a question / document is used to evaluate the site (检验网站):
 *
 * - `regression`  — known parsing-error fragments kept to check that a fix
 *   holds. They stay ordinary course material otherwise.
 * - `development` — may be looked at freely (answers, walkthroughs) and used
 *   to tune prompts and rules. A set already used for debugging belongs here.
 * - `independent` — never used for tuning; run only once the rules are fixed.
 *   This is the held-out role: an independent item is excluded from every AI
 *   context (course analysis, tutor, quizzes, practice sets, variants,
 *   walkthroughs of other questions, habits, vocabulary).
 *
 * Absent means an ordinary item with no evaluation role.
 */
export type EvalRole = 'regression' | 'development' | 'independent'

export const EVAL_ROLES: readonly EvalRole[] = ['regression', 'development', 'independent']

export const EVAL_ROLE_LABEL_KEYS: Record<EvalRole, TranslationKey> = {
  regression: 'evalRole.regression',
  development: 'evalRole.development',
  independent: 'evalRole.independent',
}

export const EVAL_ROLE_HINT_KEYS: Record<EvalRole, TranslationKey> = {
  regression: 'evalRole.regressionHint',
  development: 'evalRole.developmentHint',
  independent: 'evalRole.independentHint',
}

export function resolveEvalRole(value: unknown): EvalRole | undefined {
  return typeof value === 'string' && (EVAL_ROLES as readonly string[]).includes(value)
    ? (value as EvalRole)
    : undefined
}

/** Anything that may carry an evaluation role (document, chunk, set, question). */
export interface EvalRoleCarrier {
  evalRole?: EvalRole | undefined
}

/**
 * THE held-out predicate: true when any of the given items (a question, its
 * set, its document, a chunk) is reserved for independent evaluation.
 */
export function isHeldOut(...items: ReadonlyArray<EvalRoleCarrier | null | undefined>): boolean {
  return items.some((item) => resolveEvalRole(item?.evalRole) === 'independent')
}

/**
 * A document or chunk that must never reach the AI as course context:
 * reference-only material (answer keys, syllabi, imported walkthroughs, past
 * exams) and anything held out for independent evaluation.
 */
export function isExcludedFromCourseContext(
  item: { materialType?: unknown; evalRole?: unknown } | null | undefined,
): boolean {
  if (!item) return false
  return (
    isReferenceOnlyMaterial(item.materialType) || resolveEvalRole(item.evalRole) === 'independent'
  )
}

/** The role a question has: its own, else its set's. */
export function effectiveEvalRole(
  question: EvalRoleCarrier,
  set?: EvalRoleCarrier | null,
): EvalRole | undefined {
  return resolveEvalRole(question.evalRole) ?? resolveEvalRole(set?.evalRole)
}

/** The questions held out for independent evaluation (done only in 自测). */
export function heldOutQuestions<T extends EvalRoleCarrier & { retired?: boolean }>(
  set: EvalRoleCarrier | null | undefined,
  questions: readonly T[],
): T[] {
  return questions.filter(
    (question) => !question.retired && effectiveEvalRole(question, set) === 'independent',
  )
}

/**
 * Signs that a question has already been looked at with help (hints, the
 * solution, the AI chat, a review, guided steps, an answer check, a
 * walkthrough section). Such a question is a development case: it cannot be
 * an independent test any more.
 */
export function usedForTuning(
  question: {
    revealedHints?: number
    solutionRevealed?: boolean
    messages?: readonly unknown[]
    reviewGuide?: unknown
    guidedProgress?: unknown
    answerCheck?: unknown
  },
  extra: { hasWalkthroughSection?: boolean; evaluatedWithAnswer?: boolean } = {},
): boolean {
  return Boolean(
    (question.revealedHints ?? 0) > 0 ||
    question.solutionRevealed ||
    (question.messages?.length ?? 0) > 0 ||
    question.reviewGuide ||
    question.guidedProgress ||
    question.answerCheck ||
    extra.hasWalkthroughSection ||
    extra.evaluatedWithAnswer,
  )
}
