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

    /*
     * Animation is enabled once the first position has painted. `enabled`
     * tracks that, so a resize-triggered snap only restores what was there.
     */
    let enabled = false
    let initFrame = 0
    let frame = 0
    let restoreFrame = 0
    const enable = () => {
      enabled = true
      setAnimate(true)
    }

    // With a start position, paint it once before measuring so the move is
    // animated; otherwise jump to the first measurement without a transition.
    if (options.initialRect) {
      initFrame = requestAnimationFrame(() => {
        enable()
        initFrame = requestAnimationFrame(measure)
      })
    } else {
      measure()
      initFrame = requestAnimationFrame(enable)
    }

    // Active item / label changed: measure on the next frame (batched), and
    // let the move glide.
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    // Layout changed (window / container resize): snap to the new position.
    // Animation is switched off for the measuring frame and restored after.
    const snapMeasure = () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(restoreFrame)
      frame = requestAnimationFrame(() => {
        const wasEnabled = enabled
        setAnimate(false)
        measure()
        if (wasEnabled) restoreFrame = requestAnimationFrame(enable)
      })
    }

    const mutations =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(scheduleMeasure)
    mutations?.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-active', 'aria-current'],
    })
    // The container only: label changes are caught by the mutation observer
    // above (characterData / childList), and they resize the container too.
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(snapMeasure)
    resizes?.observe(container)

    return () => {
      cancelAnimationFrame(initFrame)
      cancelAnimationFrame(frame)
      cancelAnimationFrame(restoreFrame)
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
