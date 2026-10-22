/**
 * OCR extractor backed by Tesseract.js.
 *
 * Loaded lazily because Tesseract.js ships a multi-megabyte WASM bundle.
 *
 * Where the engine comes from: tesseract.js's defaults are used, so the worker
 * script, the WASM core and the trained language data (`eng`, and `chi_sim`
 * for Chinese pages) are downloaded from cdn.jsdelivr.net on first use and
 * cached by tesseract.js in IndexedDB. Only these engine files are fetched —
 * the image itself is recognised in the browser and never uploaded.
 * All failures surface as either:
 *  - thrown exceptions (extractor level)
 *  - warnings + low confidence (result level)
 */

export interface OcrExtractionResult {
  text: string
  confidence: number
  warnings: string[]
  language: 'zh' | 'en' | 'mixed' | 'unknown'
  /**
   * The picture looks like a photographed, hand-written or marked page
   * (pencil working, ticks, red ink): the recognised text may be unreliable.
   * Text such as isotope / charge notation (`54Cr6+`) is never rewritten.
   */
  handwriting?: boolean
}

/** The word-level part of a tesseract.js result we read. */
export interface OcrWord {
  text: string
  confidence: number
}

interface OcrBlocks {
  paragraphs?: Array<{ lines?: Array<{ words?: OcrWord[] }> }>
}

/** Loose type for the tesseract.js worker we keep around to terminate. */
interface TesseractWorker {
  recognize: (
    blob: Blob,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ) => Promise<{ data: { text?: string; confidence?: number; blocks?: OcrBlocks[] | null } }>
  reinitialize?: (langs: string[], oem?: number) => Promise<unknown>
  terminate: () => Promise<void>
}

/** Words below this tesseract confidence are treated as unreliable. */
const LOW_WORD_CONFIDENCE = 50
/** Share of strongly red pixels above which the page is taken to carry red ink. */
const RED_INK_RATIO = 0.003

/**
 * Does this OCR result look like a photographed exam with hand-writing or
 * marking on it? Printed text is read with consistently high per-word
 * confidence; pencil working, ticks and crosses come out as many short,
 * low-confidence "words". Red ink (a marker's pen) lowers the bar. Needs at
 * least eight real words to say anything.
 */
export function looksLikeHandwritingNoise(input: {
  words: readonly OcrWord[]
  confidence: number
  redInkRatio?: number
}): boolean {
  const words = input.words.filter((word) => (word.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2)
  if (words.length < 8) return false
  const low = words.filter((word) => word.confidence < LOW_WORD_CONFIDENCE).length / words.length
  const redInk = (input.redInkRatio ?? 0) >= RED_INK_RATIO
  return low >= 0.3 || (redInk && (low >= 0.12 || input.confidence < 75))
}

function wordsOf(blocks: OcrBlocks[] | null | undefined): OcrWord[] {
  const out: OcrWord[] = []
  for (const block of blocks ?? [])
    for (const paragraph of block.paragraphs ?? [])
      for (const line of paragraph.lines ?? [])
        for (const word of line.words ?? [])
          if (typeof word.text === 'string' && typeof word.confidence === 'number') out.push(word)
  return out
}

/**
 * Share of strongly red pixels in the picture (a marker's red pen), sampled on
 * a small copy. Browser-only: returns `undefined` where images cannot be
 * decoded or drawn (tests, old browsers), which simply skips the signal.
 */
export async function estimateRedInkRatio(blob: Blob): Promise<number | undefined> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined')
      return undefined
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const { data } = context.getImageData(0, 0, width, height)
    let red = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      if (r > 150 && r - g > 70 && r - b > 70) red++
    }
    return red / (width * height)
  } catch {
    return undefined
  }
}

const ZH_RANGE = /[\u4e00-\u9fff]/
const EN_RANGE = /[A-Za-z]/

function detectLanguage(text: string): 'zh' | 'en' | 'mixed' | 'unknown' {
  let zh = 0
  let en = 0
  for (const ch of text) {
    if (ZH_RANGE.test(ch)) zh++
    else if (EN_RANGE.test(ch)) en++
  }
  if (zh === 0 && en === 0) return 'unknown'
  if (zh > en * 2) return 'zh'
  if (en > zh * 2) return 'en'
  return 'mixed'
}

function looksLikeMath(text: string): boolean {
  // crude math heuristic: presence of math symbols without surrounding letters
  const mathSymbols = /[∂∇∫∑√πλμσ≈≠≤≥±×÷∞]/
  return mathSymbols.test(text)
}

