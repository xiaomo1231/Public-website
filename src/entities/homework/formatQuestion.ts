/**
 * Restore the reading structure of older homework prompts whose PDF subparts
 * were flattened into one paragraph. This only inserts breaks and typesets an
 * unambiguous real-space symbol; it never changes the question's values.
 */
export function formatHomeworkQuestion(prompt: string): string {
  return (
    prompt
      .replace(/\r\n?/g, '\n')
      // pdf.js can emit the combining arrow before its base in legacy saved
      // questions. Render only an adjacent single-letter vector as LaTeX.
      // A subscript right after the vector joins it (v\u20d7\u2081 \u2192 \vec{v}_{1}), and a
      // word glued to the vector by a lost PDF space gets the space back.
      .replace(
        /\u20d7[ \t]*([A-Za-z])([\u2080-\u2089]*)|([A-Za-z])\u20d7([\u2080-\u2089]*)/g,
        (
          _match,
          after: string | undefined,
          afterSub: string | undefined,
          before: string | undefined,
          beforeSub: string | undefined,
          offset: number,
          whole: string,
        ) => {
          const sub = (after ? afterSub : beforeSub) ?? ''
          const digits = [...sub]
            .map((d) =>
              String('\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'.indexOf(d)),
            )
            .join('')
          const space = /[A-Za-z]/.test(whole[offset - 1] ?? '') ? ' ' : ''
          return `${space}$\\vec{${after ?? before}}${digits ? `_{${digits}}` : ''}$`
        },
      )
      // Older cached citations split the dimension of a real vector space onto
      // the next line. Restrict the repair to explicit membership/subset or
      // English "of/in R" context; unrelated numbered lines stay untouched.
      .replace(
        /((?:\b(?:of|in)\s+|[⊆∈]\s*)R)\s*\n\s*([1-9])(?=\s|[.,;:]|$)/g,
        (_match, base: string, digit: string) => `${base}${'⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]}`,
      )
      .replace(/\s+(?=\([a-z]\)\s+)/gi, '\n\n')
      .replace(
        /(?:ℝ|\bR)(?:\^\{?([0-9]+)\}?|([⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g,
        (match, ascii: string | undefined, raised: string | undefined) => {
          const digits = raised?.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) =>
            String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit)),
          )
          return `$\\mathbb{R}^{${ascii ?? digits ?? match}}$`
        },
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
