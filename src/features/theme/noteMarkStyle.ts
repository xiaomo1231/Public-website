import { useCallback } from 'react'
import {
  DEFAULT_NOTE_MARK_STYLE,
  NOTE_MARK_STYLES,
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
