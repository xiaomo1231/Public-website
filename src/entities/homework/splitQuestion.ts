/** Split an unusually long multi-part exercise for bounded solution requests. */
export function splitHomeworkSubparts(prompt: string): Array<{ label: string; prompt: string }> {
  const markers = [...prompt.matchAll(/(?:^|\s)\(([a-z])\)\s+/gi)]
  if (markers.length < 2 || markers[0]?.[1]?.toLowerCase() !== 'a' || markers.length > 20) return []
  const stem = prompt.slice(0, markers[0].index).trim()
  if (!stem) return []
  return markers
    .map((marker, index) => {
      const start = marker.index! + marker[0].length
      const end = markers[index + 1]?.index ?? prompt.length
      return {
        label: marker[1]!.toLowerCase(),
        prompt: `${stem}\n\n(${marker[1]}) ${prompt.slice(start, end).trim()}`,
      }
    })
    .filter((part) => part.prompt.length > stem.length + 6)
}

/**
 * The sub-parts of a question for professor-answer generation split per
 * sub-part. More tolerant than `walkthroughSubparts`: lettered parts are kept
 * in printed order even when a letter is skipped or out of sequence
 * (`(a) (b) (c) (d) (l) (e)`), and numbered parts on their own lines
 * (`1. … 2. …`, from 1 in sequence) are recognised too. Fewer than two → none.
 */
export function answerSubparts(prompt: string): WalkthroughSubpart[] {
  const lettered = [...prompt.matchAll(/(?:^|[\s：:；;。])[(（]([a-z])[)）]\s+/gi)]
  const seen = new Set<string>()
  const letters = lettered.filter((marker) => {
    const letter = marker[1]!.toLowerCase()
    if (seen.has(letter)) return false
    seen.add(letter)
    return true
  })
  const markers =
    letters.length >= 2 && letters[0]![1]!.toLowerCase() === 'a'
      ? letters.map((marker) => ({
          index: marker.index!,
          length: marker[0].length,
          label: marker[1]!.toLowerCase(),
        }))
      : numberedMarkers(prompt)
  if (markers.length < 2 || markers.length > 20) return []
  return markers
    .map((marker, index) => ({
      label: marker.label,
      text: prompt
        .slice(marker.index + marker.length, markers[index + 1]?.index ?? prompt.length)
        .trim(),
    }))
    .filter((part) => part.text.length > 0)
}

function numberedMarkers(prompt: string): Array<{ index: number; length: number; label: string }> {
  const out: Array<{ index: number; length: number; label: string }> = []
  for (const match of prompt.matchAll(/(^|\n)[ \t]*(\d{1,2})[.)．][ \t]+/g)) {
    if (Number(match[2]) !== out.length + 1) continue
    const lead = match[1]!.length
    out.push({ index: match.index! + lead, length: match[0].length - lead, label: match[2]! })
  }
  return out
}

export interface WalkthroughSubpart {
  /** `a`, `b`, … */
  label: string
  /** The sub-part's own text (without the shared stem). */
  text: string
}

/** A question longer than this splits with only two sub-parts. */
export const SPLIT_LONG_PROMPT_CHARS = 1_500
/** This many sub-parts split regardless of length. */
export const SPLIT_MIN_PARTS = 3

/**
 * The lettered sub-parts of a question — `(a)`, `(b)` … in order (half- or
 * full-width brackets). Letters must run in sequence from `a`, so an `(x)`
 * inside a formula is not taken for a sub-part. Fewer than two → none.
 */
export function walkthroughSubparts(prompt: string): WalkthroughSubpart[] {
  const markers = [...prompt.matchAll(/(?:^|[\s：:；;。])[(（]([a-z])[)）]\s*/gi)]
  const kept: RegExpMatchArray[] = []
  for (const marker of markers) {
    const letter = marker[1]!.toLowerCase()
    const expected = String.fromCharCode(97 + kept.length)
    if (letter === expected) kept.push(marker)
  }
  if (kept.length < 2 || kept.length > 20) return []
  return kept.map((marker, index) => {
    const start = marker.index! + marker[0].length
    const end = kept[index + 1]?.index ?? prompt.length
    return { label: marker[1]!.toLowerCase(), text: prompt.slice(start, end).trim() }
  })
}

/**
 * Whether the walkthrough writes a question one sub-part per request: three
 * or more sub-parts, or a long question with at least two. (A request that
 * still ends truncated also falls back to splitting, whatever these say.)
 */
export function shouldSplitWalkthrough(
  prompt: string,
  parts: readonly WalkthroughSubpart[] = walkthroughSubparts(prompt),
): boolean {
  if (parts.length >= SPLIT_MIN_PARTS) return true
  return parts.length >= 2 && prompt.length > SPLIT_LONG_PROMPT_CHARS
}
