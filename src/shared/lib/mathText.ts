/**
 * Splitting extracted course text into prose and LaTeX spans.
 *
 * Kept separate from the React component so the parsing rules can be tested
 * (and reasoned about) without rendering.
 */

export type MathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display: boolean }

/**
 * `$$…$$` and `\[…\]` are display math; `$…$` and `\(…\)` are inline.
 * The inline `$` form requires non-space content and no newline so that prose
 * containing a currency sign is not swallowed.
 */
const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(\S[^$\n]*?)\$/g

export function splitMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = []
  let lastIndex = 0
  MATH_PATTERN.lastIndex = 0

  for (let match = MATH_PATTERN.exec(text); match; match = MATH_PATTERN.exec(text)) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, match.index) })
    }
    const display = match[1] !== undefined || match[2] !== undefined
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
    segments.push({ kind: 'math', value: value.trim(), display })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) })
  }
  return segments
}

/**
 * Split text into paragraphs on blank lines. Course parsers emit plain text,
 * so this is the only structure we infer — we do not invent headings or lists.
 */
export function splitParagraphs(text: string): string[] {
  return (text ?? '')
    .split(/\n\s*\n+/)
    .map((block) => block.replace(/\s+$/, ''))
    .filter((block) => block.trim().length > 0)
}
