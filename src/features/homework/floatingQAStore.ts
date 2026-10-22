import { create } from 'zustand'
import type { NoteWindowRect, WalkthroughNoteTurn } from '@/entities/homework/walkthrough'
import type { TextAnchor } from '@/shared/lib/textAnchor'

/**
 * Floating question windows over a homework walkthrough.
 *
 * Each window holds one conversation about one passage. A window is saved as a
 * note as soon as its first answer arrives (or when the learner clicks 保存);
 * it then mirrors the stored note: every new turn, and how and where it is
 * shown (window / card / tucked / dock), are saved too, so it comes back the
 * same way after a reload (see `floatingQA.ts`). At most three are open at a
 * time; opening a fourth tucks the one at the back into the dock.
 *
 * A window can also shrink to a small card (`compact`) or be tucked into the
 * text (`tucked`: no window at all — the passage is marked and hovering it
 * shows the conversation). Cards do not count toward the three full windows
 * (they are small), but at most six show at once; tucked conversations take no
 * screen space and are not limited.
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

/** A window shrunk to a card. */
export interface CompactCard {
  /**
   * Pinned: viewport coordinates (`position: fixed`), the card stays put while
   * the page scrolls. Not pinned: coordinates in the walkthrough's card layer,
   * so the card scrolls with the text.
   */
  x: number
  y: number
  pinned: boolean
  /** Rendered width; absent on old records (then `CARD_SIZE.width`). */
  width?: number
  /**
   * Rendered height. Without `manual` it is the measured fit of the question
   * and latest answer (capped, see `fitCardHeight`); absent until measured.
   */
  height?: number
  /** The learner resized the card: keep its size, stop fitting to the content. */
  manual?: boolean
}

/** A card size the learner chose; kept for the visit (and on a saved note). */
export interface CardSize {
  width: number
  height: number
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
  /** Shown as a small card instead of the full window. */
  compact?: CompactCard
  /** The card size the learner set by hand; the next card starts at it. */
  cardSize?: CardSize
  /** Tucked into the text: no window, the passage is marked instead. */
  tucked?: boolean
  /** A saved note whose passage is no longer in the walkthrough (「原文已更新」). */
  passageMissing?: boolean
}

export type FloatingQAMode = 'full' | 'compact' | 'tucked' | 'minimized'

export function windowMode(window: FloatingQAWindow): FloatingQAMode {
  if (window.minimized) return 'minimized'
  if (window.tucked) return 'tucked'
  return window.compact ? 'compact' : 'full'
}

export const MAX_OPEN_WINDOWS = 3
export const MAX_COMPACT_CARDS = 6
export const DEFAULT_WINDOW_SIZE = { width: 400, height: 460 }
/** Fallback card size: the default width, and the height before it is measured. */
export const CARD_SIZE = { width: 320, height: 140 }
export const CARD_MIN = { width: 240, height: 120 }
/** A card fits its content up to min(60% of the viewport height, 520px), then scrolls. */
const CARD_MAX_AUTO_HEIGHT = 520
const MIN_WIDTH = 300
const MIN_HEIGHT = 220
const MARGIN = 12
const LAYER_MARGIN = 4

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

/** The tallest a card grows to fit its content before its body scrolls. */
export function cardAutoHeightCap(viewportHeight: number): number {
  return Math.max(CARD_MIN.height, Math.min(Math.round(viewportHeight * 0.6), CARD_MAX_AUTO_HEIGHT))
}

/** Height that shows `contentHeight` (header + question + answer) whole, up to the cap. */
export function fitCardHeight(contentHeight: number, viewportHeight: number): number {
  return Math.min(
    Math.max(Math.ceil(contentHeight), CARD_MIN.height),
    cardAutoHeightCap(viewportHeight),
  )
}

/** A new card's width: 320px, narrower only when the viewport is. */
export function defaultCardWidth(viewportWidth: number): number {
  return Math.min(CARD_SIZE.width, Math.max(CARD_MIN.width, viewportWidth - MARGIN * 2))
}

