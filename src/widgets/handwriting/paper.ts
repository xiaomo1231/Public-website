import type { CSSProperties } from 'react'

/**
 * The pen board is a sheet of paper: it stays light in dark mode (and in both
 * UI styles) so handwriting reads the same on screen, in the exported PNG and
 * for the AI. These are therefore fixed paper colours, not theme tokens; the
 * theme only supplies two of the ink colours (see `inkFromToken`).
 */
export const PAPER = {
  background: '#ffffff',
  rule: '#c9d6e3',
  black: '#111827',
  /** Used when a theme token cannot be read. */
  fallbackBlue: 'hsl(221 70% 38%)',
  fallbackRed: 'hsl(0 70% 40%)',
} as const

export type PaperBackground = 'blank' | 'grid' | 'ruled'

/** CSS background for the paper behind the (transparent) ink canvas. */
export function paperBackgroundStyle(kind: PaperBackground): CSSProperties {
  const line = `${PAPER.rule} 1px, transparent 1px`
  if (kind === 'grid') {
    // 40-unit squares on a 1000 × 1400 page.
    return {
      backgroundColor: PAPER.background,
      backgroundImage: `linear-gradient(${line}), linear-gradient(90deg, ${line})`,
      backgroundSize: 'calc(100% / 25) calc(100% / 35)',
    }
  }
  if (kind === 'ruled') {
    // A line every 50 units.
    return {
      backgroundColor: PAPER.background,
      backgroundImage: `linear-gradient(transparent calc(100% - 1px), ${PAPER.rule} calc(100% - 1px))`,
      backgroundSize: '100% calc(100% / 28)',
    }
  }
  return { backgroundColor: PAPER.background }
}
