import { useCallback } from 'react'
import {
  DEFAULT_NOTE_HIGHLIGHT_COLOR,
  DEFAULT_NOTE_MARK_STYLE,
  NOTE_HIGHLIGHT_COLORS,
  NOTE_MARK_STYLES,
  type NoteHighlightColor,
  type NoteMarkStyle,
} from '@/entities/user/types'
import { useAuthStore } from '@/features/auth/authStore'
import { logger } from '@/infrastructure/logger/logger'

/**
 * 问答标记样式: how walkthrough passages with questions are marked. Applied as
 * `<html data-note-mark>`; `globals.css` styles `::highlight(walkthrough-note)`
 * (saved, stronger) and `::highlight(walkthrough-link)` (unsaved, lighter) per
 * style with the theme tokens, so it follows the palette and the mode.
 */
export const NOTE_MARK_ATTRIBUTE = 'data-note-mark'

export function resolveNoteMarkStyle(value: unknown): NoteMarkStyle {
  return typeof value === 'string' && (NOTE_MARK_STYLES as readonly string[]).includes(value)
    ? (value as NoteMarkStyle)
    : DEFAULT_NOTE_MARK_STYLE
}

/** Apply a mark style to the document (no-op outside a browser). */
export function applyNoteMarkStyle(style: unknown, root?: HTMLElement): NoteMarkStyle {
  const resolved = resolveNoteMarkStyle(style)
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined)
  target?.setAttribute(NOTE_MARK_ATTRIBUTE, resolved)
  return resolved
}

/** The stored mark style; changing it repaints at once and is then saved. */
export function useNoteMarkStyle(): {
  style: NoteMarkStyle
  setStyle: (style: NoteMarkStyle) => void
} {
  const style = resolveNoteMarkStyle(useAuthStore((s) => s.profile?.noteMarkStyle))
  const persist = useAuthStore((s) => s.setNoteMarkStyle)
  const setStyle = useCallback(
    (next: NoteMarkStyle) => {
      applyNoteMarkStyle(next)
      void persist(next).catch((err: unknown) => {
        logger.warn('Failed to persist note mark style', { style: next })
        logger.debug('Note mark style persistence error', { error: String(err) })
      })
    },
    [persist],
  )
  return { style, setStyle }
}

/**
 * Highlighter fill colour, applied as `<html data-note-color>`. The colours
 * live in `globals.css` (`[data-note-color]` blocks set `--note-hl`,
 * `--note-hl-saved-a`, `--note-hl-unsaved-a` per light / dark mode); any element
 * carrying the attribute gets that colour's tokens, which the settings
 * swatches use for their previews.
 */
export const NOTE_COLOR_ATTRIBUTE = 'data-note-color'

export function resolveNoteHighlightColor(value: unknown): NoteHighlightColor {
  return typeof value === 'string' && (NOTE_HIGHLIGHT_COLORS as readonly string[]).includes(value)
    ? (value as NoteHighlightColor)
    : DEFAULT_NOTE_HIGHLIGHT_COLOR
}

/** Apply a highlighter colour to the document (no-op outside a browser). */
export function applyNoteHighlightColor(color: unknown, root?: HTMLElement): NoteHighlightColor {
  const resolved = resolveNoteHighlightColor(color)
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined)
  target?.setAttribute(NOTE_COLOR_ATTRIBUTE, resolved)
  return resolved
}

/** The stored highlighter colour; changing it repaints at once and is then saved. */
export function useNoteHighlightColor(): {
  color: NoteHighlightColor
  setColor: (color: NoteHighlightColor) => void
} {
  const color = resolveNoteHighlightColor(useAuthStore((s) => s.profile?.noteHighlightColor))
  const persist = useAuthStore((s) => s.setNoteHighlightColor)
  const setColor = useCallback(
    (next: NoteHighlightColor) => {
      applyNoteHighlightColor(next)
      void persist(next).catch((err: unknown) => {
        logger.warn('Failed to persist note highlight colour', { color: next })
        logger.debug('Note highlight colour persistence error', { error: String(err) })
      })
    },
    [persist],
  )
  return { color, setColor }
}
