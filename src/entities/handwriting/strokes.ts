/**
 * Pen strokes kept next to a rendered writing-area page. The PNG is what the
 * student and the recogniser see; the strokes are kept so the page can be
 * edited again after a reload, and so a stroke-based (online) recogniser —
 * on a future server, or an on-device model — can read the ink with its
 * timing order instead of pixels. Stored on the answer-image row
 * (`HomeworkAnswerImage.strokes`), so nothing new is added to the schema.
 *
 * Compact: points are a flat `[x, y, pressure, …]` list rounded to 0.1 page
 * units and 0.01 pressure.
 */

export interface StoredStroke {
  tool: 'pen' | 'eraser'
  color: string
  width: number
  pressureSensitive: boolean
  /** Flat `[x0, y0, p0, x1, y1, p1, …]` in page units (0–width, 0–height). */
  points: number[]
}

export interface StoredStrokePage {
  v: 1
  width: number
  height: number
  strokes: StoredStroke[]
}

/** Largest stroke list kept per page (a full page of dense writing is far below it). */
export const MAX_STORED_STROKES = 5000
/** Largest number of points kept per stroke. */
export const MAX_STROKE_POINTS = 4000

const round = (value: number, step: number) => Math.round(value / step) * step

/** Turn in-memory strokes (`{x, y, pressure}` points) into the stored form. */
export function storeStrokes(
  strokes: ReadonlyArray<{
    tool: 'pen' | 'eraser'
    color: string
    width: number
    pressureSensitive: boolean
    points: ReadonlyArray<{ x: number; y: number; pressure: number }>
  }>,
  size: { width: number; height: number },
): StoredStrokePage {
  return {
    v: 1,
    width: size.width,
    height: size.height,
    strokes: strokes.slice(0, MAX_STORED_STROKES).map((stroke) => ({
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      pressureSensitive: stroke.pressureSensitive,
      points: stroke.points
        .slice(0, MAX_STROKE_POINTS)
        .flatMap((point) => [
          Number(round(point.x, 0.1).toFixed(1)),
          Number(round(point.y, 0.1).toFixed(1)),
          Number(round(Number.isFinite(point.pressure) ? point.pressure : 0.5, 0.01).toFixed(2)),
        ]),
    })),
  }
}

/**
 * Read stored strokes back (from the database or a restored backup).
 * Anything malformed is dropped rather than drawn wrongly; returns null when
 * the value is not a stroke page at all.
 */
export function readStoredStrokes(value: unknown): StoredStrokePage | null {
  if (!value || typeof value !== 'object') return null
  const page = value as Partial<StoredStrokePage>
  if (page.v !== 1 || !Array.isArray(page.strokes)) return null
  const width = Number(page.width)
  const height = Number(page.height)
  if (!(width > 0) || !(height > 0)) return null
  const strokes: StoredStroke[] = []
  for (const raw of page.strokes.slice(0, MAX_STORED_STROKES)) {
    if (!raw || typeof raw !== 'object') continue
    const stroke = raw as Partial<StoredStroke>
    if (stroke.tool !== 'pen' && stroke.tool !== 'eraser') continue
    if (!Array.isArray(stroke.points) || stroke.points.length < 3) continue
    const points = stroke.points.slice(0, MAX_STROKE_POINTS * 3)
    if (points.length % 3 !== 0 || !points.every((n) => typeof n === 'number' && isFinite(n)))
      continue
    strokes.push({
      tool: stroke.tool,
      color: typeof stroke.color === 'string' ? stroke.color : '#111827',
      width: typeof stroke.width === 'number' && stroke.width > 0 ? stroke.width : 4.5,
      pressureSensitive: stroke.pressureSensitive === true,
      points,
    })
  }
  return { v: 1, width, height, strokes }
}

/** Stored strokes as point objects again (for the pen model). */
export function strokePoints(
  stroke: StoredStroke,
): Array<{ x: number; y: number; pressure: number }> {
  const out = []
  for (let i = 0; i + 2 < stroke.points.length; i += 3)
    out.push({ x: stroke.points[i]!, y: stroke.points[i + 1]!, pressure: stroke.points[i + 2]! })
  return out
}

/** Whether a stored page has visible ink (an eraser alone leaves it blank). */
export function storedPageHasInk(page: StoredStrokePage | null | undefined): boolean {
  return !!page && page.strokes.some((stroke) => stroke.tool === 'pen')
}
