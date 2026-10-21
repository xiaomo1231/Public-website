/**
 * Mark the quoted evidence of a graded short answer inside the student's own
 * text. Matching uses the grader's comparison form (NFKC, case-folded, no
 * whitespace / punctuation / symbols — see `evidenceKey`), so a quote that the
 * grader accepted is found even across line breaks or spacing differences.
 * Pure; returns the text split into marked and unmarked segments.
 */

export interface HighlightSegment {
  text: string
  mark: boolean
}

const STRIP = /[\s\p{P}\p{S}]+/gu
/** One base character with its combining marks, so NFKC composes them as a whole. */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu

function keyOf(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(STRIP, '')
}

export function highlightEvidence(text: string, evidences: string[]): HighlightSegment[] {
  // The comparison form of `text`, with the source offset of each key character.
  let key = ''
  const starts: number[] = []
  const ends: number[] = []
  for (const match of text.matchAll(CLUSTER)) {
    const piece = keyOf(match[0])
    const at = match.index ?? 0
    for (let i = 0; i < piece.length; i++) {
      starts.push(at)
      ends.push(at + match[0].length)
    }
    key += piece
  }

  const ranges: Array<[number, number]> = []
  for (const evidence of evidences) {
    const needle = keyOf(evidence)
    if (needle.length < 2) continue
    let from = key.indexOf(needle)
    while (from >= 0) {
      ranges.push([starts[from]!, ends[from + needle.length - 1]!])
      from = key.indexOf(needle, from + needle.length)
    }
  }
  if (ranges.length === 0) return text ? [{ text, mark: false }] : []

  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }

  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), mark: false })
    segments.push({ text: text.slice(start, end), mark: true })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mark: false })
  return segments
}
