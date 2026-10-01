import * as pdfjsLib from 'pdfjs-dist'
// Vite-specific worker URL injection. The `?url` suffix returns the asset URL
// at build time so pdfjs can spawn its worker correctly.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let configured = false

function isTestEnvironment(): boolean {
  // Vitest sets MODE=test. Detect that to skip the worker in tests.
  try {
    return typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test'
  } catch {
    return false
  }
}

function ensureWorker(): void {
  if (configured) return
  if (isTestEnvironment()) {
    // pdfjs 6 can't spawn its bundled worker from the path Vitest resolves;
    // skip the worker and parse on the main thread instead.
    try {
      ;(pdfjsLib.GlobalWorkerOptions as { workerSrc: string | null }).workerSrc = ''
    } catch {
      /* ignore */
    }
    configured = true
    return
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  configured = true
}

/**
 * Structural type for an item returned from `page.getTextContent().items`.
 * pdfjs-dist v6 doesn't export the type alias directly, so we declare the
 * minimum surface we need.
 */
interface PdfTextItem {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

function isTextItem(it: unknown): it is PdfTextItem {
  return Boolean(it) && typeof (it as { str?: unknown }).str === 'string'
}

export interface ExtractedPage {
  pageNumber: number
  text: string
  headings: Array<{ text: string; level: number }>
  tables: string[][][]
  hasContent: boolean
  /**
   * Number of image-painting operators on the page. A non-zero count means the
   * page carries an embedded picture (a Venn diagram, a chart, an image-based
   * formula), which is a signal to preserve the visual rather than trust the
   * extracted text.
   */
  imageCount: number
}

export interface RenderedPageImage {
  bytes: ArrayBuffer
  mimeType: string
  width: number
  height: number
}

let imageOperatorsCache: ReadonlySet<number> | null = null

/**
 * pdf.js image-painting operators, resolved lazily.
 *
 * Lazy + guarded on purpose: tests replace `pdfjs-dist` with a partial mock
 * that has no `OPS`, and touching a missing export throws. A missing enum must
 * degrade to "no image detection", never crash the page.
 */
function imageOperators(): ReadonlySet<number> {
  if (imageOperatorsCache) return imageOperatorsCache
  let operators = new Set<number>()
  try {
    const ops = (pdfjsLib as unknown as { OPS?: Record<string, number> }).OPS
    if (ops) {
      operators = new Set(
        [
          ops.paintImageXObject,
          ops.paintInlineImageXObject,
          ops.paintImageMaskXObject,
          ops.paintImageXObjectRepeat,
          ops.paintImageMaskXObjectRepeat,
          ops.paintSolidColorImageMask,
        ].filter((op): op is number => typeof op === 'number'),
      )
    }
  } catch {
    /* mocked pdfjs without OPS */
  }
  imageOperatorsCache = operators
  return operators
}

/**
 * Render one page to a PNG. Browser-only: it needs a real 2D canvas, so it
 * returns `null` in environments without one (including jsdom) and callers must
 * treat that as "no image available", never as an error.
 */
export async function renderPdfPageImage(
  blob: Blob,
  pageNumber: number,
  scale = 2,
  questionRegion?: { number: string; continuation?: boolean },
): Promise<RenderedPageImage | null> {
  if (typeof document === 'undefined') return null
  try {
    ensureWorker()
    const arrayBuffer = await blob.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      ...(isTestEnvironment() ? { disableWorker: true } : {}),
    }).promise
    try {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) return null
      await page.render({ canvas, canvasContext: context, viewport }).promise
      let output = canvas
      if (questionRegion) {
        try {
          const content = await page.getTextContent()
          const items = (content.items as unknown[]).filter(isTextItem)
          const rows = new Map<number, string>()
          for (const item of items) {
            const y = item.transform?.[5]
            if (y === undefined) continue
            const key = Math.round(y / 3) * 3
            rows.set(key, `${rows.get(key) ?? ''} ${item.str ?? ''}`)
          }
          const headings = [...rows].map(([y, value]) => ({ y, value: value.trim() }))
            .filter(({ value }) => /(?:problem|question|exercise)\s*\d+\s*[:：.]|第\s*\d+\s*题/i.test(value))
            .sort((a, b) => b.y - a.y)
          const number = questionRegion.number.match(/\d+/)?.[0]
          const marker = number ? new RegExp(`(?:problem|question|exercise)\\s*${number}\\s*[:：.]|第\\s*${number}\\s*题`, 'i') : undefined
          const ownIndex = marker ? headings.findIndex(({ value }) => marker.test(value)) : -1
          const start = !questionRegion.continuation && ownIndex >= 0
            ? Math.max(0, Math.floor(viewport.convertToViewportPoint(0, headings[ownIndex]!.y)[1] - 32))
            : 0
          const nextHeading = questionRegion.continuation
            ? headings.find(({ value }) => !marker?.test(value))
            : ownIndex >= 0 ? headings[ownIndex + 1] : undefined
          const end = nextHeading
            ? Math.min(canvas.height, Math.ceil(viewport.convertToViewportPoint(0, nextHeading.y)[1] - 12))
            : canvas.height
          if ((ownIndex >= 0 || questionRegion.continuation) && end - start >= 80 && end - start < canvas.height - 40) {
            const cropped = document.createElement('canvas')
            cropped.width = canvas.width
            cropped.height = end - start
            const croppedContext = cropped.getContext('2d')
            if (croppedContext) {
              croppedContext.drawImage(canvas, 0, start, canvas.width, cropped.height, 0, 0, canvas.width, cropped.height)
              output = cropped
            }
          }
        } catch {
          // A missing or unusual text layer must never hide the original page.
        }
      }
      const rendered = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
      if (!rendered) return null
      return {
        bytes: await rendered.arrayBuffer(),
        mimeType: 'image/png',
        width: output.width,
        height: output.height,
      }
    } finally {
      await pdf.cleanup()
    }
  } catch {
    return null
  }
}

