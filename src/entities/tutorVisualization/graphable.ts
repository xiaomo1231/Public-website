import { splitMathSegments } from '@/shared/lib/mathText'

/**
 * A cheap, deterministic gate that decides whether a lesson is worth a second
 * AI call for a 2D graph.
 *
 * Visualizations are optional: most lessons (set theory, proofs, definitions)
 * have nothing to plot. Calling the model for every lesson would spend tokens
 * for a guaranteed empty answer, so this local check runs first. It is
 * deliberately permissive — a false positive only costs one small JSON call,
 * while a false negative merely means no graph.
 */

/** Lowercase `x` or `y` as a standalone variable, not part of a word. */
const VARIABLE = /(?<![A-Za-z])[xy](?![A-Za-z])/
/** A relation, either literal (`= < >`) or as LaTeX (`\le \ge \lt \gt`). */
const RELATION = /[=<>]|\\(?:l|g)(?:e|eq|t)(?![a-zA-Z])/
/**
 * A function-of-x form that may warrant a nonlinear graph (Phase 2): a named
 * function, a power of x, or a power of e. Deliberately permissive — the gate
 * only decides whether a second AI call is worth making; the local parser and
 * normaliser make the real decision.
 */
const FUNCTION_HINT =
  /\\(?:sin|cos|tan|exp|ln|log|sqrt)|(?<![A-Za-z])(?:sin|cos|exp|ln|log|sqrt)\s*\(|(?<![A-Za-z])x\s*(?:\^|²)|(?<![A-Za-z])e\s*\^/
const COORDINATE_PAIR = /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g

export function hasGraphableMath(markdown: string): boolean {
  if (!markdown) return false

  for (const segment of splitMathSegments(markdown)) {
    if (segment.kind !== 'math') continue
    if (RELATION.test(segment.value) && VARIABLE.test(segment.value)) return true
    if (FUNCTION_HINT.test(segment.value) && VARIABLE.test(segment.value)) return true
  }

  const pairs = markdown.match(COORDINATE_PAIR)
  return pairs !== null && pairs.length >= 2
}
