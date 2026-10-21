import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PopupAnchor } from '@/shared/lib/popupPosition'

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
  /** For the article. */
  articleHandlers: {
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
    setHover(null)
  }, [cancelOpen, cancelClose])
  const scheduleClose = useCallback(() => {
    cancelOpen()
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
      if (event.pointerType === 'touch') return
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
    articleHandlers: { onPointerMove, onPointerLeave: scheduleClose },
    cardHandlers: { onPointerEnter: cancelClose, onPointerLeave: scheduleClose },
  }
}
