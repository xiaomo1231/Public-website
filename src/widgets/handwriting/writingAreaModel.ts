import {
  readStoredStrokes,
  storeStrokes,
  strokePoints,
  type StoredStrokePage,
} from '@/entities/handwriting/strokes'
import { MAX_PAGES, PAGE_HEIGHT, PAGE_WIDTH, pageHasInk, type Stroke } from './strokeModel'

/**
 * 平板手写 writing areas: the pen board's pages ↔ the answer images stored
 * for them (one PNG + strokes per page with ink, `writingPage` = page index).
 */

/** Board pages restored from stored writing-area images (gaps become blank pages). */
export function pagesFromStored(
  images: ReadonlyArray<{ writingPage?: number; strokes?: unknown }>,
): Array<Array<Omit<Stroke, 'id'>>> {
  const pages: Array<Array<Omit<Stroke, 'id'>>> = []
  for (const image of images) {
    const index = image.writingPage
    if (index === undefined || index < 0 || index >= MAX_PAGES) continue
    const stored = readStoredStrokes(image.strokes)
    if (!stored) continue
    // Strokes saved on another page size are scaled onto this one.
    const sx = PAGE_WIDTH / stored.width
    const sy = PAGE_HEIGHT / stored.height
    while (pages.length <= index) pages.push([])
    pages[index] = stored.strokes.map((stroke) => ({
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      pressureSensitive: stroke.pressureSensitive,
      points: strokePoints(stroke).map((point) => ({
        x: point.x * sx,
        y: point.y * sy,
        pressure: point.pressure,
      })),
    }))
  }
  return pages
}

/** Pages to save: every page with visible ink, with its index and stored strokes. */
export function pagesToSave(
  pages: ReadonlyArray<readonly Stroke[]>,
): Array<{ page: number; strokes: StoredStrokePage; source: readonly Stroke[] }> {
  return pages.flatMap((strokes, page) =>
    pageHasInk(strokes)
      ? [
          {
            page,
            strokes: storeStrokes(strokes, { width: PAGE_WIDTH, height: PAGE_HEIGHT }),
            source: strokes,
          },
        ]
      : [],
  )
}

/** Fingerprint of the board's ink, to skip saving when nothing changed. */
export function inkFingerprint(pages: ReadonlyArray<readonly Stroke[]>): string {
  return pages
    .map((strokes) => strokes.map((stroke) => `${stroke.id}:${stroke.points.length}`).join(','))
    .join('|')
}