/** The card's real size (fallbacks before it was measured). */
export function cardSize(card: CompactCard): CardSize {
  return { width: card.width ?? CARD_SIZE.width, height: card.height ?? CARD_SIZE.height }
}

/** A resized card: at least `CARD_MIN`, at most the bounds minus margins. */
export function clampCardSize(
  size: CardSize,
  bounds: { width: number; height: number },
  pinned = true,
): CardSize {
  const margin = pinned ? MARGIN : LAYER_MARGIN
  return {
    width: Math.round(
      Math.min(
        Math.max(size.width, CARD_MIN.width),
        Math.max(CARD_MIN.width, bounds.width - margin * 2),
      ),
    ),
    height: Math.round(
      Math.min(
        Math.max(size.height, CARD_MIN.height),
        Math.max(CARD_MIN.height, bounds.height - margin * 2),
      ),
    ),
  }
}

/**
 * Keep a card inside `bounds`: the viewport when pinned, the card layer (the
 * walkthrough's content box) when it follows the page. Uses the card's real
 * size; a hand-set size larger than the bounds is shrunk to fit.
 */
export function clampCard(
  card: CompactCard,
  bounds: { width: number; height: number },
): CompactCard {
  const margin = card.pinned ? MARGIN : LAYER_MARGIN
  const sized =
    card.manual && card.width !== undefined && card.height !== undefined
      ? {
          ...card,
          ...clampCardSize({ width: card.width, height: card.height }, bounds, card.pinned),
        }
      : card
  const { width, height } = cardSize(sized)
  return {
    ...sized,
    x: Math.min(Math.max(sized.x, margin), Math.max(margin, bounds.width - width - margin)),
    y: Math.min(Math.max(sized.y, margin), Math.max(margin, bounds.height - height - margin)),
  }
}

/**
 * Pin a card to the screen or attach it to the page without it moving on
 * screen (its size is kept). `layer` is the card layer's current viewport
 * position.
 */
export function convertCardPin(
  card: CompactCard,
  pinned: boolean,
  layer: { left: number; top: number },
): CompactCard {
  if (card.pinned === pinned) return card
  return pinned
    ? { ...card, x: card.x + layer.left, y: card.y + layer.top, pinned }
    : { ...card, x: card.x - layer.left, y: card.y - layer.top, pinned }
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
  /** Whether the last card was pinned; new cards start the same way (this visit only). */
  cardPinned: boolean
  open: (window: Omit<FloatingQAWindow, 'id' | 'z' | 'minimized'>) => string
  close: (id: string) => void
  /** Bring to the front as a full window (from a card, the text or the dock). */
  focus: (id: string) => void
  /** Bring to the front without changing how it is shown. */
  raise: (id: string) => void
  /** Shrink to a card. */
  compact: (id: string, card: CompactCard) => void
  /** Move a card, or pin / unpin it. */
  setCard: (id: string, card: CompactCard) => void
  /** The learner resized a card: keep the size (also for the next card of this window). */
  resizeCard: (id: string, size: CardSize) => void
  /** Back to the full window, optionally at a new place. */
  expand: (id: string, rect?: NoteWindowRect) => void
  /** Tuck into the text. */
  tuck: (id: string) => void
  setMinimized: (id: string, minimized: boolean) => void
  setRect: (id: string, rect: NoteWindowRect) => void
  update: (id: string, patch: Partial<Omit<FloatingQAWindow, 'id'>>) => void
  closeSet: (setId: string) => void
}

