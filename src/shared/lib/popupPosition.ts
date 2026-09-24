/**
 * Pure positioning for the selection popup.
 *
 * The popup is `position: fixed`, so every coordinate here is in viewport
 * space. The algorithm prefers to sit above the selection, flips below when
 * there is not enough room, keeps itself inside the (visual) viewport, and
 * reports a `maxHeight` when the content is taller than the space available so
 * the popup can scroll internally instead of being clipped by the browser.
 */

export interface PopupAnchor {
  left: number
  top: number
  width: number
  height: number
}

export interface PopupPositionInput {
  anchor: PopupAnchor
  popupWidth: number
  popupHeight: number
  viewportWidth: number
  viewportHeight: number
  /** `visualViewport.offsetTop` — non-zero when the page is pinch-zoomed. */
  viewportOffsetTop?: number
  /** `visualViewport.offsetLeft`. */
  viewportOffsetLeft?: number
  /** Minimum distance from every viewport edge. */
  margin?: number
  /** Distance between the selection and the popup. */
  gap?: number
  /** Phones use a bottom sheet instead of an anchored popup. */
  mobile?: boolean
}

export interface PopupPosition {
  left: number
  top: number
  side: 'top' | 'bottom'
  /** Set when the content is taller than the space available. */
  maxHeight?: number
}

export const POPUP_MARGIN = 8
export const POPUP_GAP = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Whether the selection is still (at least partly) inside the visible viewport.
 *
 * When the learner scrolls the selection completely out of view we close the
 * popup instead of leaving it floating next to something unrelated. A zero-size
 * anchor (as reported by some embedded webviews) is treated as visible.
 */
export function isPopupAnchorVisible(input: {
  anchor: PopupAnchor
  viewportWidth: number
  viewportHeight: number
  viewportOffsetTop?: number
  viewportOffsetLeft?: number
}): boolean {
  const offsetTop = input.viewportOffsetTop ?? 0
  const offsetLeft = input.viewportOffsetLeft ?? 0
  const bottom = offsetTop + input.viewportHeight
  const right = offsetLeft + input.viewportWidth
  return (
    input.anchor.top + input.anchor.height >= offsetTop &&
    input.anchor.top <= bottom &&
    input.anchor.left + input.anchor.width >= offsetLeft &&
    input.anchor.left <= right
  )
}

export function computeSelectionPopupPosition(input: PopupPositionInput): PopupPosition {
  const margin = input.margin ?? POPUP_MARGIN
  const gap = input.gap ?? POPUP_GAP
  const offsetTop = input.viewportOffsetTop ?? 0
  const offsetLeft = input.viewportOffsetLeft ?? 0
  const popupWidth = Math.max(0, input.popupWidth)
  const popupHeight = Math.max(0, input.popupHeight)

  const viewTop = offsetTop + margin
  const viewBottom = offsetTop + input.viewportHeight - margin
  const viewLeft = offsetLeft + margin
  const viewRight = offsetLeft + input.viewportWidth - margin

  // Phones: a bottom sheet pinned to the visible viewport.
  if (input.mobile) {
    const available = Math.max(0, input.viewportHeight - margin * 2)
    const height = Math.min(popupHeight, available)
    const left = clamp(
      offsetLeft + (input.viewportWidth - popupWidth) / 2,
      viewLeft,
      Math.max(viewLeft, viewRight - popupWidth),
    )
    const top = offsetTop + input.viewportHeight - margin - height
    return { left, top, side: 'bottom', ...(height < popupHeight ? { maxHeight: height } : {}) }
  }

  const spaceAbove = input.anchor.top - gap - viewTop
  const spaceBelow = viewBottom - (input.anchor.top + input.anchor.height + gap)

  let side: 'top' | 'bottom'
  if (popupHeight <= spaceAbove) side = 'top'
  else if (popupHeight <= spaceBelow) side = 'bottom'
  else side = spaceAbove >= spaceBelow ? 'top' : 'bottom'

  const available = Math.max(0, side === 'top' ? spaceAbove : spaceBelow)
  const height = Math.min(popupHeight, available)

  const rawTop =
    side === 'top'
      ? input.anchor.top - gap - height
      : input.anchor.top + input.anchor.height + gap
  const top = clamp(rawTop, viewTop, Math.max(viewTop, viewBottom - height))

  const left = clamp(
    input.anchor.left + input.anchor.width / 2 - popupWidth / 2,
    viewLeft,
    Math.max(viewLeft, viewRight - popupWidth),
  )

  return { left, top, side, ...(height < popupHeight ? { maxHeight: height } : {}) }
}
