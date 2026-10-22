/**
 * Vector answers, graded locally.
 *
 * A student may write a vector as components or as magnitude + direction,
 * whichever the question invites, and both are compared by converting to
 * components:
 *
 *   (−0.903, 2.84) m/s²       <1, −2, 3>        −0.903 î + 2.84 ĵ m/s²
 *   2.98 m/s² at 17.7° W of N  2.98 m/s², N 17.7° W    2.98 ∠ 107.7°
 *   5.0 N at 30° above +x      5.0 N at 30° below the −x axis    北偏西 17.7°
 *
 * Directions: angles are measured counter-clockwise from +x, with +y as
 * north and +x as east (the textbook convention for compass bearings).
 * "17.7° W of N" starts at north and turns 17.7° towards west.
 *
 * Tolerances: 1% of the magnitude and 1° of direction (2-D); in 3-D the
 * difference vector must be within 1% of the reference magnitude.
 */
import { convertUnitValue, normalizeUnitText } from './quantityAnswer'
import { superscriptsToCaret } from './superscripts'

export interface VectorSpec {
  /** Components in order x, y (, z). */
  components: number[]
  /** Unit of the components (mathjs syntax), when the vector is a physical quantity. */
  unit?: string
}

export type VectorForm = 'components' | 'polar'

export interface ParsedVector {
  form: VectorForm
  /** Components in the student's unit. */
  components: number[]
  unitText: string
}

export type VectorOutcome =
  | 'correct'
  /** Same component sizes, but at least one sign is wrong. */
  | 'wrong-sign'
  /** x and y components exchanged. */
  | 'swapped'
  /** Right magnitude, wrong direction. */
  | 'direction-wrong'
  /** Right direction, wrong magnitude. */
  | 'magnitude-wrong'
  | 'wrong'
  | 'component-count'
  | 'missing-unit'
  | 'wrong-dimension'
  | 'unreadable-unit'
  | 'unreadable'

export interface VectorComparison {
  outcome: VectorOutcome
  form?: VectorForm
  /** The answer converted to components in the reference unit. */
  components?: number[]
  /** 0-based indices of components with a wrong sign (`wrong-sign`). */
  signs?: number[]
  /** The student's unit, when it differs from the reference's (converted). */
  convertedFrom?: string
}

const REL_TOL = 1e-2
const ANGLE_TOL = 1

