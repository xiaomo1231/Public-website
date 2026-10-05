import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

export interface IndicatorRect {
  left: number
  top: number
  width: number
  height: number
}

export interface SlidingIndicatorOptions {
  /**
   * Where the indicator starts on mount. Lets a nav that is re-mounted on every
   * page (e.g. the course flow nav) slide from the previous page's position
   * instead of appearing in place.
   */
  initialRect?: IndicatorRect | null
  /** Called with every measured position (e.g. to remember it for next mount). */
  onMeasure?: (rect: IndicatorRect) => void
}

/**
 * A single highlight that glides to whichever child matches `selector`.
 *
 * Presentation only: the active item is still decided by the caller (via
 * `data-state`, `aria-current`, `data-active`, …); this hook merely measures
 * it. The container must be `position: relative`. Until a real, non-zero
 * position is known (first paint, jsdom) `ready` stays false so callers can
 * keep their static active style as a fallback.
 */
export function useSlidingIndicator<T extends HTMLElement>(
  selector: string,
  options: SlidingIndicatorOptions = {},
) {
  const containerRef = useRef<T | null>(null)
  const [rect, setRect] = useState<IndicatorRect | null>(options.initialRect ?? null)
  const [animate, setAnimate] = useState(false)
  const onMeasureRef = useRef(options.onMeasure)
  onMeasureRef.current = options.onMeasure

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const el = container.querySelector<HTMLElement>(selector)
      if (!el || el.offsetWidth === 0) {
        setRect(null)
        return
      }
      const next = {
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      }
      setRect((prev) =>
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      )
      onMeasureRef.current?.(next)
    }

    // With a start position, paint it once before measuring so the move is
    // animated; otherwise jump to the first measurement without a transition.
    let frame = 0
    if (options.initialRect) {
      frame = requestAnimationFrame(() => {
        setAnimate(true)
        frame = requestAnimationFrame(measure)
      })
    } else {
      measure()
      frame = requestAnimationFrame(() => setAnimate(true))
    }

    const mutations =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure)
    mutations?.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-active', 'aria-current'],
    })
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (resizes) {
      resizes.observe(container)
      for (const child of Array.from(container.children)) resizes.observe(child)
    }

    return () => {
      cancelAnimationFrame(frame)
      mutations?.disconnect()
      resizes?.disconnect()
    }
    // `initialRect` is a mount-time value only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector])

  const style: CSSProperties | undefined = rect
    ? {
        width: rect.width,
        height: rect.height,
        transform: `translate(${rect.left}px, ${rect.top}px)`,
      }
    : undefined

  return { containerRef, ready: rect !== null, animate, style }
}
