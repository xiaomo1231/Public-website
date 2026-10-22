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
}

/** Loose type for the tesseract.js worker we keep around to terminate. */
interface TesseractWorker {
  recognize: (blob: Blob) => Promise<{ data: { text?: string; confidence?: number } }>
  reinitialize?: (langs: string[], oem?: number) => Promise<unknown>
  terminate: () => Promise<void>
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
      const { data } = await worker!.recognize(blob)
      const raw = (data.text ?? '').trim()
      return {
        text: chinese ? tidyCjkSpacing(raw) : raw,
        confidence: typeof data.confidence === 'number' ? data.confidence : 0,
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
    const { text, confidence } = best
    const warnings: string[] = []
    if (confidence < 60) {
      warnings.push(`Low OCR confidence: ${confidence.toFixed(1)}%`)
    }
    if (looksLikeMath(text)) {
      warnings.push('Image appears to contain math symbols. Verify before relying on OCR text.')
    }
    return { text, confidence, warnings, language: detectLanguage(text) }
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
