import { describe, expect, it } from 'vitest'
import {
  clampConcurrency,
  createAdaptivePool,
  DEFAULT_AI_CONCURRENCY,
  retryDelay,
} from '@/shared/lib/concurrency'
import { createGenerationRun } from '@/shared/lib/generationControl'
import { AbortedError, QuotaExceededError, RateLimitedError } from '@/infrastructure/ai/errors'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A task that records how many run at once. */
function tracker() {
  let active = 0
  let peak = 0
  return {
    get peak() {
      return peak
    },
    async run<T>(value: T, ms = 10): Promise<T> {
      active += 1
      peak = Math.max(peak, active)
      await sleep(ms)
      active -= 1
      return value
    },
  }
}

function rateLimited(retryAfterMs?: number): RateLimitedError {
  const err = new RateLimitedError()
  if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs
  return err
}

describe('clampConcurrency', () => {
  it('keeps 1–8 and defaults to 4', () => {
    expect(clampConcurrency(undefined)).toBe(DEFAULT_AI_CONCURRENCY)
    expect(clampConcurrency('x')).toBe(4)
    expect(clampConcurrency(0)).toBe(1)
    expect(clampConcurrency(20)).toBe(8)
    expect(clampConcurrency(3.4)).toBe(3)
  })
})

describe('createAdaptivePool', () => {
  it('runs at most `max` tasks at once and returns results in item order', async () => {
    const t = tracker()
    const pool = createAdaptivePool({ max: 3 })
    const outcomes = await pool.run([1, 2, 3, 4, 5, 6, 7], (n) => t.run(n * 10, 5 + (n % 3)))
    expect(t.peak).toBe(3)
    expect(outcomes).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((n) => ({ status: 'fulfilled', value: n * 10 })),
    )
  })

  it('a pause starts no new task; the running ones finish', async () => {
    const run = createGenerationRun()
    const started: number[] = []
    const pool = createAdaptivePool({ max: 2, control: run })
    const outcomes = await pool.run([1, 2, 3, 4, 5], async (n) => {
      started.push(n)
      if (n === 1) run.requestPause()
      await sleep(5)
      return n
    })
    expect(started).toEqual([1, 2])
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'skipped',
      'skipped',
      'skipped',
    ])
  })

  it('a stop aborts the requests in flight', async () => {
    const run = createGenerationRun()
    const pool = createAdaptivePool({ max: 2, control: run })
    const outcomes = await pool.run([1, 2, 3], (n, ctx) => {
      if (n === 2) queueMicrotask(() => run.stopNow())
      return new Promise((_resolve, reject) =>
        ctx.control.signal.addEventListener('abort', () => reject(new AbortedError())),
      )
    })
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected', 'skipped'])
  })

  it('halves on a rate limit, retries that piece after Retry-After, then recovers', async () => {
    const t = tracker()
    const limits: number[] = []
    let failedOnce = false
    const pool = createAdaptivePool({
      max: 4,
      recoverAfter: 2,
      onChange: (state) => limits.push(state.limit),
    })
    const startedAt = Date.now()
    const outcomes = await pool.run(
      Array.from({ length: 12 }, (_, i) => i),
      async (n) => {
        if (n === 1 && !failedOnce) {
          failedOnce = true
          throw rateLimited(40)
        }
        return t.run(n, 5)
      },
    )
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true)
    // Halved from 4 to 2 …
    expect(limits).toContain(2)
    // … waited at least the stated Retry-After before starting anything new …
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35)
    // … and grew back to the setting after successes in a row.
    expect(pool.state.limit).toBe(4)
    expect(pool.state.max).toBe(4)
  })

  it('never goes below one, and gives up on a piece after its retries', async () => {
    const pool = createAdaptivePool({ max: 2, maxOverloadRetries: 2, baseDelayMs: 1 })
    let calls = 0
    const outcomes = await pool.run([1], async () => {
      calls += 1
      throw rateLimited(0)
    })
    expect(calls).toBe(3)
    expect(outcomes[0]!.status).toBe('rejected')
    expect(pool.state.limit).toBe(1)
  })

  it('other errors are not retried', async () => {
    const pool = createAdaptivePool({ max: 2 })
    let calls = 0
    const outcomes = await pool.run([1], async () => {
      calls += 1
      throw new QuotaExceededError()
    })
    expect(calls).toBe(1)
    expect(outcomes[0]).toMatchObject({ status: 'rejected' })
  })

  it('halt() starts no further task of the run', async () => {
    const pool = createAdaptivePool({ max: 1 })
    const outcomes = await pool.run([1, 2, 3], async (n, ctx) => {
      if (n === 1) ctx.halt()
      return n
    })
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'skipped', 'skipped'])
  })

  it('an inner retry loop slows the pool through the control throttle', async () => {
    const pool = createAdaptivePool({ max: 4, baseDelayMs: 1 })
    await pool.run([1], async (_n, ctx) => {
      expect(retryDelay(ctx.control, rateLimited(7), 999)).toBe(7)
      // Not a rate limit: the caller's own delay.
      expect(retryDelay(ctx.control, new Error('x'), 999)).toBe(999)
    })
    expect(pool.state.limit).toBe(2)
    // No pool: the caller's own delay.
    expect(retryDelay(undefined, rateLimited(7), 999)).toBe(999)
  })

  it('nested tasks share the limit, get the parent slot and go first', async () => {
    const t = tracker()
    const order: string[] = []
    const pool = createAdaptivePool({ max: 2 })
    await pool.run(['A', 'B', 'C'], async (name, ctx) => {
      await t.run(name, 5)
      order.push(name)
      if (name === 'A')
        await ctx.nested(['a1', 'a2', 'a3'], async (sub) => {
          await t.run(sub, 5)
          order.push(sub)
        })
    })
    expect(t.peak).toBeLessThanOrEqual(2)
    // A's sub-tasks are scheduled before C, which was still waiting.
    expect(order.indexOf('a1')).toBeLessThan(order.indexOf('C'))
    expect(order).toHaveLength(6)
  })
})
