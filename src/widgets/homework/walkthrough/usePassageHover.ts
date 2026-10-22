import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PopupAnchor } from '@/shared/lib/popupPosition'
import { isTouchLike } from '@/shared/lib/pointerGesture'

/** What is under the pointer: a key for the passage and where it is on screen. */
export interface PassageHoverTarget {
  key: string
  anchor: PopupAnchor
}

export const HOVER_OPEN_DELAY = 150
export const HOVER_CLOSE_DELAY = 200

export interface PassageHover {
  hover: PassageHoverTarget | null
  close: () => void
  /**
   * Open the card at once and keep it open until a tap outside it, Escape or
   * `close` (finger and pen have no hover to keep it open).
   */
  pin: (target: PassageHoverTarget) => void
  /** Whether the last press on the article was a finger or a pen. */
  lastPressWasTouch: () => boolean
  /** For the article. */
  articleHandlers: {
    onPointerDown: (event: PointerEvent) => void
    onPointerMove: (event: PointerEvent) => void
    onPointerLeave: () => void
  }
  /** For the hover card: keep it open while the pointer is over it. */
  cardHandlers: {
    onPointerEnter: () => void
    onPointerLeave: () => void
  }
}

/**
 * Hovering marked passages. `resolve` hit-tests a point (at most once per
 * frame); a card opens after a short delay and closes a little after the
 * pointer leaves both the passage and the card. Escape closes it.
 *
 * Finger and pen (2h3): a tap on a passage `pin`s its card, which then stays
 * until a tap outside both the card and the article, Escape, or another tap.
 */
export function usePassageHover(
  resolve: (point: { x: number; y: number }) => PassageHoverTarget | null,
): PassageHover {
  const [hover, setHover] = useState<PassageHoverTarget | null>(null)
  const hoverRef = useRef(hover)
  hoverRef.current = hover
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve
  const openTimer = useRef<ReturnType<typeof setTimeout>>()
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const frame = useRef<number>()
  const point = useRef({ x: 0, y: 0 })
  const pendingKey = useRef<string | null>(null)
  const pinned = useRef(false)
  const lastPointerType = useRef<string>('mouse')
  const article = useRef<Element | null>(null)

  const cancelOpen = useCallback(() => {
    clearTimeout(openTimer.current)
    openTimer.current = undefined
    pendingKey.current = null
  }, [])
  const cancelClose = useCallback(() => {
    clearTimeout(closeTimer.current)
    closeTimer.current = undefined
  }, [])
  const close = useCallback(() => {
    cancelOpen()
    cancelClose()
    pinned.current = false
    setHover(null)
  }, [cancelOpen, cancelClose])
  const pin = useCallback(
    (target: PassageHoverTarget) => {
      cancelOpen()
      cancelClose()
      pinned.current = true
      setHover(target)
    },
    [cancelOpen, cancelClose],
  )
  const scheduleClose = useCallback(() => {
    cancelOpen()
    // A tapped card stays until a tap elsewhere (touch has no "leave").
    if (pinned.current) return
    if (!hoverRef.current || closeTimer.current) return
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined
      setHover(null)
    }, HOVER_CLOSE_DELAY)
  }, [cancelOpen])

  const check = useCallback(() => {
    frame.current = undefined
    const target = resolveRef.current(point.current)
    if (!target) {
      scheduleClose()
      return
    }
    if (hoverRef.current?.key === target.key) {
      cancelOpen()
      cancelClose()
      return
    }
    if (pendingKey.current === target.key) return
    cancelOpen()
    pendingKey.current = target.key
    openTimer.current = setTimeout(() => {
      openTimer.current = undefined
      pendingKey.current = null
      cancelClose()
      setHover(target)
    }, HOVER_OPEN_DELAY)
  }, [cancelOpen, cancelClose, scheduleClose])

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType === 'touch' || pinned.current) return
      point.current = { x: event.clientX, y: event.clientY }
      if (frame.current === undefined) frame.current = requestAnimationFrame(check)
    },
    [check],
  )

  useEffect(() => {
    if (!hover) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hover, close])

  // A tap outside the card and the article closes a tapped card. Presses in
  // the article are left to its click handler (another passage, or none).
  useEffect(() => {
    if (!hover) return
    const onDown = (event: Event): void => {
      if (!pinned.current) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (article.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-passage-hover-card]')) return
      close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [hover, close])

  // The card is placed at the passage's screen position: once the page
  // scrolls (wheel scrolling fires no pointermove; a finger scroll is not a
  // tap outside) it would float detached, so it closes. Scrolling inside the
  // card itself keeps it.
  useEffect(() => {
    if (!hover) return
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-passage-hover-card]')) return
      close()
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [hover, close])

  const onPointerDown = useCallback((event: PointerEvent) => {
    lastPointerType.current = event.pointerType
    article.current = event.currentTarget
  }, [])
  const lastPressWasTouch = useCallback(() => isTouchLike(lastPointerType.current), [])

  useEffect(
    () => () => {
      clearTimeout(openTimer.current)
      clearTimeout(closeTimer.current)
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return {
    hover,
    close,
    pin,
    lastPressWasTouch,
    articleHandlers: { onPointerDown, onPointerMove, onPointerLeave: scheduleClose },
    cardHandlers: { onPointerEnter: cancelClose, onPointerLeave: scheduleClose },
  }
}
