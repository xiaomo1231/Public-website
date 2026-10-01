/**
 * Restore the reading structure of older homework prompts whose PDF subparts
 * were flattened into one paragraph. This only inserts breaks and typesets an
 * unambiguous real-space symbol; it never changes the question's values.
 */
export function formatHomeworkQuestion(prompt: string): string {
  return prompt
    .replace(/\r\n?/g, '\n')
    // pdf.js can emit the combining arrow before its base in legacy saved
    // questions. Render only an adjacent single-letter vector as LaTeX.
    .replace(/\u20d7[ \t]*([A-Za-z])|([A-Za-z])\u20d7/g, (_match, after: string | undefined, before: string | undefined) =>
      `$\\vec{${after ?? before}}$`)
    // Older cached citations split the dimension of a real vector space onto
    // the next line. Restrict the repair to explicit membership/subset or
    // English "of/in R" context; unrelated numbered lines stay untouched.
    .replace(/((?:\b(?:of|in)\s+|[⊆∈]\s*)R)\s*\n\s*([1-9])(?=\s|[.,;:]|$)/g,
      (_match, base: string, digit: string) => `${base}${'⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]}`)
    .replace(/\s+(?=\([a-z]\)\s+)/gi, '\n\n')
    .replace(/(?:ℝ|\bR)(?:\^\{?([0-9]+)\}?|([⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g, (match, ascii: string | undefined, raised: string | undefined) => {
      const digits = raised?.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit)))
      return `$\\mathbb{R}^{${ascii ?? digits ?? match}}$`
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
