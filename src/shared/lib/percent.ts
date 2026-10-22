/**
 * The one rounding for every mastery / estimate percentage shown in the app,
 * so the same stored value never reads 61% on one page and 62% on another.
 *
 * The ratio is clamped to 0..1 and rounded half-up on its decimal value:
 * `0.615 * 100` is `61.49999…` in floating point, which a bare
 * `Math.round(x * 100)` would show as 61.
 */
export function toPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  const clamped = Math.min(1, Math.max(0, ratio))
  return Math.round(Number((clamped * 100).toPrecision(12)))
}

/** `toPercent` with a trailing `%`. */
export function formatPercent(ratio: number): string {
  return `${toPercent(ratio)}%`
}

/**
 * Mean mastery over the knowledge points that have been practised (at least
 * one attempt); null when none has. Shared by the mastery page, the course
 * home and the dashboard so their averages agree.
 */
export function practicedMasteryAverage(
  rows: ReadonlyArray<{ mastery: number; attempts: number }>,
): number | null {
  const practiced = rows.filter((row) => row.attempts > 0)
  if (practiced.length === 0) return null
  return practiced.reduce((sum, row) => sum + row.mastery, 0) / practiced.length
}
