/**
 * Adaptive request pool: how many AI requests of one multi-part generation
 * (a walkthrough's questions, a recognition's batches, a course analysis's
 * parts…) run at the same time.
 *
 * - At most `limit` tasks run at once. `limit` starts at the user's setting
 *   (同时进行的 AI 请求数, 1–8, default 4).
 * - 自动: a rate-limit (429) or overload answer halves `limit` for the rest of
 *   the run (never below 1) and the piece is tried again after a back-off — the
 *   provider's `Retry-After` when it sent one, else an exponential delay. No new
 *   task starts during the back-off. After `recoverAfter` successes in a row
 *   the limit grows by one again, up to the setting.
 * - Generation control: a pause starts no new task (the running ones finish);
 *   a stop aborts the running requests through the control's signal. Tasks that
 *   never started are reported as `skipped`.
 * - Nested work (the sub-parts of a split question) runs through the same
 *   pool: the parent task gives its slot to its children while it waits, and
 *   the children are scheduled before any new top-level task.
 *
 * Inner retry loops that already retry transient errors themselves call
 * `backoff(err)` (via `control.throttle`) so a 429 they see also slows the pool.
 */

import type { GenerationControl } from './generationControl'
import { isAbortError, NEVER_INTERRUPTED } from './generationControl'

export const MIN_AI_CONCURRENCY = 1
export const MAX_AI_CONCURRENCY = 8
export const DEFAULT_AI_CONCURRENCY = 4

/** A setting value as a whole number 1–8 (missing / invalid: the default 4). */
export function clampConcurrency(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_AI_CONCURRENCY
  return Math.min(MAX_AI_CONCURRENCY, Math.max(MIN_AI_CONCURRENCY, Math.round(n)))
}

/** Slows the pool down when the provider pushes back. */
export interface Throttle {
  /**
   * An error a request just failed with. A rate-limit / overload error halves
   * the live limit and returns how long to wait before trying that piece
   * again; any other error returns `null` (not the pool's business).
   */
  backoff(err: unknown): number | null
}

/** A control that also carries the pool's throttle down to inner retry loops. */
export interface PooledControl extends GenerationControl {
  readonly throttle?: Throttle
}

/** The throttle of a control handed down by a pool, if any. */
export function throttleOf(control: GenerationControl | undefined): Throttle | undefined {
  return (control as PooledControl | undefined)?.throttle
}

/**
 * How long an inner retry loop should wait after `err`: the pool's back-off
 * for a rate-limit / overload error (which also halves the pool), else the
 * caller's own delay.
 */
export function retryDelay(
  control: GenerationControl | undefined,
  err: unknown,
  fallbackMs: number,
): number {
  return throttleOf(control)?.backoff(err) ?? fallbackMs
}

/** True for the provider asking us to slow down (429, overloaded / 503). */
export function isOverloadError(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown } | null
  if (!e || typeof e !== 'object') return false
  // A typed error says what it is (an exhausted quota is a 429 too, but no
  // amount of waiting helps it).
  if (typeof e.code === 'string')
    return e.code === 'RATE_LIMITED' || e.code === 'PROVIDER_UNAVAILABLE'
  return e.status === 429 || e.status === 503 || e.status === 529
}

