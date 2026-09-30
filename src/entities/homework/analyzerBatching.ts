import type { DocumentChunk } from '@/entities/chunk/types'

/**
 * Bounded batching for the homework analyzer.
 *
 * The analyzer used to receive the *entire* document in a single request. A
 * long assignment then meant a huge input and a long JSON answer, which a
 * non-streaming request cannot finish inside its read budget — the failure the
 * user saw as "AI response timed out". Batches keep every request small; a
 * batch that fails does not take the others down.
 *
 * These are pure functions so the batching rules are testable on their own.
 */

/** Character budget for one batch (chunk text + its label suffix). */
export const ANALYZER_BATCH_CHARS = 6000

/** Hard cap on requests per analysis — never send an unbounded stream. */
export const ANALYZER_MAX_BATCHES = 20

/**
 * Below this many readable characters there is nothing an analyzer can work
 * with; the failure belongs to extraction/OCR, not to the model.
 */
export const MIN_ANALYZER_TEXT_CHARS = 40

export interface AnalyzerBatchPlan {
  batches: DocumentChunk[][]
  /** Chunks beyond the hard cap, left unanalyzed (reported, never sent). */
  droppedChunks: number
}

/**
 * Split chunks into contiguous batches of at most `maxChars` characters, in
 * document order, never exceeding `maxBatches`. A single chunk larger than the
 * budget still gets its own batch (it is never dropped just for being big).
 */
export function planAnalyzerBatches(
  chunks: readonly DocumentChunk[],
  maxChars: number = ANALYZER_BATCH_CHARS,
  maxBatches: number = ANALYZER_MAX_BATCHES,
): AnalyzerBatchPlan {
  const ordered = [...chunks].sort((a, b) => a.order - b.order)
  const batches: DocumentChunk[][] = []
  let current: DocumentChunk[] = []
  let size = 0

  const flush = (): void => {
    if (current.length > 0) {
      batches.push(current)
      current = []
      size = 0
    }
  }

  for (const chunk of ordered) {
    const cost = chunk.text.length + 40
    if (current.length > 0 && size + cost > maxChars) flush()
    if (batches.length >= maxBatches) break
    current.push(chunk)
    size += cost
  }
  flush()

  const placed = batches.reduce((total, batch) => total + batch.length, 0)
  return { batches, droppedChunks: Math.max(0, ordered.length - placed) }
}

/**
 * How many question candidates a raw analyzer payload carries. Tolerates a
 * bare JSON array as well as the documented `{ questions: [...] }` shape, so a
 * shape mismatch is not silently reported as "the assignment has no questions".
 */
/** Remove duplicates by a key, preserving first-seen order. */
export function dedupeByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const k = key(item)
    if (k) {
      if (seen.has(k)) continue
      seen.add(k)
    }
    out.push(item)
  }
  return out
}

export function countCandidateQuestions(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length
  if (raw && typeof raw === 'object') {
    const questions = (raw as { questions?: unknown }).questions
    if (Array.isArray(questions)) return questions.length
  }
  return 0
}
