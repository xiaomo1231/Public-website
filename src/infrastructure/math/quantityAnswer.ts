import { unit as mathUnit, type Unit } from 'mathjs'

/**
 * Deterministic grading of a physical quantity: a number *with a unit*.
 *
 * The expected answer is a bare number plus a unit string (mathjs syntax,
 * e.g. `m/s^2`, `kJ/mol`, `degC`). The student may answer in any unit of the
 * same dimension — `980 cm/s^2` is right when `9.8 m/s^2` is expected — and
 * the value is converted before the usual 1% relative tolerance is applied.
 *
 * Outcomes are explicit so the UI can say *why*:
 *   correct            right value, compatible unit
 *   wrong-value        compatible unit, value outside tolerance
 *   missing-unit       a bare number where a unit is required
 *   wrong-dimension    a unit of another kind (e.g. N for an energy)
 *   unreadable-unit    the unit text could not be understood → unverified
 *   unreadable-number  no leading number could be read        → unverified
 */
export type QuantityOutcome =
  | 'correct'
  | 'wrong-value'
  | 'missing-unit'
  | 'wrong-dimension'
  | 'unreadable-unit'
  | 'unreadable-number'

export interface QuantityComparison {
  outcome: QuantityOutcome
  /** true / false, or null when it could not be checked automatically. */
  isCorrect: boolean | null
  /** The student's value converted into the expected unit, when possible. */
  convertedValue?: number
}

const REL_TOL = 1e-2

/** Typed / pasted unit notation → mathjs syntax. */
export function normalizeUnitText(text: string): string {
  return text
    .replace(/[²]/g, '^2')
    .replace(/[³]/g, '^3')
    .replace(/[¹]/g, '^1')
    .replace(/⁻/g, '^-')
    .replace(/\^-\^?(\d)/g, '^-$1')
    .replace(/[·⋅•×]/g, ' ')
    .replace(/[μµ]/g, 'u')
    .replace(/Ω/g, 'ohm')
    .replace(/℃|°\s*C\b/g, 'degC')
    .replace(/℉|°\s*F\b/g, 'degF')
    .replace(/°/g, 'deg')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A unit string the grader can use (also used to validate AI output). */
export function isValidUnit(unitText: string): boolean {
  const normalized = normalizeUnitText(unitText)
  if (!normalized || /^[\d.\s]/.test(normalized)) return false
  try {
    mathUnit(`1 ${normalized}`)
    return true
  } catch {
    return false
  }
}

// Commas are thousands separators, as in `parseNumeric` ("1,000 m" = 1000 m).
const NUMBER =
  /^\s*([-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*[eE]\s*[-+]?\d+)?)(?:\s*(?:[×xX*])\s*10\s*\^\s*\(?\s*([-+]?\d+)\s*\)?)?\s*(.*)$/

/** Split "1.2 × 10^3 kPa" into 1200 and "kPa". */
export function splitQuantity(input: string): { value: number; unitText: string } | null {
  const match = NUMBER.exec(input.replace(/，/g, ',').trim())
  if (!match) return null
  const mantissa = Number(match[1]!.replace(/[\s,]+/g, ''))
  if (!Number.isFinite(mantissa)) return null
  const exponent = match[2] ? Number(match[2]) : 0
  const value = mantissa * 10 ** exponent
  if (!Number.isFinite(value)) return null
  return { value, unitText: normalizeUnitText(match[3] ?? '') }
}

export function compareQuantity(
  userAnswer: string,
  expectedValue: string,
  expectedUnit: string,
): QuantityComparison {
  const expectedNumber = Number(expectedValue.trim())
  let expected: Unit
  try {
    expected = mathUnit(expectedNumber, normalizeUnitText(expectedUnit))
  } catch {
    return { outcome: 'unreadable-unit', isCorrect: null }
  }
  if (!Number.isFinite(expectedNumber)) return { outcome: 'unreadable-number', isCorrect: null }

  const given = splitQuantity(userAnswer)
  if (!given) return { outcome: 'unreadable-number', isCorrect: null }
  if (!given.unitText) return { outcome: 'missing-unit', isCorrect: false }

  let actual: Unit
  try {
    actual = mathUnit(given.value, given.unitText)
  } catch {
    return { outcome: 'unreadable-unit', isCorrect: null }
  }
  if (!actual.equalBase(expected)) return { outcome: 'wrong-dimension', isCorrect: false }

  const target = normalizeUnitText(expectedUnit)
  const convertedValue = actual.toNumber(target)
  const diff = Math.abs(convertedValue - expectedNumber)
  const ok = diff <= REL_TOL * Math.max(Math.abs(expectedNumber), 1e-12)
  return { outcome: ok ? 'correct' : 'wrong-value', isCorrect: ok, convertedValue }
}

/** How a typed quantity will be read, for a live preview under the field. */
export type QuantityPreview =
  | { status: 'empty' }
  | { status: 'ok'; value: number; unit: string }
  | { status: 'no-unit'; value: number }
  | { status: 'bad-unit'; unit: string }
  | { status: 'bad-number' }

export function previewQuantity(input: string): QuantityPreview {
  if (!input.trim()) return { status: 'empty' }
  const split = splitQuantity(input)
  if (!split) return { status: 'bad-number' }
  if (!split.unitText) return { status: 'no-unit', value: split.value }
  return isValidUnit(split.unitText)
    ? { status: 'ok', value: split.value, unit: split.unitText }
    : { status: 'bad-unit', unit: split.unitText }
}
