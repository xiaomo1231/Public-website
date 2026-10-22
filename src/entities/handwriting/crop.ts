/**
 * 纸上作答 → 拍照上传: a photographed page is cut into regions, and each region
 * is assigned to one question. Rectangles are kept as fractions of the page
 * (0–1), so they survive any display size; pixels are computed only when the
 * crop is cut from the full-resolution photo.
 */

export interface CropRect {
  /** Left / top / width / height as fractions of the page (0–1). */
  x: number
  y: number
  width: number
  height: number
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** The whole page. */
export const FULL_PAGE: CropRect = { x: 0, y: 0, width: 1, height: 1 }

/** Smallest region kept (fraction of the page side): smaller is a stray tap. */
export const MIN_CROP_FRACTION = 0.03

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

/** The rectangle spanned by two points (fractions), clamped to the page. */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): CropRect {
  const x0 = clamp01(Math.min(a.x, b.x))
  const y0 = clamp01(Math.min(a.y, b.y))
  const x1 = clamp01(Math.max(a.x, b.x))
  const y1 = clamp01(Math.max(a.y, b.y))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** A point of a pointer event on an element of size `box`, as page fractions. */
export function pointInBox(
  client: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (!(box.width > 0) || !(box.height > 0)) return { x: 0, y: 0 }
  return {
    x: clamp01((client.x - box.left) / box.width),
    y: clamp01((client.y - box.top) / box.height),
  }
}

export function isUsableCrop(rect: CropRect): boolean {
  return rect.width >= MIN_CROP_FRACTION && rect.height >= MIN_CROP_FRACTION
}

/** The crop in pixels of the full-resolution photo (whole pixels, inside the image). */
export function cropToPixels(rect: CropRect, imageWidth: number, imageHeight: number): PixelRect {
  const x = Math.min(imageWidth - 1, Math.max(0, Math.floor(clamp01(rect.x) * imageWidth)))
  const y = Math.min(imageHeight - 1, Math.max(0, Math.floor(clamp01(rect.y) * imageHeight)))
  const right = Math.max(
    x + 1,
    Math.min(imageWidth, Math.ceil(clamp01(rect.x + rect.width) * imageWidth)),
  )
  const bottom = Math.max(
    y + 1,
    Math.min(imageHeight, Math.ceil(clamp01(rect.y + rect.height) * imageHeight)),
  )
  return { x, y, width: right - x, height: bottom - y }
}

/** One region of one uploaded page given to one question (kept in memory until saved). */
export interface PaperAssignment {
  id: string
  pageIndex: number
  rect: CropRect
  questionId: string
}

/**
 * Per question: how many regions it got. Questions with none are listed so
 * the student can see what is still unassigned (a blank answer is allowed:
 * it is marked unanswered, never guessed).
 */
export function assignmentSummary(
  questionIds: readonly string[],
  assignments: readonly PaperAssignment[],
): { counts: Map<string, number>; unassigned: string[]; unknown: PaperAssignment[] } {
  const known = new Set(questionIds)
  const counts = new Map(questionIds.map((id) => [id, 0]))
  const unknown: PaperAssignment[] = []
  for (const item of assignments) {
    if (!known.has(item.questionId)) {
      unknown.push(item)
      continue
    }
    counts.set(item.questionId, (counts.get(item.questionId) ?? 0) + 1)
  }
  return {
    counts,
    unassigned: questionIds.filter((id) => (counts.get(id) ?? 0) === 0),
    unknown,
  }
}

/** Assignments in the order the question's images should be stored: page, then top to bottom. */
export function orderAssignments(assignments: readonly PaperAssignment[]): PaperAssignment[] {
  return [...assignments].sort(
    (a, b) => a.pageIndex - b.pageIndex || a.rect.y - b.rect.y || a.rect.x - b.rect.x,
  )
}
