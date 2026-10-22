import { fnv1a } from '@/shared/lib/hash'

/** A small seeded generator (mulberry32), so a build is reproducible in tests. */
export interface Rng {
  next(): number
  /** Integer in [min, max]. */
  int(min: number, max: number): number
  /** Non-zero integer in [-max, max]. */
  nonZero(max: number): number
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]
}

export function createRng(seed: string): Rng {
  let state = parseInt(fnv1a(seed).slice(0, 8), 16) >>> 0 || 1
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    nonZero(max) {
      const value = int(1, max)
      return next() < 0.5 ? -value : value
    },
    pick(items) {
      return items[Math.floor(next() * items.length)]!
    },
    shuffle(items) {
      const copy = [...items]
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
      }
      return copy
    },
  }
}
