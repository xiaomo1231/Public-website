import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query matches, kept in sync as the window resizes or
 * the iPad rotates. Where `matchMedia` is missing (tests, very old browsers)
 * it reports `fallback` — `true` by default, i.e. the desktop layout.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const [matches, setMatches] = useState(() => readQuery(query, fallback))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener?.('change', update)
    return () => mql.removeEventListener?.('change', update)
  }, [query])

  return matches
}

function readQuery(query: string, fallback: boolean): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback
  return window.matchMedia(query).matches
}

/**
 * Width from which a page shows its side columns (contents, marginalia)
 * beside the reading column, per interface style. Narrower — iPad portrait,
 * and iPad landscape in lecture — they fold into toggles.
 */
export const SIDE_COLUMNS_QUERY = {
  lecture: '(min-width: 1200px)',
  lab: '(min-width: 1024px)',
} as const
