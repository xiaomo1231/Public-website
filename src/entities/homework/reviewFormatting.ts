/**
 * Some providers return a literal `\n-` inside a JSON string after parsing.
 * Repair only clear Markdown structure so LaTeX commands such as `\neq` and
 * `\nabla` remain untouched. Also runs when reading older cached reviews.
 */
export function formatHomeworkReviewText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/(?:\\r\\n|\\n){2,}/g, '\n\n')
    .replace(/\\r\\n(?=[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+))/g, '\n')
    .replace(/\\n(?=[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+))/g, '\n')
}
