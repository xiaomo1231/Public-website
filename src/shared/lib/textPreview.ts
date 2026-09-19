/**
 * Preview-length helpers for source text.
 *
 * Truncation happens on the string, not with CSS `max-height`, so the full
 * text always stays reachable through an explicit expand action.
 */

/** Sentence-ish boundaries we are willing to cut on, longest-match first. */
const BOUNDARIES = ['. ', '。', '！', '？', '! ', '? ', '\n']

export interface CollapsedText {
  shown: string
  truncated: boolean
}

/**
 * Shorten `text` to roughly `maxChars`, preferring to stop at a sentence
 * boundary so the preview still reads as complete sentences.
 */
export function collapseText(text: string, maxChars: number): CollapsedText {
  const value = text ?? ''
  if (maxChars <= 0 || value.length <= maxChars) return { shown: value, truncated: false }

  const window = value.slice(0, maxChars)
  const boundary = BOUNDARIES.reduce((best, token) => {
    const at = window.lastIndexOf(token)
    return at > best ? at + token.length : best
  }, -1)

  // Only honour the boundary when it does not throw away most of the budget.
  const cut = boundary > maxChars * 0.5 ? boundary : maxChars
  return { shown: value.slice(0, cut).trimEnd(), truncated: true }
}