/** Tesseract language sets. Both are trained data from the same source. */
export const OCR_ENGLISH = ['eng'] as const
export const OCR_CHINESE = ['chi_sim', 'eng'] as const

/** True when the text contains CJK ideographs (used as a language hint). */
export function hasCjk(text: string | undefined): boolean {
  return Boolean(text && /[\u3400-\u9fff]/.test(text))
}

/** An English pass below this confidence is retried with Chinese + English. */
const RETRY_CONFIDENCE = 70

/** Tesseract (chi_sim) puts spaces between CJK characters; remove them. */
export function tidyCjkSpacing(text: string): string {
  return text.replace(
    /([\u3000-\u303f\u3400-\u9fff\uff00-\uffef])[ \t]+(?=[\u3000-\u303f\u3400-\u9fff\uff00-\uffef])/g,
    '$1',
  )
}

/**
 * True when an English-only pass probably misread a non-Latin (e.g. Chinese)
 * page: low confidence, or text that is mostly stray symbols / one-letter
 * fragments rather than words.
 */
export function looksLikeMisreadScript(text: string, confidence: number): boolean {
  if (confidence < RETRY_CONFIDENCE) return true
  const compact = text.replace(/\s/g, '')
  if (compact.length < 4) return false
  const letters = (compact.match(/[A-Za-z0-9]/g) ?? []).length
  if (letters / compact.length < 0.6) return true
  const tokens = text.split(/\s+/).filter(Boolean)
  const fragments = tokens.filter((token) => token.replace(/[^A-Za-z]/g, '').length <= 1).length
  return tokens.length >= 6 && fragments / tokens.length > 0.5
}

interface Recognized {
  text: string
  confidence: number
  words: OcrWord[]
}

/**
 * OCR an image.
 *
 * Language choice: with `preferChinese` (the file / course name is Chinese) the
 * page is read once with Chinese + English. Otherwise it is read with English
 * first and — only when that result looks misread (low confidence or mostly
 * symbols) — read again with Chinese + English, keeping whichever pass is more
 * confident. Explicit `languages` skips both rules. One worker is used and
 * always terminated.
 */
export async function extractOcr(
  blob: Blob,
  opts: { languages?: string[]; preferChinese?: boolean } = {},
): Promise<OcrExtractionResult> {
  const first = opts.languages ?? [...(opts.preferChinese ? OCR_CHINESE : OCR_ENGLISH)]
  const canRetry = !opts.languages && !opts.preferChinese
  let worker: TesseractWorker | null = null
  try {
    const tesseract = (await import('tesseract.js')) as unknown as {
      createWorker: (langs: string[], oem?: number, opts?: unknown) => Promise<TesseractWorker>
    }
    worker = await tesseract.createWorker(first, 1, {})
    const read = async (chinese: boolean): Promise<Recognized> => {
      // `blocks` gives per-word confidence, used to spot hand-writing.
      const { data } = await worker!.recognize(blob, {}, { text: true, blocks: true })
      const raw = (data.text ?? '').trim()
      return {
        text: chinese ? tidyCjkSpacing(raw) : raw,
        confidence: typeof data.confidence === 'number' ? data.confidence : 0,
        words: wordsOf(data.blocks),
      }
    }
    let best = await read(first.includes('chi_sim'))
    if (canRetry && looksLikeMisreadScript(best.text, best.confidence)) {
      if (typeof worker.reinitialize === 'function') {
        await worker.reinitialize([...OCR_CHINESE], 1)
      } else {
        await worker.terminate().catch(() => undefined)
        worker = await tesseract.createWorker([...OCR_CHINESE], 1, {})
      }
      const chinese = await read(true)
      if (chinese.text && chinese.confidence > best.confidence) best = chinese
    }
    const { text, confidence, words } = best
    const warnings: string[] = []
    if (confidence < 60) {
      warnings.push(`Low OCR confidence: ${confidence.toFixed(1)}%`)
    }
    if (looksLikeMath(text)) {
      warnings.push('Image appears to contain math symbols. Verify before relying on OCR text.')
    }
    const handwriting = looksLikeHandwritingNoise({
      words,
      confidence,
      redInkRatio: await estimateRedInkRatio(blob),
    })
    return {
      text,
      confidence,
      warnings,
      language: detectLanguage(text),
      ...(handwriting ? { handwriting } : {}),
    }
  } catch (err) {
    throw new Error(`OCR failed: ${(err as Error).message}`)
  } finally {
    try {
      await worker?.terminate()
    } catch {
      /* ignore */
    }
  }
}
