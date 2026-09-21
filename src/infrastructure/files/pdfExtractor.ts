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
      const rendered = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!rendered) return null
      return {
        bytes: await rendered.arrayBuffer(),
        mimeType: 'image/png',
        width: canvas.width,
        height: canvas.height,
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

function groupTextItemsIntoLines(items: PdfTextItem[]): string[] {
  const lines: string[] = []
  let current: string[] = []
  let currentY: number | undefined
  for (const item of items) {
    const y = item.transform ? item.transform[5] : undefined
    const str = item.str ?? ''
    if (currentY !== undefined && y !== undefined && Math.abs(currentY - y) > 2) {
      const joined = current.join(' ').replace(/\s+/g, ' ').trim()
      if (joined) lines.push(joined)
      current = []
    }
    if (str) current.push(str)
    if (y !== undefined) currentY = y
  }
  const joined = current.join(' ').replace(/\s+/g, ' ').trim()
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