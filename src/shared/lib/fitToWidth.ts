/**
 * Fitting wide reading content (formulas, matrices, tables) to its column
 * without a horizontal scrollbar — the decisions only, as pure functions of
 * measured sizes, so they are testable without a layout engine. The React
 * side (`useFitStage`) measures, asks these what to try next and re-renders
 * until the content fits or no further step is left.
 *
 * Order for a display formula: break it into lines at its top-level relations
 * (when it is clearly too wide and can be broken), then scale it down to a
 * floor, then let KaTeX wrap it at its break points, and only as a last
 * resort keep a horizontal scroll (with a visible hint). Print cannot scroll:
 * there it keeps scaling down to a hard floor instead.
 */

export interface FitMeasurement {
  /** Width the content may take, in px. */
  available: number
  /** Width the content takes now (at the current scale), in px. */
  content: number
}

export interface FitSettings {
  /** Smallest scale before the next strategy (wrap / scroll). */
  minScale: number
  /** Whether a horizontal scroll is allowed as the very last resort (not in print). */
  allowScroll: boolean
}

/** Screen reading: formulas and matrices never shrink below 70%. */
export const SCREEN_FIT: FitSettings = { minScale: 0.7, allowScroll: true }
/** Print: pages cannot scroll, so content scales further instead. */
export const PRINT_FIT: FitSettings = { minScale: 0.7, allowScroll: false }
/** Absolute floor in print, below which text is no longer legible. */
export const HARD_MIN_SCALE = 0.35
/** A formula within 10% of the column is shrunk a little, not broken into lines. */
export const BREAK_BEFORE_SHRINK = 0.9
/** Sub-pixel rounding tolerance. */
const TOLERANCE = 0.5

export function overflows(measurement: FitMeasurement): boolean {
  return measurement.content > measurement.available + TOLERANCE
}

/** The scale (two decimals, rounded down, ≤ 1) at which content of `natural` px fits. */
export function fitRatio(available: number, natural: number): number {
  if (natural <= 0) return 1
  const ratio = Math.floor(((available - 1) / natural) * 100) / 100
  return Math.min(1, Math.max(0, ratio))
}

export interface ScaleStage {
  scale: number
  /** Last resort: a horizontal scroll inside the element. */
  scroll: boolean
}

export const INITIAL_SCALE_STAGE: ScaleStage = { scale: 1, scroll: false }

/**
 * One step of "shrink to fit": the scale that fits when it is above the
 * floor, else (screen) the floor with a scroll, else (print) a smaller scale
 * down to `HARD_MIN_SCALE`. `null` = nothing more to do.
 */
export function shrinkStep(
  stage: ScaleStage,
  measurement: FitMeasurement,
  settings: FitSettings,
): ScaleStage | null {
  if (stage.scroll || !overflows(measurement)) return null
  const needed = fitRatio(measurement.available, measurement.content / stage.scale)
  if (needed >= settings.minScale && needed < stage.scale) return { scale: needed, scroll: false }
  if (settings.allowScroll) return { scale: Math.min(stage.scale, settings.minScale), scroll: true }
  const floor = Math.max(HARD_MIN_SCALE, needed)
  return floor < stage.scale ? { scale: floor, scroll: false } : null
}

export type DisplayVariant = 'natural' | 'broken' | 'wrap'

export interface DisplayStage extends ScaleStage {
  variant: DisplayVariant
  /** For `broken`: the fitting ratio measured on the natural form (sets the line length). */
  budget?: number
}

export const INITIAL_DISPLAY_STAGE: DisplayStage = { variant: 'natural', scale: 1, scroll: false }

/**
 * The next form of a display formula that overflows its column, or `null`
 * when it fits (or nothing is left to try). Each step is tried once, so a
 * formula settles in at most a handful of measurements:
 *
 *   natural → broken (aligned lines) → broken, scaled → wrap → wrap, scaled
 *   → (screen) scroll at the floor / (print) scaled to the hard floor.
 */
export function nextDisplayStage(
  stage: DisplayStage,
  measurement: FitMeasurement,
  options: FitSettings & { breakable: boolean },
): DisplayStage | null {
  if (stage.scroll || !overflows(measurement)) return null
  const ratio = fitRatio(measurement.available, measurement.content / stage.scale)
  const wrap: DisplayStage = { variant: 'wrap', scale: 1, scroll: false }
  if (stage.variant === 'natural' && stage.scale === 1) {
    if (options.breakable && ratio < BREAK_BEFORE_SHRINK) {
      return { variant: 'broken', scale: 1, scroll: false, budget: ratio }
    }
    return ratio >= options.minScale ? { variant: 'natural', scale: ratio, scroll: false } : wrap
  }
  if (stage.variant === 'broken' && stage.scale === 1) {
    return ratio >= options.minScale ? { ...stage, scale: ratio } : wrap
  }
  if (stage.variant !== 'wrap') return wrap
  const next = shrinkStep(stage, measurement, options)
  return next ? { variant: 'wrap', ...next } : null
}

/** Source characters per line for `breakDisplayLatex`, from the measured ratio. */
export function breakBudget(latex: string, ratio: number): number {
  return Math.max(12, Math.floor(latex.trim().length * ratio * 0.95))
}

export type StepPairLayout = 'row' | 'stack'

export interface StepPairStage extends ScaleStage {
  layout: StepPairLayout
}

export const INITIAL_STEP_PAIR_STAGE: StepPairStage = { layout: 'row', scale: 1, scroll: false }

/**
 * A step card's "matrix before → matrix after": side by side while the pair
 * fits, else stacked (arrow pointing down), then the matrices scaled down,
 * then (last resort) a scroll.
 */
export function nextStepPairStage(
  stage: StepPairStage,
  measurement: FitMeasurement,
  settings: FitSettings,
): StepPairStage | null {
  if (!overflows(measurement)) return null
  if (stage.layout === 'row') return { layout: 'stack', scale: 1, scroll: false }
  const next = shrinkStep(stage, measurement, settings)
  return next ? { layout: 'stack', ...next } : null
}

/** Tables shrink less far than formulas: cell text wraps first. */
export const TABLE_MIN_SCALE = 0.75
