/**
 * Unicode superscripts → caret notation, shared by the expression and the
 * quantity graders. A run is read as one exponent, so `x⁻¹` becomes `x^(-1)`,
 * `10⁻³` becomes `10^(-3)` and `x¹⁰` becomes `x^10`. A sign with no digits
 * (`Fe³⁺`-style charges are not graded here) is left untouched.
 */
const DIGITS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
}

const RUN = /([⁺⁻]?)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g

/**
 * @param parenthesize wrap a signed exponent in parentheses (`^(-1)`, for
 *   mathjs expressions) instead of writing it bare (`^-1`, for unit text).
 */
export function superscriptsToCaret(input: string, parenthesize = true): string {
  return input.replace(RUN, (_match, sign: string, digits: string) => {
    const value = [...digits].map((d) => DIGITS[d] ?? '').join('')
    if (!sign) return `^${value}`
    const signed = `${sign === '⁻' ? '-' : '+'}${value}`
    return parenthesize ? `^(${signed})` : `^${signed}`
  })
}
