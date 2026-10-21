import { all, create, type Unit } from 'mathjs'
import { superscriptsToCaret } from './superscripts'

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

/**
 * A private mathjs instance with the units university chemistry and biology
 * use but mathjs lacks: molarity (M, mM, µM, nM), daltons (Da, kDa),
 * calories (cal, kcal) and ppm / ppb. Kept separate so these names never
 * change how the expression grader reads a variable called `M`.
 */
const math = create(all)
math.createUnit('M', { definition: '1 mol/L', prefixes: 'short' })
math.createUnit('Da', { definition: '1.66053906660e-27 kg', prefixes: 'short' })
math.createUnit('cal', { definition: '4.184 J', prefixes: 'short' })
math.createUnit('ppm', { definition: '0.000001' })
// Clinical units. Osmoles and equivalents count particles / charges, which
// depend on the substance, so they are their own dimensions: 300 mOsm/L
// compares with mOsm/L and Osm/L, never with mol/L.
math.createUnit('bpm', { definition: '1 / min' })
math.createUnit('Osm', { prefixes: 'short' })
math.createUnit('Eq', { prefixes: 'short' })
math.createUnit('ppb', { definition: '0.000000001' })
const mathUnit = (value: number | string, unitText?: string): Unit =>
  unitText === undefined ? math.unit(value as string) : math.unit(value as number, unitText)

/** Typed / pasted unit notation → mathjs syntax. */
export function normalizeUnitText(text: string): string {
  return superscriptsToCaret(text, false)
    .replace(/⁻/g, '^-')
    .replace(/\^-\^?(\d)/g, '^-$1')
    .replace(/[·⋅•×]/g, ' ')
    .replace(/[μµ]/g, 'u')
    .replace(/Ω/g, 'ohm')
    .replace(/Å/g, 'angstrom')
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
  // `1.2×10⁻³ m` → `1.2×10^-3 m` before the number is read.
  const match = NUMBER.exec(superscriptsToCaret(input.replace(/，/g, ','), false).trim())
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
  const ok = isTemperature(expected)
    ? temperatureClose(actual, expectedNumber, target)
    : expectedNumber === 0
      ? Math.abs(convertedValue) <= ZERO_FLOOR
      : Math.abs(convertedValue - expectedNumber) <= REL_TOL * Math.abs(expectedNumber)
  return { outcome: ok ? 'correct' : 'wrong-value', isCorrect: ok, convertedValue }
}

/** An expected 0 accepts float noise from unit conversion, nothing more. */
const ZERO_FLOOR = 1e-9
/** Rounding 273.15 K to 273 K (or 0 °C to 32 °F) must still be accepted. */
const TEMPERATURE_FLOOR_K = 0.5

function isTemperature(unit: Unit): boolean {
  return unit.equalBase(mathUnit(1, 'K'))
}

/**
 * Celsius and Fahrenheit have an offset, so a relative tolerance on 0 °C would
 * demand a bit-exact answer. Temperatures are compared as absolute values in
 * K; the tolerance is 1% of the stated value taken as a temperature
 * difference (25 °C → ±0.25 K), but never less than 0.5 K.
 */
function temperatureClose(actual: Unit, expectedNumber: number, target: string): boolean {
  const actualK = actual.toNumber('K')
  const expectedK = mathUnit(expectedNumber, target).toNumber('K')
  const degreeInK = mathUnit(1, target).toNumber('K') - mathUnit(0, target).toNumber('K')
  const tolerance = Math.max(
    REL_TOL * Math.abs(expectedNumber) * Math.abs(degreeInK),
    TEMPERATURE_FLOOR_K,
  )
  return Math.abs(actualK - expectedK) <= tolerance
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
