/**
 * Significant figures, read from the student's typed answer exactly as typed.
 *
 * Grading a numeric answer has three separate questions — is the value right,
 * is the unit right, does it carry the required number of significant figures
 * — and this module answers the third one. It never looks at the parsed
 * number (1.50 and 1.5 are the same number but not the same answer), only at
 * the digits the student wrote:
 *
 *   0.00450        → 3   (leading zeros never count)
 *   4.50           → 3   (trailing zeros after a decimal point count)
 *   1500           → 2–4 (ambiguous: trailing zeros of an integer)
 *   1500.          → 4   (a trailing decimal point makes them count)
 *   1.50×10^3      → 3   (scientific notation: the mantissa decides)
 *   6.02e23, 6.02 × 10²³, 6.02*10^(23), −2.0E-3 → 3, 3, 3, 2
 *
 * An ambiguous count is accepted when the required count lies in its range;
 * the feedback then suggests scientific notation.
 */
import { superscriptsToCaret } from './superscripts'

export interface SigFigReading {
  /** The mantissa digits as typed (sign and thousands separators removed). */
  digits: string
  /** Fewest significant figures the text can mean. */
  min: number
  /** Most significant figures the text can mean (= `min` unless ambiguous). */
  max: number
  /**
   * Power of ten of the last significant digit for the coarsest reading
   * (`min`): 1500 → 2 (hundreds), 4.50 → −2, 1.50×10^3 → 1.
   */
  lastPlace: number
  /** The number as typed, for tolerance checks. */
  value: number
  /** What follows the number (a unit, or more maths). */
  rest: string
}

const NUMBER_TOKEN =
  /^\s*([-+−]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:\s*[eE]\s*([-+−]?\d+)|\s*(?:[×xX*·⋅])\s*10\s*\^\s*\(?\s*([-+−]?\d+)\s*\)?)?/

/**
 * Read the leading number of an answer ("1.50×10^3 kPa", "0.0450 M", "−3.2").
 * `null` when the answer does not start with a number.
 */
export function readSigFigs(input: string): SigFigReading | null {
  const text = superscriptsToCaret(input.replace(/，/g, ','), false)
  const match = NUMBER_TOKEN.exec(text)
  if (!match) return null
  const sign = match[1] === '-' || match[1] === '−' ? -1 : 1
  const mantissa = match[2]!.replace(/,/g, '')
  const exponentText = (match[3] ?? match[4] ?? '0').replace('−', '-')
  const exponent = Number(exponentText)
  if (!Number.isFinite(exponent)) return null
  const value = sign * Number(mantissa === '.' ? 'NaN' : mantissa) * 10 ** exponent
  if (!Number.isFinite(value)) return null
  const rest = text.slice(match[0].length)

  const point = mantissa.indexOf('.')
  if (point >= 0) {
    const intPart = mantissa.slice(0, point)
    const fracPart = mantissa.slice(point + 1)
    const all = `${intPart}${fracPart}`
    const significant = all.replace(/^0+/, '')
    // "1500." (a written decimal point) makes every digit count.
    const lastPlace = -fracPart.length + exponent
    if (!significant) {
      // 0.00: zero written to two decimals — at least one figure.
      const count = Math.max(1, fracPart.length)
      return { digits: mantissa, min: 1, max: count, lastPlace, value, rest }
    }
    return {
      digits: mantissa,
      min: significant.length,
      max: significant.length,
      lastPlace,
      value,
      rest,
    }
  }
  const stripped = mantissa.replace(/^0+/, '')
  if (!stripped) return { digits: mantissa, min: 1, max: 1, lastPlace: exponent, value, rest }
  const trailing = /0*$/.exec(stripped)![0].length
  return {
    digits: mantissa,
    min: stripped.length - trailing,
    max: stripped.length,
    lastPlace: trailing + exponent,
    value,
    rest,
  }
}

export type SigFigStatus = 'correct' | 'too-many' | 'too-few' | 'unreadable'

export interface SigFigJudgement {
  status: SigFigStatus
  required: number
  /** What the answer shows (absent when unreadable). */
  given?: { min: number; max: number }
  /** The answer is right only because trailing zeros of an integer are ambiguous. */
  ambiguous?: boolean
}

/** Whether the answer's significant figures match `required`. */
export function judgeSigFigs(answer: string, required: number): SigFigJudgement {
  const reading = readSigFigs(answer)
  if (!reading) return { status: 'unreadable', required }
  const given = { min: reading.min, max: reading.max }
  if (required >= reading.min && required <= reading.max)
    return {
      status: 'correct',
      required,
      given,
      ...(reading.min !== reading.max ? { ambiguous: true } : {}),
    }
  return { status: reading.max < required ? 'too-few' : 'too-many', required, given }
}

/** A sensible required count from an AI field: an integer 1–10, otherwise undefined. */
export function asSigFigCount(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10 ? n : undefined
}

/** Count the significant figures of a reference written by the model ("0.0450" → 3). */
export function sigFigsOf(text: string): number | undefined {
  const reading = readSigFigs(text)
  return reading && reading.min === reading.max ? reading.min : undefined
}

/**
 * The relative tolerance for comparing the VALUE of an answer that carries
 * significant figures. Rounding is not a wrong value: the answer is compared
 * with the reference as precisely as the answer itself was written (and at
 * least as loosely as the required precision and the usual 1%).
 *
 *   expected 1.4636, answer "1"     → value right (1 s.f.), sig figs too few
 *   expected 1.4636, answer "2"     → value wrong
 *   expected 1.4636, answer "1.464" → value right, sig figs too many (if 3 required)
 */
export function sigFigRelativeTolerance(
  answer: string,
  expected: number,
  required: number | undefined,
  base = 1e-2,
): number {
  let tolerance = base
  const reading = readSigFigs(answer)
  if (reading && reading.value !== 0) {
    // Half a unit in the last place the student wrote (plus float noise).
    const half = 0.5 * 10 ** reading.lastPlace * (1 + 1e-9)
    tolerance = Math.max(tolerance, half / Math.abs(reading.value))
  }
  if (required && expected !== 0) {
    const magnitude = Math.floor(Math.log10(Math.abs(expected)))
    const half = 0.5 * 10 ** (magnitude - required + 1) * (1 + 1e-9)
    tolerance = Math.max(tolerance, half / Math.abs(expected))
  }
  // Never so loose that a different order of magnitude passes.
  return Math.min(tolerance, 0.5)
}

/** `value` rounded to `figures` significant figures, written plainly or in ×10^n form. */
export function formatSigFigs(value: number, figures: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return figures > 1 ? `0.${'0'.repeat(figures - 1)}` : '0'
  const exponent = Math.floor(Math.log10(Math.abs(value)))
  if (exponent >= -3 && exponent < figures + 1 && exponent < 6) {
    const decimals = Math.max(0, figures - 1 - exponent)
    const text = value.toFixed(decimals)
    // 1500 to 3 s.f. cannot be written plainly without ambiguity.
    if (decimals === 0 && exponent + 1 > figures) return scientific(value, figures)
    return text
  }
  return scientific(value, figures)
}

function scientific(value: number, figures: number): string {
  const [mantissa, exponent] = value.toExponential(figures - 1).split('e')
  return `${mantissa}×10^${Number(exponent)}`
}
