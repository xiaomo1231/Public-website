/**
 * Find a passage again after the page re-renders.
 *
 * A passage is stored as its text plus a little text either side, measured in
 * the same "concatenated text nodes" string a DOM Range reports. To locate it
 * we search that string again and, when the passage occurs more than once,
 * prefer the occurrence whose surroundings match best. Positions are never
 * stored, so a regenerated document still finds an unchanged sentence.
 */

export interface TextAnchor {
  text: string
  prefix: string
  suffix: string
}

export const ANCHOR_CONTEXT_CHARS = 32

/** The text of `root` exactly as `Range.toString()` would report it. */
export function textOf(root: Node): string {
  let out = ''
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out += (node as Text).data
  return out
}

/** Describe `range` (inside `root`) as a text anchor. */
export function describeAnchor(root: Node, range: Range): TextAnchor | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const before = root.ownerDocument!.createRange()
  before.setStart(root, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  const text = range.toString()
  if (!text.trim()) return null
  const full = textOf(root)
  return {
    text,
    prefix: full.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
    suffix: full.slice(start + text.length, start + text.length + ANCHOR_CONTEXT_CHARS),
  }
}

function sharedSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1
  return n
}

function sharedPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1
  return n
}

/** Offset of the best occurrence of the anchor in `full`, or -1. */
export function findAnchorOffset(full: string, anchor: TextAnchor): number {
  if (!anchor.text) return -1
  let best = -1
  let bestScore = -1
  for (let at = full.indexOf(anchor.text); at >= 0; at = full.indexOf(anchor.text, at + 1)) {
    const score =
      sharedSuffix(full.slice(Math.max(0, at - anchor.prefix.length), at), anchor.prefix) +
      sharedPrefix(
        full.slice(at + anchor.text.length, at + anchor.text.length + anchor.suffix.length),
        anchor.suffix,
      )
    if (score > bestScore) {
      best = at
      bestScore = score
    }
  }
  return best
}

/** A live Range for the anchor inside `root`, or null when the text is gone. */
export function locateAnchor(root: Node, anchor: TextAnchor): Range | null {
  const full = textOf(root)
  const start = findAnchorOffset(full, anchor)
  if (start < 0) return null
  const end = start + anchor.text.length
  const range = root.ownerDocument!.createRange()
  let offset = 0
  let started = false
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).data.length
    // The anchor text is non-empty, so its first character lies inside a node.
    if (!started && start < offset + length) {
      range.setStart(node, start - offset)
      started = true
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset)
      return range
    }
    offset += length
  }
  return null
}
