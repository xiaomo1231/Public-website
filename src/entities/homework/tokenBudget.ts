/**
 * Per-request output budgets for the homework AI calls.
 *
 * The user's "Max tokens" setting is an *upper bound*, not a per-request
 * target. Sending it verbatim meant every small analyzer batch asked for 32k
 * output tokens: many providers reject a `max_tokens` above their model's cap
 * (OpenAI, DeepSeek, …), and even when accepted it is far more than a small
 * batch can use. Instead each request gets a budget derived from its own input
 * size and expected output, clamped to a provider-friendly ceiling and to the
 * user's setting.
 *
 * These are pure functions so the budgets are testable on their own.
 */

/** Upper bound for one analyzer batch request, regardless of the setting. */
export const ANALYZER_OUTPUT_CEILING = 8_192

/** Upper bound for one hints+solution request, regardless of the setting. */
export const QUESTION_OUTPUT_CEILING = 4_096

/** Never ask for less than this (unless the user's own cap is lower). */
export const MIN_OUTPUT_TOKENS = 512

/** Rough output/input ratio; extraction output is a subset of the passage text. */
const OUTPUT_TOKENS_PER_INPUT_CHAR = 0.6

export interface OutputBudgetParams {
  /** Characters of prompt content sent to the model. */
  inputChars: number
  /** The user's configured cap (`AIService.maxOutputTokens`). */
  userMaxTokens: number
  /** Hard ceiling for this request kind. */
  ceiling: number
  /** Fixed room for JSON scaffolding and structure. */
  overhead: number
  min?: number
}

/**
 * Estimate a safe output budget: proportional to the input, never above the
 * request kind's ceiling, never above the user's setting, and never below the
 * minimum (floored to the user's own cap when that is smaller).
 */
export function planOutputBudget({
  inputChars,
  userMaxTokens,
  ceiling,
  overhead,
  min = MIN_OUTPUT_TOKENS,
}: OutputBudgetParams): number {
  // A missing / invalid setting must never produce NaN; treat it as "no extra
  // cap" and rely on the request kind's own ceiling.
  const userCap = Number.isFinite(userMaxTokens) && userMaxTokens > 0 ? userMaxTokens : Infinity
  const estimate = Math.ceil(Math.max(0, inputChars) * OUTPUT_TOKENS_PER_INPUT_CHAR) + overhead
  const bounded = Math.min(estimate, ceiling)
  const capped = Math.min(bounded, userCap)
  return Math.max(capped, Math.min(min, userCap))
}

/** Budget for one homework-analyzer batch given its prompt size. */
export function planAnalyzerOutputBudget(inputChars: number, userMaxTokens: number): number {
  return planOutputBudget({
    inputChars,
    userMaxTokens,
    ceiling: ANALYZER_OUTPUT_CEILING,
    overhead: 512,
  })
}

/** Budget for one per-question hints+solution request given its prompt size. */
export function planQuestionOutputBudget(inputChars: number, userMaxTokens: number): number {
  return planOutputBudget({
    inputChars,
    userMaxTokens,
    ceiling: QUESTION_OUTPUT_CEILING,
    overhead: 800,
  })
}
