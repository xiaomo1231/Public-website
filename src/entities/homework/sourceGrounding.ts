/**
 * Grounding helpers for the homework analyzer.
 *
 * The analyzer prints every candidate passage with a bracketed label whose
 * first part is the machine-readable id: `[c:<chunkId> · Ch 3 · 3.1 · p12]`.
 * Models copy that first part back (`c:<chunkId>`) or occasionally the whole
 * label, but never guarantee the bare `chunkId`. The old code only accepted the
 * bare id, so a real, correctly-cited answer was thrown away as "sources could
 * not be matched".
 *
 * `parseSourceChunkId` accepts exactly the documented label forms and resolves
 * them ONLY against the closed set of chunks sent in the same batch. It never
 * extracts a UUID from arbitrary prose, never prefix-matches, and never maps an
 * unknown id to a "nearest" chunk. `locateQuestionExcerpt` then finds the part
 * of the chunk that actually belongs to the question, so a passage holding two
 * questions cannot show the previous question's text as the current one's
 * evidence.
 *
 * All pure functions — no storage, no AI — so the rules are directly testable.
 */

/** Common separators inside a label (`[c:id · Ch 3]`). */
const LABEL_SEPARATORS = /[\s·\],;"]+/

/**
 * Resolve one model-supplied value to a real chunk id from `allowed`.
 *
 * Accepted, in order:
 *   1. the bare id (`<chunkId>`),
 *   2. a `c:`-prefixed id (`c:<chunkId>`),
 *   3. a full label, bracketed or not (`[c:<chunkId> · …]`, `c:<chunkId> · …`),
 *      from which only the first token is read.
 *
 * Everything else returns `null` — an invented id, another batch's id, a
 * truncated id (e.g. `c:9f3a…`), a bare number, or prose. Matching is on the
 * whole token (case-insensitive on hex only), never a substring.
 */
export function parseSourceChunkId(
  raw: string,
  allowed: ReadonlySet<string>,
): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (allowed.has(trimmed)) return trimmed

  // Tolerate a label whose brackets are unbalanced (the model truncated one).
  const inner = trimmed.replace(/^\[/, '').replace(/\]$/, '').trim()

  const firstToken = inner.split(LABEL_SEPARATORS, 1)[0] ?? ''
  const candidate = firstToken.startsWith('c:') ? firstToken.slice(2) : firstToken
  if (!candidate) return null
  if (allowed.has(candidate)) return candidate

  // The id is hex; a model uppercasing it is a formatting artefact, not a
  // different id. This is still a whole-token comparison, never a partial one.
  const lower = candidate.toLowerCase()
  for (const id of allowed) {
    if (id.toLowerCase() === lower) return id
  }
  return null
}

/** Resolve a list of model-supplied values, keeping order and dropping dups. */
export function resolveSourceChunkIds(
  values: readonly string[],
  allowed: ReadonlySet<string>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const id = parseSourceChunkId(value, allowed)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

interface NormalizedText {
  text: string
  /** `map[i]` is the original index of `text[i]`. */
  map: number[]
}

/** Lower-case, collapse whitespace, and remember where each kept char came from. */
function normalizeWithMap(input: string): NormalizedText {
  let text = ''
  const map: number[] = []
  let pendingSpace = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!
    if (/\s/.test(ch)) {
      pendingSpace = text.length > 0
      continue
    }
    if (pendingSpace) {
      text += ' '
      map.push(i)
      pendingSpace = false
    }
    text += ch.toLowerCase()
    map.push(i)
  }
  return { text, map }
}

/** Longest alphanumeric / CJK run, used as a fallback probe. */
function longestToken(normalized: string): string {
  let best = ''
  for (const token of normalized.split(/[^a-z0-9\u4e00-\u9fff]+/)) {
    if (token.length > best.length) best = token
  }
  return best
}

function sliceByNormalized(
  chunk: NormalizedText,
  chunkText: string,
  startIndex: number,
  length: number,
): string {
  const start = chunk.map[startIndex]!
  const endIndex = Math.min(startIndex + length - 1, chunk.map.length - 1)
  const end = chunk.map[endIndex]! + 1
  return chunkText.slice(start, end).trim()
}

/** Extend a window to the next line break so the quote does not bleed into the next question. */
function sliceToBoundary(chunkText: string, start: number, minEnd: number, maxEnd: number): string {
  for (let i = minEnd; i < maxEnd; i += 1) {
    if (chunkText[i] === '\n') return chunkText.slice(start, i).trim()
  }
  return chunkText.slice(start, maxEnd).trim()
}

/**
 * Locate the span of `chunkText` that corresponds to `prompt`.
 *
 * Returns the verbatim slice, or `null` when the question text cannot be found
 * in this chunk (the caller must then show page + source entry and mark the
 * excerpt as pending rather than showing a neighbouring question).
 */
export function locateQuestionExcerpt(chunkText: string, prompt: string, number?: string): string | null {
  const chunk = normalizeWithMap(chunkText)
  const normalizedPrompt = normalizeWithMap(prompt).text.trim()
  if (!chunk.text || !normalizedPrompt) return null

  const fullMatch = chunk.text.indexOf(normalizedPrompt)
  if (fullMatch >= 0) {
    return sliceByNormalized(chunk, chunkText, fullMatch, normalizedPrompt.length)
  }

  const prefix = normalizedPrompt.slice(0, Math.min(60, normalizedPrompt.length))
  const probe = prefix.length >= 12 ? prefix : longestToken(normalizedPrompt)
  if (probe.length < 6) return null

  const index = chunk.text.indexOf(probe)
  if (index < 0) {
    // PDF extraction often splits formulas into separate lines, while the AI
    // joins them into one sentence. A printed problem number is stronger
    // evidence than a generic token from a neighbouring question.
    const digits = number?.match(/\d+/)?.[0]
    if (!digits) return null
    const marker = new RegExp(`(?:^|\\n)\\s*(?:problem|question|exercise|题)\\s*${digits}\\s*[:：.、)]`, 'im')
    const match = marker.exec(chunkText)
    if (!match) return null
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0)
    const rest = chunkText.slice(start)
    const next = /\n\s*(?:problem|question|exercise|题)\s*\d+\s*[:：.、)]/im.exec(rest.slice(1))
    return rest.slice(0, Math.min(next ? next.index + 1 : rest.length, 1200)).trim() || null
  }

  const start = chunk.map[index]!
  const probeEndIndex = Math.min(index + probe.length - 1, chunk.map.length - 1)
  const minEnd = chunk.map[probeEndIndex]! + 1
  const maxEnd = Math.min(chunkText.length, start + normalizedPrompt.length + 80)
  return sliceToBoundary(chunkText, start, minEnd, maxEnd)
}
