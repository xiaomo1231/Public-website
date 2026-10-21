import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createGenerationRun,
  type GenerationRun,
  type GenerationRunState,
} from './generationControl'

export interface UseGenerationRunResult {
  /** The current (or last) run; `null` before the first start. */
  run: GenerationRun | null
  /** Its state, re-rendered on every change; `null` before the first start. */
  state: GenerationRunState | null
  /** True while the run is `running` or `pausing`. */
  active: boolean
  /** Create a new run (the previous one is left as it ended). */
  start: () => GenerationRun
  /** Follow a run created elsewhere (e.g. one that outlives this page). */
  attach: (run: GenerationRun | null) => void
  /** Mark the current run as ended (see `GenerationRun.finish`). */
  finish: () => GenerationRunState | null
  /** Forget the last run (back to idle). */
  reset: () => void
  requestPause: () => void
  stopNow: () => void
}

/**
 * Hold one generation run for a component and re-render on its state.
 * `abortOnUnmount` stops a run that belongs to the component (a single
 * request); a run that outlives the page (a walkthrough) keeps going.
 */
export function useGenerationRun(
  options: { abortOnUnmount?: boolean } = {},
): UseGenerationRunResult {
  const [run, setRun] = useState<GenerationRun | null>(null)
  const [state, setState] = useState<GenerationRunState | null>(null)
  const current = useRef<GenerationRun | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)
  const abortOnUnmount = options.abortOnUnmount ?? false

  const attach = useCallback((next: GenerationRun | null) => {
    if (current.current === next) return
    unsubscribe.current?.()
    unsubscribe.current = null
    current.current = next
    setRun(next)
    setState(next?.state ?? null)
    if (next) unsubscribe.current = next.onStateChange(setState)
  }, [])

  const start = useCallback(() => {
    const next = createGenerationRun()
    attach(next)
    return next
  }, [attach])

  const finish = useCallback(() => current.current?.finish() ?? null, [])
  const reset = useCallback(() => attach(null), [attach])
  const requestPause = useCallback(() => current.current?.requestPause(), [])
  const stopNow = useCallback(() => current.current?.stopNow(), [])

  useEffect(
    () => () => {
      unsubscribe.current?.()
      if (abortOnUnmount) current.current?.stopNow()
    },
    [abortOnUnmount],
  )

  return {
    run,
    state,
    active: state === 'running' || state === 'pausing',
    start,
    attach,
    finish,
    reset,
    requestPause,
    stopNow,
  }
}
