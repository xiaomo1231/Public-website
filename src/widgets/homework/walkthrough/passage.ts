import { findAnchorOffset, locateAnchor, textOf, type TextAnchor } from '@/shared/lib/textAnchor'
import { prefersReducedMotion } from '@/shared/lib/motion'

/**
 * Passages in the walkthrough article, found again by their text and marked
 * with the CSS Custom Highlight API — nothing is inserted into the DOM React
 * owns, and browsers without the API simply show no marks.
 */

export function sectionElement(sectionId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-walkthrough-section="${CSS.escape(sectionId)}"]`,
  )
}

export function locatePassage(sectionId: string, anchor: TextAnchor): Range | null {
  const section = sectionElement(sectionId)
  return section ? locateAnchor(section, anchor) : null
}

/**
 * Locate many passages at once. Each section's text is read once per call,
 * however many saved passages it holds.
 */
export function locatePassages(
  passages: readonly { id: string; sectionId: string; anchor: TextAnchor }[],
): Map<string, Range> {
  const sections = new Map<string, { root: HTMLElement; text: string } | null>()
  const ranges = new Map<string, Range>()
  for (const passage of passages) {
    let section = sections.get(passage.sectionId)
    if (section === undefined) {
      const root = sectionElement(passage.sectionId)
      section = root ? { root, text: textOf(root) } : null
      sections.set(passage.sectionId, section)
    }
    if (!section) continue
    const start = findAnchorOffset(section.text, passage.anchor)
    if (start < 0) continue
    const range = rangeAt(section.root, start, start + passage.anchor.text.length)
    if (range) ranges.set(passage.id, range)
  }
  return ranges
}

/** A Range over the text offsets [start, end) of `root` (as `textOf` counts them). */
function rangeAt(root: Node, start: number, end: number): Range | null {
  const doc = root.ownerDocument!
  const range = doc.createRange()
  let offset = 0
  let started = false
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).data.length
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

function highlights(): HighlightRegistry | null {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
    ? CSS.highlights
    : null
}

export function markPassages(name: string, ranges: readonly Range[]): void {
  const registry = highlights()
  if (!registry) return
  if (ranges.length === 0) registry.delete(name)
  else registry.set(name, new Highlight(...ranges))
}

let flashTimer: ReturnType<typeof setTimeout> | undefined

/** Scroll to a passage and flash it. Returns false when it cannot be found. */
export function revealPassage(sectionId: string, anchor: TextAnchor): boolean {
  const range = locatePassage(sectionId, anchor)
  const target = range?.startContainer.parentElement ?? sectionElement(sectionId)
  if (!target) return false
  target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
  if (range) {
    markPassages('walkthrough-flash', [range])
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => markPassages('walkthrough-flash', []), 1_800)
  }
  return Boolean(range)
}

/** The text position under a point, for clicking on a marked passage. */
export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const position = doc.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = doc.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}
