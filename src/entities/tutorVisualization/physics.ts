/**
 * Physics figures: free-body diagrams, piecewise motion graphs, thin lens /
 * spherical mirror ray diagrams and series–parallel resistor circuits.
 *
 * The model supplies only what the lesson states (forces with magnitudes and
 * directions, accelerations over time intervals, focal length and object
 * distance, resistances and the source voltage); net force, acceleration,
 * x(t) / v(t), image position and magnification, equivalent resistance and
 * every branch current are computed here.
 */

// --- forces ------------------------------------------------------------------

export interface Force {
  label: string
  magnitude: number
  /** Direction in degrees, counter-clockwise from +x (right). */
  angle: number
}

export interface ForceFacts {
  net: { x: number; y: number; magnitude: number; angle: number }
  balanced: boolean
  /** a = F_net / m, when the mass is known. */
  acceleration?: number
  /** Net force along (up) and perpendicular to an incline, when one is drawn. */
  alongIncline?: number
  perpendicularToIncline?: number
}

const rad = (deg: number) => (deg * Math.PI) / 180

export function forceComponents(force: Force): { x: number; y: number } {
  // cos 90° is 6e-17, not 0: round away floating-point noise.
  const clean = (v: number) => (Math.abs(v) < Math.abs(force.magnitude) * 1e-12 ? 0 : v)
  return { x: clean(force.magnitude * Math.cos(rad(force.angle))), y: clean(force.magnitude * Math.sin(rad(force.angle))) }
}

export function forceFacts(forces: Force[], mass?: number, incline?: number): ForceFacts {
  const x = forces.reduce((sum, f) => sum + forceComponents(f).x, 0)
  const y = forces.reduce((sum, f) => sum + forceComponents(f).y, 0)
  const magnitude = Math.hypot(x, y)
  const scale = forces.reduce((sum, f) => sum + Math.abs(f.magnitude), 0)
  const clean = (v: number) => (Math.abs(v) < scale * 1e-9 ? 0 : v)
  const facts: ForceFacts = {
    net: { x: clean(x), y: clean(y), magnitude: clean(magnitude), angle: (Math.atan2(y, x) * 180) / Math.PI },
    // Balanced within 0.5 % of the forces involved (lesson values are rounded).
    balanced: magnitude <= scale * 0.005,
  }
  if (mass !== undefined && mass > 0) facts.acceleration = facts.balanced ? 0 : magnitude / mass
  if (incline !== undefined) {
    const a = rad(incline)
    facts.alongIncline = clean(x * Math.cos(a) + y * Math.sin(a))
    facts.perpendicularToIncline = clean(-x * Math.sin(a) + y * Math.cos(a))
  }
  return facts
}

// --- motion ------------------------------------------------------------------

export interface MotionSegment {
  /** Seconds. */
  duration: number
  /** m/s², constant over the segment. */
  acceleration: number
}

export interface MotionState {
  t: number
  x: number
  v: number
  a: number
}

/** Position, velocity and acceleration sampled across all segments. */
export function motionSamples(x0: number, v0: number, segments: MotionSegment[], perSegment = 60): MotionState[] {
  const out: MotionState[] = []
  let t0 = 0
  let x = x0
  let v = v0
  for (const segment of segments) {
    for (let i = 0; i <= perSegment; i++) {
      const dt = (segment.duration * i) / perSegment
      out.push({ t: t0 + dt, x: x + v * dt + 0.5 * segment.acceleration * dt * dt, v: v + segment.acceleration * dt, a: segment.acceleration })
    }
    x += v * segment.duration + 0.5 * segment.acceleration * segment.duration ** 2
    v += segment.acceleration * segment.duration
    t0 += segment.duration
  }
  return out
}

export interface MotionFacts {
  duration: number
  displacement: number
  /** Total path length, counting reversals of direction. */
  distance: number
  finalVelocity: number
  averageVelocity: number
  /** Segment boundaries, for drawing. */
  boundaries: number[]
}

