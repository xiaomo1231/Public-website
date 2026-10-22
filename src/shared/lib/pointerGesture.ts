/**
 * Pure helpers shared by every touch / pen interaction (2h3): what kind of
 * pointer pressed, how far it must travel before a press becomes a drag, how
 * long a press must last to count as a long-press, and where a dragged list
 * item lands. Components keep their own state; these only decide.
 */

export type PointerKind = 'mouse' | 'pen' | 'touch'

/** `PointerEvent.pointerType` → kind; anything unknown is treated as a mouse. */
export function pointerKind(type: string | null | undefined): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse'
}

/** Finger or pen: no hover to rely on, so hover-only features need a tap. */
export function isTouchLike(type: string | null | undefined): boolean {
  return pointerKind(type) !== 'mouse'
}

/**
 * Travel (px) before a press becomes a drag. Fingers wobble most, pens a
 * little; a mouse barely, so desktop dragging still feels immediate.
 */
export const DRAG_THRESHOLD: Readonly<Record<PointerKind, number>> = {
  mouse: 3,
  pen: 6,
  touch: 8,
}

export function dragThreshold(type: string | null | undefined): number {
  return DRAG_THRESHOLD[pointerKind(type)]
}

/** Whether a press that started at `start` and is now at `current` is a drag. */
export function passedDragThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
  type: string | null | undefined,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= dragThreshold(type)
}

/** How long a finger / pen must stay down to count as a long-press (ms). */
export const LONG_PRESS_MS = 500

/** A long-press is cancelled by moving further than this (px). */
export const LONG_PRESS_SLOP = 10

/**
 * After a touch / pen press the browser fires emulated mouse events
 * (mouseenter, mousedown, click). Mouse-only handlers ignore them for this
 * long after the last touch-like press.
 */
export const EMULATED_MOUSE_WINDOW_MS = 800

/**
 * Where a dragged list item lands. `midpoints` are the vertical centres of
 * every item as laid out when the drag began; `from` is the dragged item and
 * `y` the pointer. The result is the index to insert at after removing `from`
 * (the `splice` convention used by the lists): the number of other items whose
 * centre is above the pointer.
 */
export function dropIndexAt(midpoints: readonly number[], from: number, y: number): number {
  let index = 0
  for (let i = 0; i < midpoints.length; i++) {
    if (i !== from && midpoints[i]! < y) index++
  }
  return index
}

/**
 * Capture the pointer on the handle so moves keep arriving when the finger
 * leaves it (and iPadOS does not hand the gesture to page scrolling).
 * Not every environment implements capture (jsdom, old webviews).
 */
export function capturePointer(element: Element | null, pointerId: number): void {
  try {
    element?.setPointerCapture?.(pointerId)
  } catch {
    // The pointer is already gone (released before the handler ran).
  }
}

export function releasePointer(element: Element | null, pointerId: number): void {
  try {
    if (element?.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // Nothing to release.
  }
}
