import { useEffect, useState } from 'react'

/**
 * The section to highlight in the contents: the first section (in document
 * order) that crosses the reading band near the top of the viewport. When no
 * section crosses it (above the first one, or in the gap between two), the
 * previous choice stays; with none yet, the first section.
 */
export function currentSection(
  order: readonly string[],
  visible: ReadonlySet<string>,
  previous: string | null,
): string | null {
  for (const id of order) if (visible.has(id)) return id
  if (previous !== null && order.includes(previous)) return previous
  return order[0] ?? null
}

/**
 * The band, as an IntersectionObserver root margin: from 12 % to 35 % of the
 * viewport height — where the eye is while reading down a long page.
 */
export const READING_BAND = '-12% 0px -65% 0px'

/**
 * Scroll-spy for the walkthrough contents. `ids` are the section ids in order;
 * each section element is `#<prefix><id>`. Returns the current section id.
 */
export function useScrollSpy(
  ids: readonly string[],
  { prefix = 'wt-', enabled = true }: { prefix?: string; enabled?: boolean } = {},
): string | null {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join('\u0000')
  useEffect(() => {
    const order = key ? key.split('\u0000') : []
    setActive((previous) => currentSection(order, new Set(), previous))
    if (!enabled || order.length === 0 || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const byElement = new Map<Element, string>()
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const id = byElement.get(record.target)
          if (id === undefined) continue
          if (record.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        setActive((previous) => currentSection(order, visible, previous))
      },
      { rootMargin: READING_BAND },
    )
    for (const id of order) {
      const element = document.getElementById(`${prefix}${id}`)
      if (!element) continue
      byElement.set(element, id)
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [key, prefix, enabled])
  return active
}
