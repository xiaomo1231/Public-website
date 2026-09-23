/**
 * Responsive geometry for the 2D visualization renderer.
 *
 * The SVG scales to its container, so a fixed wide viewBox would shrink every
 * in-SVG label on a phone (axis ticks, point labels). Instead the viewBox is
 * matched to the measured container width on narrow screens: text keeps its
 * pixel size and fewer axis ticks are drawn so labels never collide.
 */

export interface PlotLayout {
  width: number
  height: number
  pad: { left: number; right: number; top: number; bottom: number }
  /** Narrow layouts use fewer axis ticks so labels never collide. */
  compact: boolean
}

export const WIDE_LAYOUT: PlotLayout = {
  width: 640,
  height: 400,
  pad: { left: 46, right: 16, top: 16, bottom: 30 },
  compact: false,
}

/** Below this container width the wide design would render text too small. */
export const NARROW_THRESHOLD = 560

/**
 * Choose the plot geometry for a measured container width. Zero (before the
 * first measurement, or in environments without ResizeObserver) falls back to
 * the wide design, which is also what tests and SSR-style renders expect.
 */
export function layoutForWidth(measured: number): PlotLayout {
  if (!Number.isFinite(measured) || measured <= 0 || measured >= NARROW_THRESHOLD) {
    return WIDE_LAYOUT
  }
  const width = Math.max(300, Math.min(Math.round(measured), 540))
  return {
    width,
    height: width,
    pad: { left: 42, right: 12, top: 12, bottom: 28 },
    compact: true,
  }
}