const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`

function clean(input: string): string {
  return superscriptsToCaret(input.normalize('NFKC'), false)
    .replace(/\$/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\langle|⟨|〈/g, '<')
    .replace(/\\rangle|⟩|〉/g, '>')
    .replace(/\\hat\{?([ijkxyz])\}?/g, '$1hat')
    .replace(/\\(?:circ|degree)/g, '°')
    .replace(/\^\{?\\?circ\}?/g, '°')
    .replace(/[−–—]/g, '-')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/\\angle/g, '∠')
    .replace(/(\d)\s*(?:deg|degrees?)\b/gi, '$1°')
    .trim()
}

/** "(a, b[, c]) unit" or "<a, b>" — `null` when the text is not a component list. */
function parseComponentList(text: string): ParsedVector | null {
  const match = new RegExp(
    String.raw`^[(<\[]\s*(${NUM})\s*[,;]\s*(${NUM})(?:\s*[,;]\s*(${NUM}))?\s*[)>\]]\s*(.*)$`,
  ).exec(text)
  if (!match) return null
  const components = [match[1], match[2], match[3]]
    .filter((part): part is string => part !== undefined)
    .map(Number)
  if (components.some((value) => !Number.isFinite(value))) return null
  return { form: 'components', components, unitText: normalizeUnitText(match[4] ?? '') }
}

const UNIT_VECTOR: Record<string, number> = {
  i: 0,
  ihat: 0,
  î: 0,
  x: 0,
  xhat: 0,
  x̂: 0,
  j: 1,
  jhat: 1,
  ĵ: 1,
  y: 1,
  yhat: 1,
  ŷ: 1,
  k: 2,
  khat: 2,
  k̂: 2,
  z: 2,
  zhat: 2,
  ẑ: 2,
}

/** "−0.903 î + 2.84 ĵ" (optionally in parentheses, then the unit). */
function parseUnitVectorSum(text: string): ParsedVector | null {
  let body = text
  let unit = ''
  const wrapped = /^\((.*)\)\s*(.*)$/.exec(text)
  if (wrapped) {
    body = wrapped[1]!
    unit = wrapped[2]!
  }
  const term = new RegExp(
    String.raw`([-+]?)\s*(${NUM.replace('[-+]?', '')})?\s*\*?\s*(ihat|jhat|khat|xhat|yhat|zhat|î|ĵ|k̂|x̂|ŷ|ẑ|i|j|k)(?![a-zA-Z])`,
    'y',
  )
  const components: Array<number | undefined> = []
  let at = 0
  let seen = 0
  const source = body.replace(/\s+/g, ' ').trim()
  while (at < source.length) {
    term.lastIndex = at
    const match = term.exec(source)
    if (!match) break
    const sign = match[1] === '-' ? -1 : 1
    const size = match[2] === undefined ? 1 : Number(match[2])
    const axis = UNIT_VECTOR[match[3]!]
    if (axis === undefined || components[axis] !== undefined || !Number.isFinite(size)) return null
    components[axis] = sign * size
    seen++
    at = term.lastIndex
    while (source[at] === ' ') at++
  }
  if (seen === 0) return null
  const rest = source.slice(at).trim()
  if (!wrapped) unit = rest
  else if (rest) return null
  const length = components[2] !== undefined ? 3 : 2
  const filled = Array.from({ length }, (_, i) => components[i] ?? 0)
  return { form: 'components', components: filled, unitText: normalizeUnitText(unit) }
}

const COMPASS: Record<string, number> = {
  e: 0,
  east: 0,
  东: 0,
  n: 90,
  north: 90,
  北: 90,
  w: 180,
  west: 180,
  西: 180,
  s: 270,
  south: 270,
  南: 270,
}

function compass(word: string): number | undefined {
  return COMPASS[word.toLowerCase()]
}

/** Turn from `base` towards `target` by `degrees` (the shorter way round). */
function turn(base: number, target: number, degrees: number): number | null {
  const diff = ((((target - base) % 360) + 540) % 360) - 180
  if (Math.abs(Math.abs(diff) - 90) > 1e-9) return null
  return base + Math.sign(diff) * degrees
}

const AXIS = String.raw`(?:the\s+)?([+-]|positive\s+|negative\s+)?\s*(x|y|horizontal|vertical)(?:[- ]?axis)?`

function axisAngle(signText: string | undefined, axis: string): number {
  const negative = /^(-|negative)/.test((signText ?? '').trim())
  const base = axis === 'y' || axis === 'vertical' ? 90 : 0
  return negative ? base + 180 : base
}

/**
 * A direction phrase → angle in degrees counter-clockwise from +x, plus where
 * it sits in the text. `null` when no direction can be read.
 */
export function readDirection(text: string): { angle: number; start: number; end: number } | null {
  const deg = String.raw`(${NUM})\s*°?`
  const words = String.raw`(n|s|e|w|north|south|east|west)`
  const patterns: Array<[RegExp, (m: RegExpExecArray) => number | null]> = [
    // 17.7° W of N
    [
      new RegExp(String.raw`${deg}\s*${words}\s+of\s+(?:due\s+)?${words}\b`, 'i'),
      (m) => turn(compass(m[3]!)!, compass(m[2]!)!, Number(m[1])),
    ],
    // N 17.7° W
    [
      new RegExp(String.raw`\b${words}\s*${deg}\s*${words}\b`, 'i'),
      (m) => turn(compass(m[1]!)!, compass(m[3]!)!, Number(m[2])),
    ],
    // 北偏西 17.7°
    [
      new RegExp(String.raw`([东南西北])偏([东南西北])\s*${deg}`),
      (m) => turn(compass(m[1]!)!, compass(m[2]!)!, Number(m[3])),
    ],
    // 30° above / below the +x axis
    [
      new RegExp(String.raw`${deg}\s*(above|below)\s+${AXIS}`, 'i'),
      (m) => {
        const base = axisAngle(m[3], m[4]!.toLowerCase())
        if (base % 180 !== 0) return null
        const up = m[2]!.toLowerCase() === 'above'
        return base === 0
          ? up
            ? Number(m[1])
            : -Number(m[1])
          : up
            ? 180 - Number(m[1])
            : 180 + Number(m[1])
      },
    ],
    // 30° counterclockwise / clockwise from +x
    [
      new RegExp(
        String.raw`${deg}\s*(counter-?clockwise|anti-?clockwise|ccw|clockwise|cw)\s+from\s+${AXIS}`,
        'i',
      ),
      (m) => {
        const base = axisAngle(m[3], m[4]!.toLowerCase())
        const clockwise = /^(clockwise|cw)$/i.test(m[2]!)
        return base + (clockwise ? -1 : 1) * Number(m[1])
      },
    ],
    // 30° from +x
    [
      new RegExp(String.raw`${deg}\s*from\s+${AXIS}`, 'i'),
      (m) => axisAngle(m[2], m[3]!.toLowerCase()) + Number(m[1]),
    ],
    // ∠30°
    [new RegExp(String.raw`∠\s*${deg}`), (m) => Number(m[1])],
    // due north
    [new RegExp(String.raw`\b(?:due\s+)?(north|south|east|west)\b`, 'i'), (m) => compass(m[1]!)!],
    // at 30° (counter-clockwise from +x)
    [new RegExp(String.raw`(?:\bat\b|@|,|\bdirection\b)\s*(${NUM})\s*°`, 'i'), (m) => Number(m[1])],
  ]
  for (const [pattern, angleOf] of patterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const angle = angleOf(match)
    if (angle === null || !Number.isFinite(angle)) return null
    return { angle, start: match.index, end: match.index + match[0].length }
  }
  return null
}

/** "2.98 m/s² at 17.7° W of N" (or the direction first). */
function parsePolar(text: string): ParsedVector | null {
  const direction = readDirection(text)
  if (!direction) return null
  let before = text.slice(0, direction.start)
  const after = text.slice(direction.end)
  // The ∠ / "at" / "," that introduced the direction belongs to it.
  before = before.replace(/(?:\bat\b|@|,|;|\bdirected\b|\bdirection\b|\s)+$/i, '').trim()
  const magnitudeText = before || after.replace(/^[\s,;]+/, '').trim()
  if (before && after.trim() && !/^[\s,.;]*$/.test(after)) return null
  const match = new RegExp(
    String.raw`^(${NUM})(?:\s*(?:[×xX*])\s*10\s*\^\s*\(?\s*([-+]?\d+)\s*\)?)?\s*(.*)$`,
  ).exec(magnitudeText)
  if (!match) return null
  const magnitude = Number(match[1]) * 10 ** Number(match[2] ?? 0)
  if (!Number.isFinite(magnitude) || magnitude < 0) return null
  const radians = (direction.angle * Math.PI) / 180
  return {
    form: 'polar',
    components: [magnitude * Math.cos(radians), magnitude * Math.sin(radians)],
    unitText: normalizeUnitText(match[3] ?? ''),
  }
}

/** Read a typed vector, in components or as magnitude + direction. */
export function parseVectorAnswer(input: string): ParsedVector | null {
  const text = clean(input)
  if (!text) return null
  return parseComponentList(text) ?? parseUnitVectorSum(text) ?? parsePolar(text)
}

function magnitudeOf(v: readonly number[]): number {
  return Math.hypot(...v)
}

/** Direction in degrees counter-clockwise from +x, in (−180, 180]. */
export function angleOf(v: readonly number[]): number {
  return (Math.atan2(v[1] ?? 0, v[0] ?? 0) * 180) / Math.PI
}

function angleDifference(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180)
}

export function compareVector(answer: string, spec: VectorSpec): VectorComparison {
  const parsed = parseVectorAnswer(answer)
  if (!parsed) return { outcome: 'unreadable' }
  const expected = spec.components
  let components = parsed.components
  let convertedFrom: string | undefined
  if (spec.unit) {
    if (!parsed.unitText) return { outcome: 'missing-unit', form: parsed.form }
    const factor = convertUnitValue(1, parsed.unitText, spec.unit)
    if (!factor.ok)
      return {
        outcome: factor.reason === 'wrong-dimension' ? 'wrong-dimension' : 'unreadable-unit',
        form: parsed.form,
      }
    if (factor.converted) {
      convertedFrom = parsed.unitText
      components = components.map((value) => value * factor.value)
    }
  }
  const base = { form: parsed.form, components, ...(convertedFrom ? { convertedFrom } : {}) }
  if (components.length !== expected.length) {
    // "(a, b)" for a vector in the plane given as (a, b, 0) is fine.
    const padded = [...components, 0, 0].slice(0, expected.length)
    const extraZero = components.slice(expected.length).every((value) => value === 0)
    if (components.length > expected.length && extraZero) components = padded
    else return { ...base, outcome: 'component-count' }
  }
  const reference = magnitudeOf(expected)
  const size = magnitudeOf(components)
  const scale = Math.max(reference, 1e-12)
  const difference = magnitudeOf(components.map((value, i) => value - expected[i]!))
  const magnitudeOk = Math.abs(size - reference) <= REL_TOL * scale
  if (expected.length === 2) {
    const angleOk =
      reference === 0 || size === 0
        ? magnitudeOk
        : angleDifference(angleOf(components), angleOf(expected)) <= ANGLE_TOL
    if (magnitudeOk && angleOk) return { ...base, outcome: 'correct', components }
  } else if (difference <= REL_TOL * scale) {
    return { ...base, outcome: 'correct', components }
  }
  const close = (a: number, b: number) => Math.abs(a - b) <= REL_TOL * scale
  // Same sizes, some signs flipped.
  if (components.every((value, i) => close(Math.abs(value), Math.abs(expected[i]!)))) {
    const signs = components
      .map((value, i) =>
        Math.sign(value) !== Math.sign(expected[i]!) && !close(value, expected[i]!) ? i : -1,
      )
      .filter((i) => i >= 0)
    if (signs.length > 0) return { ...base, components, outcome: 'wrong-sign', signs }
  }
  if (
    expected.length >= 2 &&
    close(components[0]!, expected[1]!) &&
    close(components[1]!, expected[0]!) &&
    components.slice(2).every((value, i) => close(value, expected[i + 2]!))
  )
    return { ...base, components, outcome: 'swapped' }
  if (magnitudeOk) return { ...base, components, outcome: 'direction-wrong' }
  const sameDirection =
    reference > 0 &&
    size > 0 &&
    (expected.length === 2
      ? angleDifference(angleOf(components), angleOf(expected)) <= ANGLE_TOL
      : magnitudeOf(components.map((value, i) => value / size - expected[i]! / reference)) <= 0.02)
  if (sameDirection) return { ...base, components, outcome: 'magnitude-wrong' }
  return { ...base, components, outcome: 'wrong' }
}

function short(value: number): string {
  if (value === 0) return '0'
  return String(Number(value.toPrecision(3)))
}

/** Compass bearing measured from north or south, e.g. "17.7° W of N". */
export function compassText(angle: number): string {
  const a = ((angle % 360) + 360) % 360
  const axes: Array<[number, string]> = [
    [0, 'E'],
    [90, 'N'],
    [180, 'W'],
    [270, 'S'],
    [360, 'E'],
  ]
  for (const [at, name] of axes) if (Math.abs(a - at) < 0.05) return `due ${name}`
  const fromNorthSouth = a < 180 ? 'N' : 'S'
  const toward = a < 90 || a > 270 ? 'E' : 'W'
  const offset = fromNorthSouth === 'N' ? Math.abs(90 - a) : Math.abs(270 - a)
  return `${short(offset)}° ${toward} of ${fromNorthSouth}`
}

/** The reference as shown after grading: components, and for 2-D also magnitude + direction. */
export function formatVectorSpec(spec: VectorSpec): string {
  const unit = spec.unit ? ` ${spec.unit}` : ''
  const components = `(${spec.components.map(short).join(', ')})${unit}`
  if (spec.components.length !== 2) return components
  const size = magnitudeOf(spec.components)
  if (size === 0) return components
  const angle = angleOf(spec.components)
  return `${components} = ${short(size)}${unit}, ${short(angle)}° from +x (${compassText(angle)})`
}

/** Components read from an AI field; 2 or 3 finite numbers, otherwise null. */
export function asVectorComponents(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return null
  const numbers = value.map((item) => (typeof item === 'string' ? Number(item) : item))
  return numbers.every((item): item is number => typeof item === 'number' && Number.isFinite(item))
    ? numbers
    : null
}
