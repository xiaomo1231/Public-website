/**
 * On-screen keyboard avoidance (iPad / touch tablets).
 *
 * When the software keyboard opens, iPadOS shrinks the *visual* viewport but
 * not the layout viewport, so a field near the bottom of a scroll box — or a
 * sticky footer such as the settings save bar — ends up behind the keyboard.
 * This module:
 *
 * - publishes how much of the layout viewport the keyboard covers as the CSS
 *   variable `--keyboard-inset` on <html> (sticky footers lift by it);
 * - when a text field gains focus (or the keyboard resizes), scrolls the
 *   field's own scroll container just enough to keep it, plus a margin, in
 *   the visible area.
 *
 * The geometry is in pure functions (`keyboardInsetFrom`,
 * `revealScrollDelta`) so it can be tested without a browser.
 */

/** Below this the "inset" is browser chrome jitter, not a keyboard. */
export const MIN_KEYBOARD_INSET = 80

/** Space kept between the focused field and the keyboard / top edge. */
export const REVEAL_MARGIN = 24

export interface VisualViewportLike {
  height: number
  offsetTop: number
  scale?: number
}

/**
 * Pixels of the layout viewport hidden by the on-screen keyboard. Zero when
 * there is no keyboard, when the difference is too small to be one, or while
 * the page is pinch-zoomed (the visual viewport is then smaller for another
 * reason).
 */
export function keyboardInsetFrom(layoutHeight: number, viewport: VisualViewportLike): number {
  if (!Number.isFinite(layoutHeight) || layoutHeight <= 0) return 0
  if (viewport.scale !== undefined && Math.abs(viewport.scale - 1) > 0.01) return 0
  const hidden = layoutHeight - (viewport.height + viewport.offsetTop)
  if (!Number.isFinite(hidden) || hidden < MIN_KEYBOARD_INSET) return 0
  return Math.round(hidden)
}

export interface VerticalBox {
  top: number
  bottom: number
}

/**
 * How far to scroll (positive = down) so that `target` sits inside `visible`
 * with `margin` on each side. Zero when it already does. A target taller than
 * the visible area is aligned by its top, so the caret line stays in view.
 */
export function revealScrollDelta(
  target: VerticalBox,
  visible: VerticalBox,
  margin: number = REVEAL_MARGIN,
): number {
  const top = visible.top + margin
  const bottom = visible.bottom - margin
  if (bottom <= top) return target.top - visible.top
  if (target.top < top) return target.top - top
  if (target.bottom > bottom) {
    const delta = target.bottom - bottom
    // Never push the field's top above the visible top.
    return Math.min(delta, target.top - top)
  }
  return 0
}

/** Elements the keyboard is for: text entry, not buttons or checkboxes. */
export function isTextEntry(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return false
    return !NON_TEXT_INPUTS.has(el.type)
  }
  return false
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Scroll `el` into the part of the screen the keyboard leaves visible. Uses
 * the field's own scroll container (dialogs, the page column), falling back to
 * the window.
 */
export function revealAboveKeyboard(el: HTMLElement, win: Window = window): void {
  const vv = win.visualViewport
  const visibleTop = vv ? vv.offsetTop : 0
  const visibleBottom = vv ? vv.offsetTop + vv.height : win.innerHeight
  const container = scrollParent(el)
  const rect = el.getBoundingClientRect()
  let top = visibleTop
  let bottom = visibleBottom
  if (container) {
    const box = container.getBoundingClientRect()
    top = Math.max(top, box.top)
    bottom = Math.min(bottom, box.bottom)
  }
  const delta = revealScrollDelta(rect, { top, bottom })
  if (Math.abs(delta) < 1) return
  if (container) container.scrollBy({ top: delta })
  else win.scrollBy({ top: delta })
}

/**
 * Wire the keyboard handling to the window. Returns a cleanup function. Does
 * nothing where `visualViewport` is missing (old browsers, tests).
 */
export function installKeyboardAvoidance(win: Window = window): () => void {
  const vv = win.visualViewport
  if (!vv) return () => undefined
  const root = win.document.documentElement
  let inset = 0
  let frame = 0

  const update = () => {
    frame = 0
    const next = keyboardInsetFrom(win.innerHeight, vv)
    const opened = next > inset
    if (next !== inset) {
      inset = next
      root.style.setProperty('--keyboard-inset', `${next}px`)
    }
    const active = win.document.activeElement
    if (opened && isTextEntry(active)) revealAboveKeyboard(active, win)
  }
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(update)
  }
  const onFocusIn = (event: FocusEvent) => {
    if (!isTextEntry(event.target as Element | null)) return
    // The keyboard animates in after focus; check now and once it settles.
    schedule()
    win.setTimeout(() => {
      if (inset > 0 && win.document.activeElement === event.target) {
        revealAboveKeyboard(event.target as HTMLElement, win)
      }
    }, 350)
  }

  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  win.document.addEventListener('focusin', onFocusIn)
  return () => {
    vv.removeEventListener('resize', schedule)
    vv.removeEventListener('scroll', schedule)
    win.document.removeEventListener('focusin', onFocusIn)
    if (frame) win.cancelAnimationFrame(frame)
    root.style.removeProperty('--keyboard-inset')
  }
}
