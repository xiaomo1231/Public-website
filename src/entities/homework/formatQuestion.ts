/**
 * Restore the reading structure of older homework prompts whose PDF subparts
 * were flattened into one paragraph. This only inserts breaks and typesets an
 * unambiguous real-space symbol; it never changes the question's values.
 */
export function formatHomeworkQuestion(prompt: string): string {
  return prompt
    .replace(/\r\n?/g, '\n')
    .replace(/\s+(?=\([a-z]\)\s+)/gi, '\n\n')
    .replace(/(?:ℝ|\bR)(?:\^\{?([0-9]+)\}?|([⁰¹²³⁴⁵⁶⁷⁸⁹]+))/g, (match, ascii: string | undefined, raised: string | undefined) => {
      const digits = raised?.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit)))
      return `$\\mathbb{R}^{${ascii ?? digits ?? match}}$`
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