export interface PdfExtractionResult {
  pageCount: number
  pages: ExtractedPage[]
  metadata: {
    title?: string
    author?: string
    subject?: string
    producer?: string
    creator?: string
    creationDate?: number
    modificationDate?: number
    language?: 'zh' | 'en' | 'mixed' | 'unknown'
  }
  textLength: number
  warnings: string[]
}

/**
 * Heuristic heading detection: a short line (< 80 chars) that either ends
 * without sentence punctuation, or is in all caps with mostly letters.
 */
function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > 80) return false
  if (/[.!?。！？]$/.test(trimmed)) return false
  if (/^[\d\s.\-—()()]+$/.test(trimmed)) return false
  // Lines that look like "Chapter 1: Derivatives" — short, contain a digit,
  // start with capitalised word(s).
  if (/^Chapter\s+\d+/i.test(trimmed)) return true
  if (/^Section\s+\d+/i.test(trimmed)) return true
  if (/^Lecture\s+\d+/i.test(trimmed)) return true
  // All-caps short line.
  if (/^[A-Z0-9 \-:&/]{4,}$/.test(trimmed) && /[A-Z]/.test(trimmed)) return true
  if (/^第[一二三四五六七八九十百千零0-9]+[章篇部分单元]/.test(trimmed)) return true
  return false
}

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
}
const SUBSCRIPT_DIGITS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
}

function itemHeight(item: PdfTextItem): number {
  const height = item.height ?? Math.abs(item.transform?.[3] ?? 0)
  return height > 2 ? height : 12
}

/** Some PDFs paint a combining vector arrow before the letter it sits over.
 * pdf.js follows paint order, so move only a geometrically overlapping arrow
 * after its single-letter base. The original page remains the authority. */
function orderVectorMarks(items: PdfTextItem[]): PdfTextItem[] {
  const ordered = [...items]
  for (let index = 0; index < ordered.length; index++) {
    const mark = ordered[index]
    if (mark?.str !== '\u20d7') continue
    let baseIndex = index + 1
    while (ordered[baseIndex]?.str?.trim() === '') baseIndex++
    const base = ordered[baseIndex]
    const markX = mark.transform?.[4]
    const baseX = base?.transform?.[4]
    const markY = mark.transform?.[5]
    const baseY = base?.transform?.[5]
    if (!base || !/^[A-Za-z]$/.test(base.str ?? '') ||
      markX === undefined || baseX === undefined || base.width === undefined ||
      markY === undefined || baseY === undefined ||
      Math.abs(markY - baseY) > itemHeight(base) * 0.3 ||
      markX < baseX - 1 || markX > baseX + base.width + 1) continue
    ordered.splice(index, 1)
    ordered.splice(baseIndex, 0, mark)
    index = baseIndex
  }
  return ordered
}

/**
 * PDF text items for a raised/lowered math glyph have a different baseline.
 * A fixed two-pixel line threshold treated R² and v₁ as three separate lines.
 * Join only items whose baselines fit inside the larger glyph's own height;
 * ordinary lines keep their original breaks. Geometry is evidence for a digit
 * script, but never for inventing a missing symbol or changing a coefficient.
 */
