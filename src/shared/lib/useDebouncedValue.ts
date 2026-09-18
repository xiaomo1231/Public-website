import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value`.
 *
 * A `delayMs` of 0 (or less) updates on the next tick, which lets callers
 * make "cleared" inputs take effect immediately while still debouncing
 * in-progress typing.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value)
      return
    }
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

/** Debounce delay for text search inputs. */
export const SEARCH_DEBOUNCE_MS = 250
