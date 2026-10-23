/**
 * Numeric answers in an economics course: money, thousands separators,
 * percentages, "in thousands" axes and the absolute-value convention of the
 * price elasticity of demand. Pure and local.
 *
 * Only used for economics questions (the course subject is economics, or the
 * question carries an explicit `EconNumberSpec`); every other subject keeps
 * the plain numeric grader, so `1 000` or `$5` there behave as before.
 *
 * Reading (`readEconNumber`):
 *   `$1,800`  `1,800`  `85 000` (space / thin space / no-break space)  `$1.4`
 *   `−$20` / `$-20`  `10%`  `60k` / `60 thousand` / `1.2 million` / `3 万`
 *   A comma is a thousands separator only in groups of three (`1,5` is not read).
 *   Anything else falls back to `parseNumeric` (`10/8`, `1.25e3`).
 *
 * Comparing (`compareEconNumber`), with the expected answer read the same way:
 *   - Tolerance: 1 % of the expected value, or half a unit of the last decimal
 *     place the student wrote (`1.4` for 1.43 is a correct rounding; `1` for
 *     1.25 is not).
 *   - Percent: an answer with `%` is in percentage points. `10%` matches an
 *     expected `10` or `10%`; `0.1` for an expected `10%` (and `10%` for an
 *     expected `0.1`) is accepted with a note that it was read as a fraction.
 *   - Scale (`scale: 1000` = the question states amounts in thousands): a bare
 *     number is in the stated unit (`60` = 60 thousand); a number with a scale
 *     word (`60k`, `60 thousand`) is converted; a bare full amount (`60000`,
 *     `$60,000`) is accepted with a note that it was read as a full amount.
 *   - Sign: with `absolute: true` (price elasticity of demand reported as an
 *     absolute value) `−1.25` for an expected `1.25` is correct, with a note;
 *     without it, a right magnitude with the wrong sign is wrong, with a note.
 */
import { parseNumeric } from './expressionEvaluator'

export interface EconNumberSpec {
  /** The answer is reported as an absolute value (price elasticity of demand). */
  absolute?: boolean
  /** The expected value is stated in this many units (1000 = "in thousands"). */
  scale?: number
  /** The expected value is a percentage (10 = 10 %), even without a % sign. */
  percent?: boolean
}

export interface EconNumberReading {
  /** The number with any scale word applied; a percentage stays in points (10% → 10). */
  value: number
  percent: boolean
  currency: boolean
  /** A scale word was written (`k`, `thousand`, `million`, `万` …). */
  scaled: boolean
  /** Written with thousands separators (`1,800`, `85 000`). */
  grouped: boolean
  /** Decimal places as typed (before a scale word). */
  decimals: number
}