export function groupTextItemsIntoLines(items: PdfTextItem[]): string[] {
  const lines: string[] = []
  let current = ''
  let baselineY: number | undefined
  let baselineHeight = 12
  let previous: PdfTextItem | undefined
  for (const item of orderVectorMarks(items)) {
    const y = item.transform ? item.transform[5] : undefined
    const str = item.str ?? ''
    if (!str) continue
    const height = itemHeight(item)
    if (
      baselineY !== undefined && y !== undefined &&
      Math.abs(baselineY - y) > Math.max(2, Math.max(baselineHeight, height) * 0.55)
    ) {
      const joined = current.replace(/\s+/g, ' ').trim()
      if (joined) lines.push(joined)
      current = ''
      baselineY = undefined
      previous = undefined
    }
    const x = item.transform?.[4]
    const previousEnd = previous?.transform?.[4] !== undefined && previous.width !== undefined
      ? previous.transform[4]! + previous.width
      : undefined
    const closeToPrevious = x !== undefined && previousEnd !== undefined &&
      x >= previousEnd - 1 && x - previousEnd < baselineHeight * 0.45
    const scriptOffset = Math.max(0.8, baselineHeight * 0.12)
    const raised = y !== undefined && baselineY !== undefined &&
      y - baselineY > scriptOffset && height < baselineHeight * 0.85
    const lowered = y !== undefined && baselineY !== undefined &&
      baselineY - y > scriptOffset && height < baselineHeight * 0.85
    const script = closeToPrevious && /^\d+$/.test(str.trim())
      ? raised ? SUPERSCRIPT_DIGITS : lowered ? SUBSCRIPT_DIGITS : undefined
      : undefined
    if (script) {
      current = current.trimEnd() + [...str.trim()].map((digit) => script[digit]).join('')
    } else if (!current) {
      current = str
    } else {
      const gap = x !== undefined && previousEnd !== undefined ? x - previousEnd : undefined
      const separator = /\s$/.test(current) || /^\s/.test(str) ||
        (gap !== undefined && gap < Math.min(baselineHeight, height) * 0.18) ? '' : ' '
      current += separator + str
    }
    if (y !== undefined && (baselineY === undefined || height > baselineHeight)) {
      baselineY = y
      baselineHeight = height
    }
    previous = item
  }
  const joined = current.replace(/\s+/g, ' ').trim()
  if (joined) lines.push(joined)
  return lines
}

/**
 * Extract content from a PDF Blob.
 * Streams page-by-page so we can stop early on error and keep memory bounded.
 */
export async function extractPdf(blob: Blob): Promise<PdfExtractionResult> {
  ensureWorker()
  const arrayBuffer = await blob.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    // In tests we run on the main thread because pdfjs can't spawn its
    // worker from the Vitest module resolution.
    ...(isTestEnvironment() ? { disableWorker: true } : {}),
  })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages
  const pages: ExtractedPage[] = []
  const warnings: string[] = []
  let totalText = 0
  let zhChars = 0
  let enChars = 0

  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await pdf.getPage(i)
      // Best-effort image detection. A failure here must not fail the page:
      // the text extraction below is what the pipeline depends on.
      let imageCount = 0
      try {
        const operators = imageOperators()
        if (operators.size > 0) {
          const ops = await page.getOperatorList()
          for (const fn of ops.fnArray) {
            if (operators.has(fn)) imageCount++
          }
        }
      } catch {
        /* image detection is optional */
      }
      const textContent = await page.getTextContent()
      const items = (textContent.items as unknown[]).filter(isTextItem)
      const lines = groupTextItemsIntoLines(items)
      const headings: ExtractedPage['headings'] = []
      let pageText = ''
      for (const line of lines) {
        if (looksLikeHeading(line)) headings.push({ text: line, level: 1 })
        pageText += (pageText ? '\n' : '') + line
        for (const ch of line) {
          if (/[\u4e00-\u9fff]/.test(ch)) zhChars++
          else if (/[A-Za-z]/.test(ch)) enChars++
        }
      }
      totalText += pageText.length
      pages.push({
        pageNumber: i,
        text: pageText,
        headings,
        tables: [],
        hasContent: pageText.trim().length > 0,
        imageCount,
      })
      page.cleanup()
    } catch (err) {
      warnings.push(`Page ${i} extraction failed: ${(err as Error).message}`)
      pages.push({
        pageNumber: i,
        text: '',
        headings: [],
        tables: [],
        hasContent: false,
        imageCount: 0,
      })
    }
  }

  let metadata: PdfExtractionResult['metadata'] = {}
  try {
    const meta = await pdf.getMetadata()
    const info = (meta.info ?? {}) as Record<string, string>
    metadata = {
      title: info.Title || undefined,
      author: info.Author || undefined,
      subject: info.Subject || undefined,
      producer: info.Producer || undefined,
      creator: info.Creator || undefined,
    }
    const parseDate = (raw?: string): number | undefined => {
      if (!raw) return undefined
      const parsed = Date.parse(raw.replace(/^D:/, '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
      return Number.isNaN(parsed) ? undefined : parsed
    }
    metadata.creationDate = parseDate(info.CreationDate)
    metadata.modificationDate = parseDate(info.ModDate)
  } catch (err) {
    warnings.push(`Metadata extraction failed: ${(err as Error).message}`)
  }

  await pdf.cleanup()

  const language: 'zh' | 'en' | 'mixed' | 'unknown' =
    zhChars === 0 && enChars === 0
      ? 'unknown'
      : zhChars > enChars * 2
        ? 'zh'
        : enChars > zhChars * 2
          ? 'en'
          : 'mixed'

  return {
    pageCount,
    pages,
    metadata: { ...metadata, language },
    textLength: totalText,
    warnings,
  }
}
