/**
 * Pause / stop control for AI generations.
 *
 * Every AI generation the student starts can be interrupted:
 *  - a **multi-part** generation (a walkthrough's sections, a quiz's batches,
 *    the parts of a course analysis…) is paused: `requestPause()` stops new
 *    parts from being scheduled while the parts already in flight finish and
 *    are saved; `stopNow()` additionally aborts the in-flight requests. A later
 *    run continues with only what is left.
 *  - a **single-request** generation is stopped: `stopNow()` aborts it and the
 *    existing content stays as it was.
 *
 * Services take an optional `GenerationControl` (the read-only half): they
 * check `shouldContinue()` before starting each part and pass `signal` to the
 * AI layer, which turns an abort into a typed `ABORTED` error. An aborted part
 * is an interruption, never a failure: nothing is marked failed for it.
 */

import { AppError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

/**
 * `running`  — the generation is working.
 * `pausing`  — pause requested; the parts already running are finishing.
 * `paused`   — it ended early on a pause (finished parts are saved).
 * `stopped`  — it ended early on an immediate stop.
 * `done`     — it ended normally (success or failure; the caller reports which).
 */
export type GenerationRunState = 'running' | 'pausing' | 'paused' | 'stopped' | 'done'

/** What a service needs: the abort signal and whether to start another part. */
export interface GenerationControl {
  readonly signal: AbortSignal
  /** False once a pause or a stop was requested: start no new part. */
  shouldContinue(): boolean
}

/** The controller the UI holds for one run. */
export interface GenerationRun extends GenerationControl {
  readonly state: GenerationRunState
  readonly pauseRequested: boolean
  readonly stopRequested: boolean
  /** Finish the parts in flight, start no new part. */
  requestPause(): void
  /** Abort the parts in flight now (finished parts stay saved). */
  stopNow(): void
  /**
   * Record how the run ended. `done` is turned into `paused` / `stopped` when
   * an interruption was requested, so callers can always call `finish()`.
   */
  finish(): GenerationRunState
  onStateChange(listener: (state: GenerationRunState) => void): () => void
}

export function createGenerationRun(): GenerationRun {
  const controller = new AbortController()
  const listeners = new Set<(state: GenerationRunState) => void>()
  let state: GenerationRunState = 'running'
  let pauseRequested = false
  let stopRequested = false
  const set = (next: GenerationRunState): void => {
    if (next === state) return
    state = next
    for (const listener of [...listeners]) listener(next)
  }
  const ended = (): boolean => state === 'paused' || state === 'stopped' || state === 'done'
  return {
    get signal() {
      return controller.signal
    },
    get state() {
      return state
    },
    get pauseRequested() {
      return pauseRequested
    },
    get stopRequested() {
      return stopRequested
    },
    shouldContinue: () => !pauseRequested && !stopRequested && !controller.signal.aborted,
    requestPause() {
      if (ended() || pauseRequested || stopRequested) return
      pauseRequested = true
      set('pausing')
    },
    stopNow() {
      if (ended() || stopRequested) return
      stopRequested = true
      controller.abort(new DOMException('Generation stopped', 'AbortError'))
      set('pausing')
    },
    finish() {
      if (!ended()) set(stopRequested ? 'stopped' : pauseRequested ? 'paused' : 'done')
      return state
    },
    onStateChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** A control that never interrupts (the default when a caller passes none). */
export const NEVER_INTERRUPTED: GenerationControl = {
  signal: new AbortController().signal,
  shouldContinue: () => true,
}

/** The control a service works with: the caller's, or one wrapping a bare signal. */
export function resolveControl(
  control?: GenerationControl,
  signal?: AbortSignal,
): GenerationControl {
  if (control) return control
  if (signal) return { signal, shouldContinue: () => !signal.aborted }
  return NEVER_INTERRUPTED
}

/** True when a run was interrupted by its controller (pause or stop). */
export function wasInterrupted(control: GenerationControl | undefined): boolean {
  return control ? !control.shouldContinue() : false
}

/**
 * True for an aborted request: the AI layer's typed `ABORTED`, a DOM
 * `AbortError`, or any error raised once the run's own signal is aborted.
 */
export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  const e = err as { name?: unknown; code?: unknown } | null
  return e?.name === 'AbortError' || e?.code === 'ABORTED' || e instanceof GenerationPausedError
}

/**
 * Thrown by a generation that has nothing to return because it was paused or
 * stopped before it could finish (e.g. a course analysis, which is committed
 * only as a whole). Not a failure: the UI shows "paused", never an error.
 */
export class GenerationPausedError extends AppError {
  constructor(public readonly stopped = false) {
    super(t(stopped ? 'generation.stoppedSaved' : 'generation.pausedShort'), 'GENERATION_PAUSED')
    this.name = 'GenerationPausedError'
  }
}

/** True for a pause / stop interruption, whichever way it surfaced. */
export function isGenerationInterruption(err: unknown, control?: GenerationControl): boolean {
  if (err instanceof GenerationPausedError) return true
  return isAbortError(err, control?.signal)
}