export function motionFacts(x0: number, v0: number, segments: MotionSegment[]): MotionFacts {
  let v = v0
  let x = x0
  let distance = 0
  let t = 0
  const boundaries = [0]
  for (const { duration, acceleration } of segments) {
    // Split at the instant the velocity changes sign, where distance turns back.
    const turn = acceleration !== 0 ? -v / acceleration : -1
    const pieces = turn > 0 && turn < duration ? [turn, duration - turn] : [duration]
    let pv = v
    for (const dt of pieces) {
      distance += Math.abs(pv * dt + 0.5 * acceleration * dt * dt)
      pv += acceleration * dt
    }
    x += v * duration + 0.5 * acceleration * duration * duration
    v += acceleration * duration
    t += duration
    boundaries.push(t)
  }
  return { duration: t, displacement: x - x0, distance, finalVelocity: v, averageVelocity: t > 0 ? (x - x0) / t : 0, boundaries }
}

// --- optics ------------------------------------------------------------------

export type OpticalElement = 'converging_lens' | 'diverging_lens' | 'concave_mirror' | 'convex_mirror'

export interface OpticsFacts {
  /** Signed focal length: positive for converging lenses and concave mirrors. */
  focalLength: number
  /** Image distance (real-is-positive); Infinity when the object is at the focal point. */
  imageDistance: number
  magnification: number
  imageHeight: number
  real: boolean
  upright: boolean
  enlarged: boolean
  atInfinity: boolean
}

/** 1/f = 1/d_o + 1/d_i with the real-is-positive convention (lenses and mirrors). */
export function opticsFacts(element: OpticalElement, focalLength: number, objectDistance: number, objectHeight: number): OpticsFacts {
  const f = element === 'converging_lens' || element === 'concave_mirror' ? Math.abs(focalLength) : -Math.abs(focalLength)
  const atInfinity = Math.abs(objectDistance - f) < 1e-9 * Math.max(1, Math.abs(f))
  const imageDistance = atInfinity ? Infinity : 1 / (1 / f - 1 / objectDistance)
  const magnification = atInfinity ? Infinity : -imageDistance / objectDistance
  return {
    focalLength: f,
    imageDistance,
    magnification,
    imageHeight: magnification * objectHeight,
    real: imageDistance > 0,
    upright: magnification > 0,
    enlarged: Math.abs(magnification) > 1,
    atInfinity,
  }
}

// --- circuits ----------------------------------------------------------------

export type CircuitNode =
  | { kind: 'resistor'; label: string; resistance: number }
  | { kind: 'series' | 'parallel'; items: CircuitNode[] }

export const MAX_RESISTORS = 8

export function equivalentResistance(node: CircuitNode): number {
  if (node.kind === 'resistor') return node.resistance
  const values = node.items.map(equivalentResistance)
  return node.kind === 'series' ? values.reduce((a, b) => a + b, 0) : 1 / values.reduce((a, r) => a + 1 / r, 0)
}

export interface ResistorReading {
  label: string
  resistance: number
  voltage: number
  current: number
  power: number
}

/** Voltage, current and power for every resistor, with `voltage` across the network. */
export function solveCircuit(node: CircuitNode, voltage: number): ResistorReading[] {
  const out: ResistorReading[] = []
  const walk = (current: CircuitNode, v: number) => {
    if (current.kind === 'resistor') {
      const i = v / current.resistance
      out.push({ label: current.label, resistance: current.resistance, voltage: v, current: i, power: v * i })
      return
    }
    if (current.kind === 'parallel') {
      for (const item of current.items) walk(item, v)
      return
    }
    const total = equivalentResistance(current)
    for (const item of current.items) walk(item, (v * equivalentResistance(item)) / total)
  }
  walk(node, voltage)
  return out
}

export function countResistors(node: CircuitNode): number {
  return node.kind === 'resistor' ? 1 : node.items.reduce((sum, item) => sum + countResistors(item), 0)
}