function sameRect(a: NoteWindowRect, b: NoteWindowRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function backmost(windows: FloatingQAWindow[], mode: FloatingQAMode, keep: number): string[] {
  const shown = windows.filter((window) => windowMode(window) === mode).sort((a, b) => a.z - b.z)
  return shown.slice(0, Math.max(0, shown.length - keep)).map((window) => window.id)
}

/**
 * Minimise the windows furthest back until at most `MAX_OPEN_WINDOWS` full
 * windows and `MAX_COMPACT_CARDS` cards show. A docked card comes back from
 * the dock as a full window.
 */
function enforceLimit(windows: FloatingQAWindow[]): FloatingQAWindow[] {
  const excess = new Set([
    ...backmost(windows, 'full', MAX_OPEN_WINDOWS),
    ...backmost(windows, 'compact', MAX_COMPACT_CARDS),
  ])
  if (excess.size === 0) return windows
  return windows.map((window) => {
    if (!excess.has(window.id)) return window
    const { compact: _compact, ...rest } = window
    return { ...rest, minimized: true }
  })
}

/**
 * Shown as the full window, kept on screen: a card, a docked window or a
 * tucked passage may come back where its old rect no longer fits.
 */
function asFull(window: FloatingQAWindow, rect: NoteWindowRect = window.rect): FloatingQAWindow {
  const { compact: _compact, ...rest } = window
  return { ...rest, rect: clampRect(rect), minimized: false, tucked: false }
}

export const useFloatingQA = create<FloatingQAState>((set) => ({
  windows: [],
  nextZ: 1,
  cardPinned: true,
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
      // Already the full window in front: nothing to change (no re-render).
      const target = state.windows.find((window) => window.id === id)
      if (
        !target ||
        (windowMode(target) === 'full' && state.windows.every((window) => window.z <= target.z))
      )
        return state
      return {
        nextZ: state.nextZ + 1,
        windows: enforceLimit(
          state.windows.map((window) =>
            window.id === id ? { ...asFull(window), z: state.nextZ } : window,
          ),
        ),
      }
    }),
  raise: (id) =>
    set((state) => {
      const target = state.windows.find((window) => window.id === id)
      if (!target || state.windows.every((window) => window.z <= target.z)) return state
      return {
        nextZ: state.nextZ + 1,
        windows: state.windows.map((window) =>
          window.id === id ? { ...window, z: state.nextZ } : window,
        ),
      }
    }),
  compact: (id, card) =>
    set((state) => ({
      nextZ: state.nextZ + 1,
      cardPinned: card.pinned,
      windows: enforceLimit(
        state.windows.map((window) =>
          window.id === id ? { ...asFull(window), compact: card, z: state.nextZ } : window,
        ),
      ),
    })),
  setCard: (id, card) =>
    set((state) => ({
      // Only a pin toggle is a choice to remember; moves and re-fits of a card
      // (possibly another one than the last toggled) keep it.
      cardPinned: state.windows.some(
        (window) => window.id === id && window.compact && window.compact.pinned !== card.pinned,
      )
        ? card.pinned
        : state.cardPinned,
      windows: state.windows.map((window) =>
        window.id === id && window.compact ? { ...window, compact: card } : window,
      ),
    })),
  resizeCard: (id, size) =>
    set((state) => ({
      windows: state.windows.map((window) =>
        window.id === id && window.compact
          ? { ...window, cardSize: size, compact: { ...window.compact, ...size, manual: true } }
          : window,
      ),
    })),
  expand: (id, rect) =>
    set((state) => ({
      nextZ: state.nextZ + 1,
      windows: enforceLimit(
        state.windows.map((window) =>
          window.id === id ? { ...asFull(window, rect), z: state.nextZ } : window,
        ),
      ),
    })),
  tuck: (id) =>
    set((state) => ({
      windows: state.windows.map((window) =>
        window.id === id ? { ...asFull(window), tucked: true } : window,
      ),
    })),
  setMinimized: (id, minimized) =>
    set((state) => ({
      nextZ: state.nextZ + 1,
      windows: enforceLimit(
        state.windows.map((window) => {
          if (window.id !== id) return window
          if (!minimized) return { ...asFull(window), z: state.nextZ }
          const { compact: _compact, ...rest } = window
          return { ...rest, minimized: true, tucked: false }
        }),
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
