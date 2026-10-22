import type { KeyboardEvent } from 'react'

const NEXT = new Set(['ArrowRight', 'ArrowDown'])
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp'])

/**
 * Index the arrow `key` moves to in a radio group of `count` options
 * (wrapping), or null for any other key.
 */
export function radioStep(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  if (NEXT.has(key)) return (index + 1) % count
  if (PREVIOUS.has(key)) return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * WAI-ARIA radio-group keyboard pattern for `role="radio"` buttons: arrow keys
 * (and Home / End) select and focus the neighbouring option. Pair with a
 * roving `tabIndex` (0 on the selected option, -1 on the others) so the group
 * is one Tab stop.
 */
export function onRadioKeyDown<T>(
  event: KeyboardEvent<HTMLElement>,
  options: readonly T[],
  index: number,
  select: (option: T) => void,
): void {
  const next = radioStep(event.key, index, options.length)
  if (next === null) return
  event.preventDefault()
  select(options[next]!)
  const group = event.currentTarget.closest('[role="radiogroup"]')
  const radios = group?.querySelectorAll<HTMLElement>('[role="radio"]')
  radios?.[next]?.focus()
}
