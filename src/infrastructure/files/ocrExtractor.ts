/**
 * OCR extractor backed by Tesseract.js.
 *
 * Loaded lazily because Tesseract.js ships a multi-megabyte WASM bundle.
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

export async function extractOcr(blob: Blob, opts: { languages?: string[] } = {}): Promise<OcrExtractionResult> {
  const languages = opts.languages ?? ['eng']
  let worker: TesseractWorker | null = null
  try {
    const tesseract = (await import('tesseract.js')) as unknown as {
      createWorker: (langs: string[], oem?: number, opts?: unknown) => Promise<TesseractWorker>
    }
    worker = await tesseract.createWorker(languages, 1, {
      // logger: () => undefined, // silence noisy progress logs
    })
    const { data } = await worker.recognize(blob)
    const text = (data.text ?? '').trim()
    const confidence = typeof data.confidence === 'number' ? data.confidence : 0
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