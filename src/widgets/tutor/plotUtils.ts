import { niceTickStep } from '@/entities/tutorVisualization/linear'

/** Colours, scales and path helpers shared by the subject figures. */

export const AXIS = 'hsl(var(--viz-axis))'
export const GRID = 'hsl(var(--viz-grid))'
export const LABEL = 'hsl(var(--viz-label))'
export const FOREGROUND = 'hsl(var(--foreground))'
export const SERIES = [1, 2, 3, 4].map((slot) => `hsl(var(--viz-series-${slot}))`)
export const SERIES_SOFT = [1, 2, 3, 4].map((slot) => `hsl(var(--viz-series-${slot}) / 0.18)`)

export interface PlotScale {
  sx: (x: number) => number
  sy: (y: number) => number
  left: number
  right: number
  top: number
  bottom: number
}

export function ticks(min: number, max: number, target: number): number[] {
  const step = niceTickStep(max - min, target)
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9 && out.length < 40; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)))
  }
  return out
}

/**
 * A data range that frames the finite values with some padding. Extreme
 * values (asymptotes) are trimmed to the 2nd–98th percentile when they would
 * flatten everything else; `include` values (e.g. 0) are always shown.
 */
export function niceRange(values: number[], include: number[] = [], pad = 0.08): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (finite.length === 0) return [-1, 1]
  let lo = finite[0]!
  let hi = finite[finite.length - 1]!
  const p2 = finite[Math.floor(finite.length * 0.02)]!
  const p98 = finite[Math.ceil(finite.length * 0.98) - 1]!
  const core = p98 - p2
  if (core > 0 && hi - lo > core * 6) {
    lo = p2
    hi = p98
  }
  for (const v of include) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (hi - lo < 1e-12) {
    lo -= 1
    hi += 1
  }
  const margin = (hi - lo) * pad
  return [lo - margin, hi + margin]
}

/** SVG path through the points, broken at non-finite values and off-scale jumps. */
export function linePath(points: Array<{ x: number; y: number }>, scale: PlotScale, yRange: [number, number]): string {
  const span = yRange[1] - yRange[0]
  let d = ''
  let open = false
  for (const p of points) {
    if (!Number.isFinite(p.y) || p.y > yRange[1] + span * 5 || p.y < yRange[0] - span * 5) {
      open = false
      continue
    }
    d += `${open ? 'L' : 'M'} ${scale.sx(p.x).toFixed(2)} ${scale.sy(p.y).toFixed(2)} `
    open = true
  }
  return d.trim()
}
