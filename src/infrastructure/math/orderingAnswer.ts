/**
 * Ordering questions ("put these steps in order"), graded locally.
 *
 * Both the reference and the answer are the items joined by newlines, so the
 * answer reads naturally wherever it is shown (results, mistake book). The
 * score is the longest run of items already in the correct relative order:
 * moving one step to the wrong place costs one point, not the whole question.
 */

export function orderingItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Length of the longest strictly increasing subsequence. */
function longestIncreasing(values: number[]): number {
  const tails: number[] = []
  for (const value of values) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid]! < value) lo = mid + 1
      else hi = mid
    }
    tails[lo] = value
  }
  return tails.length
}

export function scoreOrdering(answer: string, reference: string): { earned: number; total: number } {
  const correct = orderingItems(reference)
  const position = new Map(correct.map((item, index) => [item, index]))
  const seen = new Set<number>()
  const indices: number[] = []
  for (const item of orderingItems(answer)) {
    const index = position.get(item)
    if (index === undefined || seen.has(index)) continue
    seen.add(index)
    indices.push(index)
  }
  return { earned: longestIncreasing(indices), total: correct.length }
}

/**
 * A stable shuffle for display, seeded by the question id, so the order the
 * student starts from is the same on every visit and never the answer itself.
 */
export function shuffledForDisplay(items: string[], seed: string): string[] {
  if (items.length < 2) return [...items]
  let state = 0
  for (const ch of seed) state = (state * 31 + ch.charCodeAt(0)) >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  // Never start from the correct order.
  if (out.every((item, index) => item === items[index])) out.push(out.shift()!)
  return out
}
