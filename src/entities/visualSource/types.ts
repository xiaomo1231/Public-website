/**
 * Visual sources: figures, diagrams, charts and image-based formulas that were
 * part of the original course material.
 *
 * When a PDF page carries an embedded image and its extracted text is
 * unreliable (Private Use Area glyphs, scrambled tokens), the honest thing to
 * show the student is the original picture — not a broken OCR transcription.
 * A `VisualSource` is that picture plus its provenance. The image bytes live in
 * `visualSourceImages` (IndexedDB), exactly like `documentBlobs`.
 */

export type VisualSourceType =
  | 'diagram'
  | 'chart'
  | 'math_image'
  | 'screenshot'
  | 'illustration'
  | 'table_image'
  | 'unknown'

export interface VisualSource {
  id: string
  projectId: string
  documentId: string
  /** 1-based page (PDF) or slide (PPTX) number. */
  pageNumber: number
  type: VisualSourceType
  /**
   * Semantic caption. It never speculates about what the picture depicts
   * unless that meaning is known from the surrounding text.
   */
  caption: string
  /** Chunks on this page that the visual stands in for. */
  sourceChunkIds: string[]
  /** Mime type of the stored page image. */
  imageMimeType: string
  width?: number
  height?: number
  createdAt: number
}

/** Stored page image bytes, keyed by the owning `VisualSource.id`. */
export interface VisualSourceImageRow {
  id: string
  projectId: string
  bytes: ArrayBuffer
  mimeType: string
}

/** Caption used when nothing reliable is known about the figure. */
export function fallbackVisualCaption(pageNumber: number): string {
  return `Figure from course material, page ${pageNumber}.`
}
