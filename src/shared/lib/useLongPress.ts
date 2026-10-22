import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isTouchLike, LONG_PRESS_MS, LONG_PRESS_SLOP } from './pointerGesture'

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent) => void
  onPointerMove: (event: ReactPointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  /** Swallows the click that follows a long-press, so the button does not fire too. */
  onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => void
  /** Android / Chrome open a context menu on a long-press; not after ours. */
  onContextMenu: (event: { preventDefault: () => void }) => void
}

/**
 * A finger or pen held still on an element for `LONG_PRESS_MS` calls
 * `onLongPress`. Mouse presses are ignored (the mouse has hover), so desktop
 * behaviour is unchanged. Moving more than `LONG_PRESS_SLOP` (a scroll)
 * cancels it.
 */
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const callback = useRef(onLongPress)
  callback.current = onLongPress

  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    start.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  return {
    onPointerDown: (event) => {
      fired.current = false
      if (!isTouchLike(event.pointerType)) return
      cancel()
      start.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        timer.current = undefined
        fired.current = true
        callback.current()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (event) => {
      const origin = start.current
      if (!origin) return
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_SLOP) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: (event) => {
      if (!fired.current) return
      fired.current = false
      event.preventDefault()
      event.stopPropagation()
    },
    onContextMenu: (event) => {
      if (fired.current || timer.current) event.preventDefault()
    },
  }
}