function retryAfterOf(err: unknown): number | undefined {
  const value = (err as { retryAfterMs?: unknown } | null)?.retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export type PoolOutcome<R> =
  | { status: 'fulfilled'; value: R }
  | { status: 'rejected'; reason: unknown }
  /** Never started: the run was paused / stopped, or a task called `halt()`. */
  | { status: 'skipped' }

export interface PoolTaskContext {
  index: number
  /** The run's control, carrying the pool's throttle (pass it down). */
  control: PooledControl
  /** Start no further task of this `run` (e.g. the account ran out of credit). */
  halt(): void
  /**
   * Run sub-tasks through the same pool. This task's slot goes to its
   * children while it waits for them (it does not get it back: call this as
   * the task's last AI work), and they are scheduled ahead of new tasks.
   */
  nested<I, R>(
    items: readonly I[],
    task: (item: I, ctx: PoolTaskContext) => Promise<R>,
  ): Promise<PoolOutcome<R>[]>
}

export interface PoolState {
  /** The live limit (halved on 429, recovering towards `max`). */
  limit: number
  max: number
  /** Tasks running now. */
  active: number
}

export interface AdaptivePoolOptions {
  /** The user's setting (clamped to 1–8). */
  max: number
  control?: GenerationControl
  /** Halve on 429 / overload and recover (default true). */
  adaptive?: boolean
  /** Successes in a row before the limit grows by one (default 3). */
  recoverAfter?: number
  /** A task that throws a rate-limit error is retried this many times (default 3). */
  maxOverloadRetries?: number
  /** First back-off without `Retry-After` (default 2 s, doubling, max `maxDelayMs`). */
  baseDelayMs?: number
  maxDelayMs?: number
  onChange?: (state: PoolState) => void
}

export interface AdaptivePool extends Throttle {
  readonly state: PoolState
  /** The control to hand down (the run's control plus this pool's throttle). */
  readonly control: PooledControl
  run<I, R>(
    items: readonly I[],
    task: (item: I, ctx: PoolTaskContext) => Promise<R>,
  ): Promise<PoolOutcome<R>[]>
}

interface Waiter {
  priority: number
  seq: number
  resolve: (granted: boolean) => void
}

export function createAdaptivePool(options: AdaptivePoolOptions): AdaptivePool {
  const max = clampConcurrency(options.max)
  const parent = options.control ?? NEVER_INTERRUPTED
  const adaptive = options.adaptive !== false
  const recoverAfter = Math.max(1, options.recoverAfter ?? 3)
  const maxOverloadRetries = Math.max(0, options.maxOverloadRetries ?? 3)
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 2_000)
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 60_000)

  let limit = max
  let active = 0
  let successStreak = 0
  let overloads = 0
  /** No task starts before this time (a back-off is in progress). */
  let resumeAt = 0
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const waiters: Waiter[] = []

  const notify = (): void => options.onChange?.({ limit, max, active })

  const interrupted = (): boolean => !parent.shouldContinue()

  const pump = (): void => {
    if (interrupted()) {
      for (const waiter of waiters.splice(0)) waiter.resolve(false)
      return
    }
    const wait = resumeAt - Date.now()
    if (wait > 0) {
      if (timer === undefined && waiters.length > 0)
        timer = setTimeout(() => {
          timer = undefined
          pump()
        }, wait)
      return
    }
    while (active < limit && waiters.length > 0) {
      waiters.sort((a, b) => b.priority - a.priority || a.seq - b.seq)
      const next = waiters.shift()!
      active += 1
      next.resolve(true)
    }
    notify()
  }

  const onAbort = (): void => pump()
  parent.signal.addEventListener('abort', onAbort)

  /**
   * Take a free slot right now, if there is one and nobody of equal or higher
   * priority is waiting for it (so a run starts all its first tasks at once).
   */
  const tryAcquire = (priority: number): boolean => {
    if (interrupted() || resumeAt > Date.now() || active >= limit) return false
    if (waiters.some((waiter) => waiter.priority >= priority)) return false
    active += 1
    notify()
    return true
  }

  /** Wait for a slot; false when the run was paused / stopped meanwhile. */
  const acquire = (priority: number): Promise<boolean> =>
    new Promise((resolve) => {
      waiters.push({ priority, seq: (seq += 1), resolve })
      pump()
    })

  const release = (): void => {
    active = Math.max(0, active - 1)
    pump()
  }

  const throttle: Throttle = {
    backoff(err) {
      if (!isOverloadError(err)) return null
      overloads += 1
      successStreak = 0
      if (adaptive && limit > 1) limit = Math.max(1, Math.floor(limit / 2))
      const stated = retryAfterOf(err)
      const delay = Math.min(
        maxDelayMs,
        stated ?? baseDelayMs * 2 ** Math.min(6, Math.max(0, overloads - 1)),
      )
      resumeAt = Math.max(resumeAt, Date.now() + delay)
      notify()
      return delay
    },
  }

  const succeeded = (): void => {
    successStreak += 1
    if (adaptive && limit < max && successStreak >= recoverAfter) {
      limit += 1
      successStreak = 0
      pump()
    }
    if (successStreak >= recoverAfter) overloads = 0
  }

  const control: PooledControl = {
    get signal() {
      return parent.signal
    },
    shouldContinue: () => parent.shouldContinue(),
    throttle,
  }

  const runAt = async <I, R>(
    items: readonly I[],
    task: (item: I, ctx: PoolTaskContext) => Promise<R>,
    priority: number,
  ): Promise<PoolOutcome<R>[]> => {
    const results: PoolOutcome<R>[] = items.map(() => ({ status: 'skipped' }))
    const queue = items.map((item, index) => ({ item, index, tries: 0 }))
    const running = new Map<object, Promise<void>>()
    let halted = false

    const start = (job: (typeof queue)[number]): void => {
      let holding = true
      const giveBack = (): void => {
        if (!holding) return
        holding = false
        release()
      }
      const ctx: PoolTaskContext = {
        index: job.index,
        control,
        halt: () => {
          halted = true
        },
        nested: (subItems, subTask) => {
          // Hand the slot over: freed without waking the waiters, so the
          // children (registered synchronously below) get it first.
          if (holding) {
            holding = false
            active = Math.max(0, active - 1)
          }
          const children = runAt(subItems, subTask, priority + 1)
          pump()
          return children
        },
      }
      const token = {}
      const promise = (async () => {
        // Never settle synchronously: it must be in `running` first.
        await Promise.resolve()
        try {
          results[job.index] = { status: 'fulfilled', value: await task(job.item, ctx) }
          succeeded()
        } catch (err) {
          const delay =
            !isAbortError(err, parent.signal) && job.tries < maxOverloadRetries
              ? throttle.backoff(err)
              : null
          if (delay !== null) {
            job.tries += 1
            queue.unshift(job)
          } else {
            results[job.index] = { status: 'rejected', reason: err }
          }
        } finally {
          giveBack()
          running.delete(token)
        }
      })()
      running.set(token, promise)
    }

    for (;;) {
      if (queue.length > 0 && !halted && !interrupted()) {
        // A slot frees when any task finishes (ours too, which may re-queue).
        if (!tryAcquire(priority) && !(await acquire(priority))) continue
        const job = queue.shift()
        if (!job || halted || interrupted()) release()
        else start(job)
        continue
      }
      if (running.size === 0) break
      await Promise.race(running.values())
    }
    return results
  }

  return {
    get state() {
      return { limit, max, active }
    },
    control,
    backoff: throttle.backoff,
    run: (items, task) => runAt(items, task, 0),
  }
}
