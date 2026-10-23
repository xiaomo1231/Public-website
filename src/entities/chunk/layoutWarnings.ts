/**
 * Low-confidence layout flags on an extracted chunk.
 *
 * The PDF extractor rebuilds fractions, exponents, tables and matrices from
 * glyph positions only when the geometry is unambiguous. When a region looks
 * like one of these but cannot be rebuilt reliably, the original text is kept
 * unchanged and the chunk carries a flag instead, so the UI can suggest
 * checking that part against the original page (「建议对照原图校对」).
 * The flags never change the text and never block anything.
 */
export type LayoutWarning = 'fraction' | 'table' | 'superscript' | 'matrix' | 'ocr'

/**
 * `ocr`: the page had no text layer (a scan, or glyphs drawn as paths), so
 * the whole text was recognised from a picture of the page — every line is
 * low confidence, not just one region.
 */
export const LAYOUT_WARNINGS: readonly LayoutWarning[] = [
  'fraction',
  'table',
  'superscript',
  'matrix',
  'ocr',
]

/** The distinct, known layout warnings carried by one or more chunks, in a stable order. */
export function layoutWarningsOf(
  chunks:
    | { layoutWarnings?: readonly LayoutWarning[] | undefined }
    | ReadonlyArray<{ layoutWarnings?: readonly LayoutWarning[] | undefined }>,
): LayoutWarning[] {
  const list = Array.isArray(chunks) ? chunks : [chunks]
  const seen = new Set<LayoutWarning>()
  for (const chunk of list as ReadonlyArray<{ layoutWarnings?: readonly LayoutWarning[] }>) {
    for (const warning of chunk.layoutWarnings ?? []) {
      if (LAYOUT_WARNINGS.includes(warning)) seen.add(warning)
    }
  }
  return LAYOUT_WARNINGS.filter((warning) => seen.has(warning))
}

/** True when any of the chunks should be proofread against the original page. */
export function needsVisualProofread(
  chunks:
    | { layoutWarnings?: readonly LayoutWarning[] | undefined }
    | ReadonlyArray<{ layoutWarnings?: readonly LayoutWarning[] | undefined }>,
): boolean {
  return layoutWarningsOf(chunks).length > 0
}

/** Merge two warning lists (deduplicated, stable order); `undefined` when empty. */
export function mergeLayoutWarnings(
  a: readonly LayoutWarning[] | undefined,
  b: readonly LayoutWarning[] | undefined,
): LayoutWarning[] | undefined {
  const merged = layoutWarningsOf([{ layoutWarnings: a }, { layoutWarnings: b }])
  return merged.length > 0 ? merged : undefined
}
