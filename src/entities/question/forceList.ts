/**
 * Free-body diagram questions answered as a list of forces: each force has a
 * type (gravity, normal, tension …), a direction and optionally a magnitude.
 * Graded locally against the reference list: a force matches when its type is
 * the same and its direction is within 10°; forces the student left out and
 * forces that do not act are both reported.
 *
 * The answer is stored as one force per line, `type|direction|magnitude`
 * (direction as typed: "up", "30° above +x", "N 20° E", "210").
 */
import { readDirection } from '@/infrastructure/math/vectorAnswer'

export type ForceType =
  | 'gravity'
  | 'normal'
  | 'tension'
  | 'friction'
  | 'applied'
  | 'spring'
  | 'drag'
  | 'buoyancy'
  | 'electric'
  | 'magnetic'

export const FORCE_TYPES: readonly ForceType[] = [
  'gravity',
  'normal',
  'tension',
  'friction',
  'applied',
  'spring',
  'drag',
  'buoyancy',
  'electric',
  'magnetic',
]

export function isForceType(value: unknown): value is ForceType {
  return typeof value === 'string' && (FORCE_TYPES as readonly string[]).includes(value)
}

export interface ForceSpec {
  type: ForceType
  /** Direction in degrees counter-clockwise from +x (+y is up). */
  angle: number
  /** In newtons, when the question gives or asks for it. */
  magnitude?: number
}

export interface ForceRow {
  type: string
  direction: string
  magnitude: string
}

export interface ForceListResult {
  matched: ForceType[]
  /** Reference forces the answer does not include. */
  missing: ForceType[]
  /** Forces in the answer that do not act on the body (or point the wrong way). */
  extra: ForceType[]
  /** Present in both, but pointing another way. */
  wrongDirection: ForceType[]
  /** Present and pointing the right way, but with another magnitude. */
  wrongMagnitude: ForceType[]
  /** Rows whose direction could not be read. */
  unreadable: number
}

const DIRECTION_TOL = 10
const MAGNITUDE_TOL = 0.05

export function encodeForceRows(rows: readonly ForceRow[]): string {
  return rows
    .filter((row) => row.type || row.direction.trim() || row.magnitude.trim())
    .map((row) =>
      [row.type, row.direction, row.magnitude]
        .map((part) => part.replace(/[|\n]/g, ' ').trim())
        .join('|'),
    )
    .join('\n')
}

export function decodeForceRows(answer: string): ForceRow[] {
  return answer
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [type = '', direction = '', magnitude = ''] = line.split('|')
      return { type: type.trim(), direction: direction.trim(), magnitude: magnitude.trim() }
    })
}

const WORDS: Record<string, number> = {
  up: 90,
  upward: 90,
  upwards: 90,
  向上: 90,
  down: 270,
  downward: 270,
  downwards: 270,
  向下: 270,
  right: 0,
  向右: 0,
  left: 180,
  向左: 180,
  '+x': 0,
  '-x': 180,
  '+y': 90,
  '-y': 270,
}

/** A typed direction → degrees counter-clockwise from +x, or null. */
export function readForceDirection(text: string): number | null {
  const cleaned = text.normalize('NFKC').replace(/[−–—]/g, '-').trim().toLowerCase()
  if (!cleaned) return null
  const word = WORDS[cleaned.replace(/\s+/g, '')]
  if (word !== undefined) return word
  const bare = /^([-+]?\d+(?:\.\d+)?)\s*°?$/.exec(cleaned)
  if (bare) return Number(bare[1])
  const direction = readDirection(text.normalize('NFKC').replace(/[−–—]/g, '-'))
  return direction ? direction.angle : null
}

function angleDifference(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180)
}

export function gradeForceList(answer: string, reference: readonly ForceSpec[]): ForceListResult {
  const rows = decodeForceRows(answer)
  const given: Array<{ type: string; angle: number | null; magnitude: number | null }> = rows.map(
    (row) => {
      const magnitude = Number.parseFloat(row.magnitude.replace(/,/g, ''))
      return {
        type: row.type,
        angle: readForceDirection(row.direction),
        magnitude: Number.isFinite(magnitude) ? magnitude : null,
      }
    },
  )
  const used = new Set<number>()
  const result: ForceListResult = {
    matched: [],
    missing: [],
    extra: [],
    wrongDirection: [],
    wrongMagnitude: [],
    unreadable: given.filter((force) => force.angle === null).length,
  }
  // Exact matches first (type and direction), then same type pointing elsewhere.
  const pending: ForceSpec[] = []
  for (const force of reference) {
    const index = given.findIndex(
      (item, i) =>
        !used.has(i) &&
        item.type === force.type &&
        item.angle !== null &&
        angleDifference(item.angle, force.angle) <= DIRECTION_TOL,
    )
    if (index < 0) {
      pending.push(force)
      continue
    }
    used.add(index)
    const magnitude = given[index]!.magnitude
    if (
      force.magnitude !== undefined &&
      magnitude !== null &&
      Math.abs(magnitude - force.magnitude) >
        MAGNITUDE_TOL * Math.max(Math.abs(force.magnitude), 1e-9)
    )
      result.wrongMagnitude.push(force.type)
    else result.matched.push(force.type)
  }
  for (const force of pending) {
    const index = given.findIndex((item, i) => !used.has(i) && item.type === force.type)
    if (index >= 0) {
      used.add(index)
      result.wrongDirection.push(force.type)
    } else result.missing.push(force.type)
  }
  given.forEach((item, i) => {
    if (!used.has(i) && isForceType(item.type)) result.extra.push(item.type)
  })
  return result
}

/** Score: matched forces minus extra ones (never below 0), out of the reference forces. */
export function forceListScore(result: ForceListResult, total: number): number {
  return Math.max(0, result.matched.length - result.extra.length) / Math.max(1, total)
}

function round(value: number): string {
  return String(Number(value.toFixed(1)))
}

export function formatForces(forces: readonly ForceSpec[]): string {
  return forces
    .map(
      (force) =>
        `${force.type} ${round(((force.angle % 360) + 360) % 360)}°${force.magnitude !== undefined ? ` ${round(force.magnitude)} N` : ''}`,
    )
    .join('; ')
}

export function formatForceAnswer(answer: string): string {
  return decodeForceRows(answer)
    .map((row) => [row.type || '—', row.direction || '—', row.magnitude].filter(Boolean).join(' '))
    .join('; ')
}
