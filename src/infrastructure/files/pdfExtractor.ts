// The legacy build, deliberately. pdf.js 6's modern build calls very recent
// JavaScript APIs (Map/WeakMap.prototype.getOrInsertComputed, Math.sumPrecise,
// Uint8Array.prototype.toHex / fromBase64, Promise.try, Iterator helpers,
// Set methods) without fallbacks. Where one is missing, font loading fails and
// glyphs such as − Δ π ° and ligatures silently disappear from the text. The
// legacy build ships the upstream core-js polyfills for exactly those APIs in
// both the main-thread bundle and the worker; each is installed only when the
// browser lacks it. See AGENTS.md §5 (pdf.js runtime APIs).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { LayoutWarning } from '@/entities/chunk/layoutWarnings'
import { findRunningLines, looksLikeHeadingLine, runningLineKey } from './headingHeuristics'
import { classifyFontName, type FontEncodingKind } from './fontGlyphs'
import {
  layoutTextItems,
  type FontKindLookup,
  type LaidOutLine,
  type PdfTextItem,
} from './pdfLayout'
// Vite-specific worker URL injection. The `?url` suffix returns the asset URL
// at build time so pdfjs can spawn its worker correctly.
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

export { groupTextItemsIntoLines, layoutTextItems } from './pdfLayout'
export type { PdfTextItem } from './pdfLayout'

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
   * Per line of `text` (split on `
`): the table block it belongs to and
   * any low-confidence layout flags. Absent for pages without either.
   */
  lineFlags?: Array<PageLineFlag | null>
  /**
   * Number of image-painting operators on the page. A non-zero count means the
   * page carries an embedded picture (a Venn diagram, a chart, an image-based
   * formula), which is a signal to preserve the visual rather than trust the
   * extracted text.
   */
  imageCount: number
}

export interface PageLineFlag {
  /** Lines with the same id form one Markdown table. */
  table?: number
  warnings?: LayoutWarning[]
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
/**
 * Free a loaded PDF. `cleanup()` only drops page caches; `destroy()` also
 * releases the document in the worker, so a long upload session does not keep
 * every parsed file alive.
 */
async function releasePdf(pdf: { cleanup(): unknown; destroy?: () => unknown }): Promise<void> {
  try {
    await (typeof pdf.destroy === 'function' ? pdf.destroy() : pdf.cleanup())
  } catch {
    /* already released */
  }
}

type LoadedPdf = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>

/** A PDF parsed once, from which several pages can be rendered. */
export interface PdfPageRenderer {
  render(pageNumber: number, scale?: number): Promise<RenderedPageImage | null>
  close(): Promise<void>
}

/**
 * Parse a PDF once and render any number of its pages. Use this instead of
 * calling `renderPdfPageImage` in a loop — that re-parses the whole file for
 * every page. Returns `null` where no canvas exists (jsdom) or the file cannot
 * be opened; a page that fails to render yields `null` for that page only.
 * Always `close()` the renderer to release the parsed document.
 */
export async function openPdfPageRenderer(blob: Blob): Promise<PdfPageRenderer | null> {
  if (typeof document === 'undefined') return null
  try {
    ensureWorker()
    const arrayBuffer = await blob.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      ...(isTestEnvironment() ? { disableWorker: true } : {}),
    }).promise
    let closed = false
    return {
      render: async (pageNumber, scale = 2) => {
        if (closed) return null
        try {
          return await renderLoadedPage(pdf, pageNumber, scale)
        } catch {
          return null
        }
      },
      close: async () => {
        if (closed) return
        closed = true
        await releasePdf(pdf)
      },
    }
  } catch {
    return null
  }
}

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
      return await renderLoadedPage(pdf, pageNumber, scale, questionRegion)
    } finally {
      await releasePdf(pdf)
    }
  } catch {
    return null
  }
}

