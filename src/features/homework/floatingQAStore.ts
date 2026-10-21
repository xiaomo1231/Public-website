import { create } from 'zustand'
import type { NoteWindowRect, WalkthroughNoteTurn } from '@/entities/homework/walkthrough'
import type { TextAnchor } from '@/shared/lib/textAnchor'

/**
 * Floating question windows over a homework walkthrough.
 *
 * Each window holds one conversation about one passage. Windows live in memory
 * until the learner saves them (they then mirror a stored note and every new
 * turn is saved too). At most three are open at a time; opening a fourth tucks
 * the one at the back into the dock.
 */

export interface FloatingPassage {
  projectId: string
  setId: string
  setTitle: string
  sectionId: string
  sectionTitle: string
  /** As the learner saw it. */
  quote: string
  latex?: string
  anchor: TextAnchor
  surrounding: string
  language: 'zh' | 'en'
}

export interface FloatingQAWindow {
  id: string
  passage: FloatingPassage
  turns: WalkthroughNoteTurn[]
  /** The question waiting for an answer. */
  pending?: string
  error?: string
  /** Set once saved; later turns are saved to this note. */
  noteId?: string
  title?: string
  rect: NoteWindowRect
  z: number
  minimized: boolean
  /** `explain` sends the explain question as soon as the window opens. */
  start?: 'explain' | 'ask'
  /**
   * CSS transform-origin the opening animation grows from: the window edge
   * nearest the selection it was opened beside. Presentation only.
   */
  enterOrigin?: string
}

export const MAX_OPEN_WINDOWS = 3
export const DEFAULT_WINDOW_SIZE = { width: 400, height: 460 }
const MIN_WIDTH = 300
const MIN_HEIGHT = 220
const MARGIN = 12

/** Keep the whole window inside the viewport, so its input is never hidden. */
export function clampRect(
  rect: NoteWindowRect,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): NoteWindowRect {
  const width = Math.min(
    Math.max(rect.width, MIN_WIDTH),
    Math.max(MIN_WIDTH, viewport.width - MARGIN * 2),
  )
  const height = Math.min(
    Math.max(rect.height, MIN_HEIGHT),
    Math.max(MIN_HEIGHT, viewport.height - MARGIN * 2),
  )
  return {
    width,
    height,
    x: Math.min(Math.max(rect.x, MARGIN), Math.max(MARGIN, viewport.width - width - MARGIN)),
    y: Math.min(Math.max(rect.y, MARGIN), Math.max(MARGIN, viewport.height - height - MARGIN)),
  }
}

/** Beside the selection: to its right when there is room, else to its left. */
export function rectNearAnchor(anchor: {
  left: number
  top: number
  width: number
  height: number
}): NoteWindowRect {
  const { width, height } = DEFAULT_WINDOW_SIZE
  const right = anchor.left + anchor.width + 16
  const x = right + width + MARGIN <= window.innerWidth ? right : anchor.left - width - 16
  return clampRect({ x, y: anchor.top - 40, width, height })
}

/**
 * Where a window opened beside a selection grows from: its left edge when it
 * sits to the right of the selection, its right edge when it sits to the
 * left, otherwise its top. The vertical position follows the selection.
 */
export function enterOriginNear(
  rect: NoteWindowRect,
  anchor: { left: number; top: number; width: number; height: number },
): string {
  const center = anchor.left + anchor.width / 2
  const y = Math.round(Math.min(Math.max(anchor.top + anchor.height / 2 - rect.y, 0), rect.height))
  if (rect.x >= center) return `left ${y}px`
  if (rect.x + rect.width <= center) return `right ${y}px`
  return 'center top'
}

interface FloatingQAState {
  windows: FloatingQAWindow[]
  nextZ: number
  open: (window: Omit<FloatingQAWindow, 'id' | 'z' | 'minimized'>) => string
  close: (id: string) => void
  focus: (id: string) => void
  setMinimized: (id: string, minimized: boolean) => void
  setRect: (id: string, rect: NoteWindowRect) => void
  update: (id: string, patch: Partial<Omit<FloatingQAWindow, 'id'>>) => void
  closeSet: (setId: string) => void
}

function sameRect(a: NoteWindowRect, b: NoteWindowRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Minimise the windows furthest back until at most `MAX_OPEN_WINDOWS` show. */
function enforceLimit(windows: FloatingQAWindow[]): FloatingQAWindow[] {
  const open = windows.filter((window) => !window.minimized).sort((a, b) => a.z - b.z)
  const excess = new Set(
    open.slice(0, Math.max(0, open.length - MAX_OPEN_WINDOWS)).map((window) => window.id),
  )
  return excess.size
    ? windows.map((window) => (excess.has(window.id) ? { ...window, minimized: true } : window))
    : windows
}

export const useFloatingQA = create<FloatingQAState>((set) => ({
  windows: [],
  nextZ: 1,
  open: (input) => {
    const id = crypto.randomUUID()
    set((state) => ({
      nextZ: state.nextZ + 1,
      windows: enforceLimit([...state.windows, { ...input, id, z: state.nextZ, minimized: false }]),
    }))
    return id
  },
  close: (id) => set((state) => ({ windows: state.windows.filter((window) => window.id !== id) })),
  focus: (id) =>
    set((state) => {
      // Already the open window in front: nothing to change (no re-render).
      const target = state.windows.find((window) => window.id === id)
      if (target && !target.minimized && state.windows.every((window) => window.z <= target.z))
        return state
      return {
        nextZ: state.nextZ + 1,
        windows: enforceLimit(
          state.windows.map((window) =>
            window.id === id ? { ...window, z: state.nextZ, minimized: false } : window,
          ),
        ),
      }
    }),
  setMinimized: (id, minimized) =>
    set((state) => ({
      nextZ: state.nextZ + 1,
      windows: enforceLimit(
        state.windows.map((window) =>
          window.id === id
            ? { ...window, minimized, ...(minimized ? {} : { z: state.nextZ }) }
            : window,
        ),
      ),
    })),
  setRect: (id, rect) =>
    set((state) => {
      const current = state.windows.find((window) => window.id === id)
      if (!current || sameRect(current.rect, rect)) return state
      return {
        windows: state.windows.map((window) => (window.id === id ? { ...window, rect } : window)),
      }
    }),
  update: (id, patch) =>
    set((state) => ({
      windows: state.windows.map((window) => (window.id === id ? { ...window, ...patch } : window)),
    })),
  closeSet: (setId) =>
    set((state) => ({ windows: state.windows.filter((window) => window.passage.setId !== setId) })),
}))