const CURRENCY = String.raw`(?:US\$|C\$|CA\$|A\$|HK\$|[$€£¥])`
const CURRENCY_WORD = String.raw`(?:dollars?|usd|cad|eur|rmb|cny|yuan|元|美元)`
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?: \d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`
const SCALE = String.raw`(k|thousands?|千|m|mn|millions?|bn|b|billions?|万|百万|亿)`
const PERCENT = String.raw`(%|percent|per cent|pct|个百分点|百分点)`

const PATTERN = new RegExp(
  String.raw`^([+-])?\s*(${CURRENCY})?\s*([+-])?\s*${NUMBER}\s*${SCALE}?\s*${PERCENT}?\s*(${CURRENCY_WORD})?$`,
  'i',
)

const SCALES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  千: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  millions: 1e6,
  bn: 1e9,
  b: 1e9,
  billion: 1e9,
  billions: 1e9,
  万: 1e4,
  百万: 1e6,
  亿: 1e8,
}

function clean(text: string): string {
  return text
    .normalize('NFKC') // no-break / thin spaces → space, full-width $ → $
    .replace(/[−‒–—﹣－]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]$/, '')
    .trim()
}

/** Read an economics answer such as `$1,800`, `85 000`, `10%`, `60k`; null when it is not one number. */
export function readEconNumber(text: string): EconNumberReading | null {
  const input = clean(text)
  if (!input) return null
  const match = PATTERN.exec(input)
  if (match) {
    const [, signBefore, currency, signAfter, digits, scaleWord, percent, currencyWord] = match
    if (signBefore && signAfter) return null
    const plain = digits!.replace(/[, ]/g, '')
    const number = Number(plain)
    if (!Number.isFinite(number)) return null
    const scale = scaleWord ? SCALES[scaleWord.toLowerCase()] : undefined
    if (scaleWord && scale === undefined) return null
    const negative = (signBefore ?? signAfter) === '-'
    const decimals = plain.includes('.') ? plain.length - plain.indexOf('.') - 1 : 0
    return {
      value: (negative ? -number : number) * (scale ?? 1),
      percent: Boolean(percent),
      currency: Boolean(currency || currencyWord),
      scaled: scale !== undefined,
      grouped: /[, ]/.test(digits!),
      decimals,
    }
  }
  // `10/8`, `1.25e3`, `-0.5`: no money or percent decoration.
  if (/[$€£¥%,]/.test(input)) return null
  const value = parseNumeric(input)
  return value === null
    ? null
    : { value, percent: false, currency: false, scaled: false, grouped: false, decimals: 0 }
}

/** The number a typed economics answer is read as (for the live preview); null when unreadable. */
export function previewEconNumber(text: string): number | null {
  return readEconNumber(text)?.value ?? null
}

/** Why an answer was accepted or rejected beyond "the number matches". */
export type EconNote =
  /** −1.25 accepted as 1.25: the course reports this as an absolute value. */
  | 'absolute-value'
  /** The magnitude is right but the sign is not. */
  | 'sign'
  /** A bare full amount (60000) read against a value stated in thousands (60). */
  | 'full-amount'
  /** 0.1 read as 10 % (the expected answer is a percentage). */
  | 'decimal-for-percent'
  /** 10 % read as 0.1 (the expected answer is a fraction). */
  | 'percent-for-decimal'

export interface EconComparison {
  outcome: 'correct' | 'wrong' | 'unreadable'
  note?: EconNote
}

interface Candidate {
  value: number
  /** Half a unit of the last written decimal, in the same unit as `value` (0 when none). */
  halfUnit: number
  note?: EconNote
}

/** A full amount: written with a currency sign, a scale word or thousands separators. */
function isFullAmount(reading: EconNumberReading): boolean {
  return reading.currency || reading.scaled || reading.grouped
}

/** The student's answer as full amounts (or percentage points), most likely reading first. */
function candidates(
  given: EconNumberReading,
  expectedPercent: boolean,
  scale: number,
): Candidate[] {
  const half = given.decimals > 0 ? 0.5 * 10 ** -given.decimals : 0
  const out: Candidate[] = []
  const add = (factor: number, note?: EconNote) =>
    out.push({
      value: given.value * factor,
      halfUnit: half * Math.abs(factor),
      ...(note ? { note } : {}),
    })
  if (expectedPercent) {
    add(1)
    if (!given.percent) add(100, 'decimal-for-percent')
    return out
  }
  if (given.percent) {
    add(1)
    add(1 / 100, 'percent-for-decimal')
    return out
  }
  if (scale === 1 || given.scaled) {
    add(1)
    return out
  }
  // Amounts stated in thousands: `60` is 60 thousand; `$60,000` is a full amount.
  if (isFullAmount(given)) {
    add(1)
    add(scale)
  } else {
    add(scale)
    add(1, 'full-amount')
  }
  return out
}

function close(value: number, expected: number, halfUnit: number): boolean {
  const tolerance = Math.max(1e-2 * Math.abs(expected), halfUnit, expected === 0 ? 1e-9 : 0)
  return Math.abs(value - expected) <= tolerance + 1e-12
}

/** Compare an economics answer with the expected one (see the module comment for the rules). */
export function compareEconNumber(
  given: string,
  expected: string,
  spec: EconNumberSpec = {},
): EconComparison {
  const reference = readEconNumber(expected)
  const answer = readEconNumber(given)
  if (!reference || !answer) return { outcome: 'unreadable' }
  const scale = spec.scale && spec.scale > 1 ? spec.scale : 1
  const percent = Boolean(spec.percent || reference.percent)
  // The expected value as a full amount: a bare number is in the stated unit.
  const target = percent || isFullAmount(reference) ? reference.value : reference.value * scale
  const options = candidates(answer, percent, scale)
  for (const option of options) {
    if (close(option.value, target, option.halfUnit))
      return { outcome: 'correct', ...(option.note ? { note: option.note } : {}) }
  }
  for (const option of options) {
    if (option.value === 0 || !close(-option.value, target, option.halfUnit)) continue
    if (spec.absolute && target >= 0) return { outcome: 'correct', note: 'absolute-value' }
    return { outcome: 'wrong', note: 'sign' }
  }
  return { outcome: 'wrong' }
}

/** Questions that state amounts in thousands / millions ("$ thousands", "(000s)", "单位：千"). */
const THOUSANDS =
  /\bin thousands\b|\(\s*(?:\$\s*)?thousands?\s*\)|\bthousands of (?:dollars|units|\$)|\$\s*thousands\b|\(\s*\$?\s*000s?\s*\)|\(\s*'000\s*\)|单位[:：]?\s*千|（千[^）]*）|以千计|千元|千件/i
const MILLIONS =
  /\bin millions\b|\(\s*(?:\$\s*)?millions?\s*\)|\bmillions of (?:dollars|units|\$)|\$\s*millions\b|单位[:：]?\s*百万|以百万计|百万元/i

/** The price elasticity of demand (reported as an absolute value); not income / cross-price. */
const PRICE_ELASTICITY_OF_DEMAND =
  /(?:price\s+)?elasticity\s+of\s+demand|demand\s+elasticity|需求(?:的)?(?:价格)?弹性|价格弹性/i
const SIGNED_ELASTICITY = /income|cross|收入|交叉|elasticity of supply|供给弹性/i
const ABSOLUTE_VALUE = /absolute value|绝对值/i

/**
 * The reading rules of one economics question: what the question says plus
 * the course convention that the price elasticity of demand is reported as an
 * absolute value. An explicit spec on the question wins field by field.
 */
export function econSpecFromText(prompt: string, explicit: EconNumberSpec = {}): EconNumberSpec {
  const scale = THOUSANDS.test(prompt) ? 1e3 : MILLIONS.test(prompt) ? 1e6 : undefined
  const absolute =
    ABSOLUTE_VALUE.test(prompt) ||
    (PRICE_ELASTICITY_OF_DEMAND.test(prompt) && !SIGNED_ELASTICITY.test(prompt))
  const spec: EconNumberSpec = {
    ...(scale ? { scale } : {}),
    ...(absolute ? { absolute: true } : {}),
  }
  return { ...spec, ...explicit }
}