async function renderLoadedPage(
  pdf: LoadedPdf,
  pageNumber: number,
  scale: number,
  questionRegion?: { number: string; continuation?: boolean },
): Promise<RenderedPageImage | null> {
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
      const headings = [...rows]
        .map(([y, value]) => ({ y, value: value.trim() }))
        .filter(({ value }) =>
          /(?:problem|question|exercise)\s*\d+\s*[:：.]|第\s*\d+\s*题/i.test(value),
        )
        .sort((a, b) => b.y - a.y)
      const number = questionRegion.number.match(/\d+/)?.[0]
      const marker = number
        ? new RegExp(
            `(?:problem|question|exercise)\\s*${number}\\s*[:：.]|第\\s*${number}\\s*题`,
            'i',
          )
        : undefined
      const ownIndex = marker ? headings.findIndex(({ value }) => marker.test(value)) : -1
      const start =
        !questionRegion.continuation && ownIndex >= 0
          ? Math.max(
              0,
              Math.floor(viewport.convertToViewportPoint(0, headings[ownIndex]!.y)[1] - 32),
            )
          : 0
      const nextHeading = questionRegion.continuation
        ? headings.find(({ value }) => !marker?.test(value))
        : ownIndex >= 0
          ? headings[ownIndex + 1]
          : undefined
      const end = nextHeading
        ? Math.min(
            canvas.height,
            Math.ceil(viewport.convertToViewportPoint(0, nextHeading.y)[1] - 12),
          )
        : canvas.height
      if (
        (ownIndex >= 0 || questionRegion.continuation) &&
        end - start >= 80 &&
        end - start < canvas.height - 40
      ) {
        const cropped = document.createElement('canvas')
        cropped.width = canvas.width
        cropped.height = end - start
        const croppedContext = cropped.getContext('2d')
        if (croppedContext) {
          croppedContext.drawImage(
            canvas,
            0,
            start,
            canvas.width,
            cropped.height,
            0,
            0,
            canvas.width,
            cropped.height,
          )
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
 * Resolve each text item's real font name. pdf.js keeps the base font name
 * (`BCDOEE+SymbolMT`, `Wingdings-Regular`) on the font object in
 * `page.commonObjs` once the page's operator list has loaded the fonts; the
 * text-content `styles` only carry a generic CSS family, used as a fallback.
 * Unknown fonts resolve to `undefined`, which leaves their glyphs untouched.
 */
function fontKindLookup(
  page: { commonObjs?: { has?(id: string): boolean; get?(id: string): unknown } },
  styles: unknown,
): FontKindLookup {
  const cache = new Map<string, FontEncodingKind | undefined>()
  return (fontName) => {
    if (!fontName) return undefined
    if (cache.has(fontName)) return cache.get(fontName)
    let name: string | undefined
    try {
      if (page.commonObjs?.has?.(fontName)) {
        const font = page.commonObjs.get?.(fontName) as { name?: unknown } | undefined
        if (typeof font?.name === 'string') name = font.name
      }
    } catch {
      /* font not resolved on this thread */
    }
    if (!name) {
      const family = (styles as Record<string, { fontFamily?: unknown }> | undefined)?.[fontName]
        ?.fontFamily
      if (typeof family === 'string' && !/^(?:sans-serif|serif|monospace)$/i.test(family))
        name = family
    }
    const kind = classifyFontName(name)
    cache.set(fontName, kind)
    return kind
  }
}

/** A unit / chapter title or a lettered divider ("B/ Observations …"). */
const TITLE_START =
  /^(?:(?:unit|chapter|ch\.|lesson|lecture|module|part|topic)\s+(?:\d{1,3}|[ivxlc]{1,6})\s*[:.\-–—]|[A-Z]\s?\/\s?\S)/i

/**
 * A slide title set over several lines ("Unit 3: Chemical / Equations and /
 * Stoichiometry") becomes one line. Only lines in the same font size that
 * follow directly below are joined, at most three, and never another title,
 * a parenthesised note or a sentence.
 */
export function joinTitleLines(lines: LaidOutLine[]): LaidOutLine[] {
  const out: LaidOutLine[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.table || !TITLE_START.test(line.text) || /[.!?。]$/.test(line.text)) {
      out.push(line)
      continue
    }
    let text = line.text
    let previous = line
    let j = i + 1
    while (j < lines.length && j <= i + 3) {
      const next = lines[j]!
      const sameSize = Math.abs(next.height - line.height) <= line.height * 0.12
      const gap = previous.y !== undefined && next.y !== undefined ? previous.y - next.y : undefined
      if (
        next.table ||
        !sameSize ||
        gap === undefined ||
        gap <= 0 ||
        gap > line.height * 1.6 ||
        next.text.length > 60 ||
        TITLE_START.test(next.text) ||
        /^[(（[]/.test(next.text) ||
        /[.!?。]$/.test(text)
      )
        break
      text = `${text} ${next.text}`
      previous = next
      j++
    }
    // A joined title stays a heading even when it is now longer than a usual one.
    out.push(
      j > i + 1
        ? { ...line, text, ...(looksLikeHeadingLine(line.text) ? { heading: true } : {}) }
        : line,
    )
    i = j - 1
  }
  return out
}

function splitTableRow(row: string): string[] {
  return row
    .replace(/^\|\s?|\s?\|$/g, '')
    .split(/\s?(?<!\\)\|\s?/)
    .map((cell) => cell.replace(/\\\|/g, '|'))
}

function assemblePage(lines: LaidOutLine[]): {
  text: string
  headings: ExtractedPage['headings']
  tables: string[][][]
  lineFlags?: Array<PageLineFlag | null>
} {
  const headings: ExtractedPage['headings'] = []
  const tables: string[][][] = []
  const textLines: string[] = []
  const flags: Array<PageLineFlag | null> = []
  let flagged = false
  for (const line of lines) {
    const parts = line.text.split('\n')
    const tableId = line.table ? tables.length : undefined
    if (line.table) {
      tables.push(parts.filter((_, index) => index !== 1).map(splitTableRow))
    } else if (line.heading || looksLikeHeadingLine(line.text)) {
      headings.push({ text: line.text, level: 1 })
    }
    for (const part of parts) {
      textLines.push(part)
      const flag: PageLineFlag = {
        ...(tableId !== undefined ? { table: tableId } : {}),
        ...(line.warnings?.length ? { warnings: line.warnings } : {}),
      }
      if (tableId !== undefined || line.warnings?.length) flagged = true
      flags.push(Object.keys(flag).length > 0 ? flag : null)
    }
  }
  return {
    text: textLines.join('\n'),
    headings,
    tables,
    ...(flagged ? { lineFlags: flags } : {}),
  }
}

const LETTERED_DIVIDER = /^[A-Z]\s?\/\s?\S.{0,110}$/

/**
 * A slide deck divided into lettered parts ("A/ Elements …", "B/ …") puts each
 * part title on its own divider slide. Such a line is marked as a heading only
 * when it opens a page that carries almost nothing else — an outline slide
 * listing A/–H/ together is not a divider.
 */
function markLetteredDividers(pages: ExtractedPage[], running: Set<string>): void {
  for (const page of pages) {
    const lines = page.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !running.has(runningLineKey(line)))
    if (lines.length === 0 || lines.length > 3) continue
    if (!LETTERED_DIVIDER.test(lines[0]!)) continue
    if (lines.filter((line) => LETTERED_DIVIDER.test(line)).length > 1) continue
    if (!page.headings.some((heading) => heading.text === lines[0])) {
      page.headings.push({ text: lines[0]!, level: 1 })
    }
  }
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
    ...(isTestEnvironment() ? { disableWorker: true, verbosity: 0 } : {}),
  })
  const pdf = await loadingTask.promise
  try {
    return await readPdf(pdf)
  } finally {
    await releasePdf(pdf)
  }
}

async function readPdf(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
): Promise<PdfExtractionResult> {
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
      const fontKind = fontKindLookup(page, textContent.styles)
      const assembled = assemblePage(joinTitleLines(layoutTextItems(items, fontKind)))
      const pageText = assembled.text
      for (const ch of pageText) {
        if (/[\u4e00-\u9fff]/.test(ch)) zhChars++
        else if (/[A-Za-z]/.test(ch)) enChars++
      }
      totalText += pageText.length
      pages.push({
        pageNumber: i,
        text: pageText,
        headings: assembled.headings,
        tables: assembled.tables,
        hasContent: pageText.trim().length > 0,
        imageCount,
        ...(assembled.lineFlags ? { lineFlags: assembled.lineFlags } : {}),
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

  // Running headers and footers (the course title or author on every page)
  // are not headings, however they are set.
  const running = findRunningLines(pages.map((page) => page.text.split('\n')))
  if (running.size > 0) {
    for (const page of pages) {
      page.headings = page.headings.filter((heading) => !running.has(runningLineKey(heading.text)))
    }
  }
  markLetteredDividers(pages, running)

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
