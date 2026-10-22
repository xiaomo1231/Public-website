import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { FitMeasurement, FitSettings } from './fitToWidth'

/**
 * Where reading content is fitted to its column instead of scrolling
 * sideways (the homework walkthrough and its print copy). Outside a
 * `FitWidthScope` this is `null` and formulas / tables render as before.
 */
export const FitWidthContext = createContext<FitSettings | null>(null)

export function useFitWidthSettings(): FitSettings | null {
  return useContext(FitWidthContext)
}

/*
 * Measurements are batched: every element that wants to measure queues a task
 * and one animation frame runs them all. Each task only reads layout and calls
 * a state setter; React batches those updates, so a long walkthrough with many
 * formulas reads all sizes first and re-renders once.
 */
const queue = new Set<() => void>()
let frame = 0

function flush(): void {
  frame = 0
  const tasks = [...queue]
  queue.clear()
  for (const task of tasks) task()
}

export function scheduleFitMeasure(task: () => void): () => void {
  queue.add(task)
  if (!frame && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush)
  return () => {
    queue.delete(task)
  }
}

/*
 * Global re-fit: switching interface style changes type sizes without
 * necessarily changing the column width, and web fonts change glyph widths
 * when they finish loading.
 */
const resetListeners = new Set<() => void>()
let watching = false

function notifyReset(): void {
  for (const listener of [...resetListeners]) listener()
}

function watchGlobalChanges(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(notifyReset).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ui-style'],
    })
  }
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  fonts?.addEventListener?.('loadingdone', notifyReset)
}

function subscribeFitReset(listener: () => void): () => void {
  watchGlobalChanges()
  resetListeners.add(listener)
  return () => {
    resetListeners.delete(listener)
  }
}

/** At most this many external re-fits per window, so a feedback loop cannot spin. */
const RESET_LIMIT = 4
const RESET_WINDOW_MS = 2000

export interface FitStageOptions<S> {
  enabled: boolean
  initial: S
  /** Changing it (e.g. the formula's source) starts over from `initial`. */
  resetKey: string
  measure: (element: HTMLElement) => FitMeasurement | null
  next: (stage: S, measurement: FitMeasurement) => S | null
  /** The element whose width change means "fit again" (default: the element itself). */
  widthTarget?: (element: HTMLElement) => Element | null
}

/**
 * Measure → decide → re-render until `next` returns `null`. Starts over when
 * the observed width changes (window resize, sidebar, tablet rotation), the
 * interface style changes or fonts load — never because of its own changes.
 */
export function useFitStage<S>(ref: RefObject<HTMLElement>, options: FitStageOptions<S>): S {
  const [stage, setStage] = useState<S>(options.initial)
  const [epoch, setEpoch] = useState(0)
  const latest = useRef(options)
  latest.current = options
  const stageRef = useRef(stage)
  stageRef.current = stage

  const resetsRef = useRef<number[]>([])
  const reset = useRef(() => {
    const now = Date.now()
    const recent = resetsRef.current.filter((at) => now - at < RESET_WINDOW_MS)
    if (recent.length >= RESET_LIMIT) return
    resetsRef.current = [...recent, now]
    setStage(latest.current.initial)
    setEpoch((value) => value + 1)
  }).current

  // New content: start over (not on the first render, already initial).
  const keyRef = useRef(options.resetKey)
  useLayoutEffect(() => {
    if (keyRef.current === options.resetKey) return
    keyRef.current = options.resetKey
    setStage(latest.current.initial)
    setEpoch((value) => value + 1)
  }, [options.resetKey])

  const { enabled } = options
  useLayoutEffect(() => {
    if (!enabled) return
    const element = ref.current
    if (!element) return
    return scheduleFitMeasure(() => {
      if (!element.isConnected) return
      const measurement = latest.current.measure(element)
      if (!measurement) return
      const next = latest.current.next(stageRef.current, measurement)
      if (next) setStage(next)
    })
  }, [enabled, stage, epoch, ref])

  useEffect(() => {
    if (!enabled) return
    const element = ref.current
    if (!element) return
    const target = latest.current.widthTarget?.(element) ?? element
    let width = -1
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const next = entries[0]?.contentRect.width ?? 0
            if (width >= 0 && Math.abs(next - width) > 1) reset()
            width = next
          })
    observer?.observe(target)
    const unsubscribe = subscribeFitReset(reset)
    return () => {
      observer?.disconnect()
      unsubscribe()
    }
  }, [enabled, ref, reset])

  return stage
}

/** Content width of a block (its client width minus horizontal padding). */
export function innerWidth(element: Element): number {
  const style = getComputedStyle(element)
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  return element.clientWidth - padding
}
