import { create } from 'zustand'
import type { NoteWindowRect } from '@/entities/homework/walkthrough'
import type { QuestionTranslation } from '@/entities/homework/questionTranslation'
import type { HomeworkQuestion } from '@/entities/homework/types'

/**
 * Floating 原题 windows: one per question, showing only its text (原文 /
 * 中文翻译) so the learner can keep it in view while answering, guided
 * practice or reading the walkthrough.
 *
 * Separate from the walkthrough's Q&A windows (`floatingQAStore`): never
 * saved as a note, not counted toward the three Q&A windows. They belong to
 * the open homework set and close when the learner leaves it. Position, size,
 * pin and font size are remembered for the visit here, and per question in
 * localStorage (a per-device convenience, never required).
 */

/**
 * `request`: the window's 中文翻译 tab may ask for a translation. `cached`:
 * only one already made is shown (模拟考试 / 自测 use no AI while answering).
 */
export type QuestionTranslationMode = 'request' | 'cached'

export interface QuestionWindowSource {
  questionId: string
  setId: string
  prompt: string
  translation?: QuestionTranslation
  /** The printed number, or the position in the set (「第 n 题」). */
  label: string
  translationMode: QuestionTranslationMode
}

export interface QuestionWindow extends QuestionWindowSource {
  /**
   * Pinned: viewport coordinates (`position: fixed`), stays put while the page
   * scrolls. Not pinned: page coordinates, so it scrolls with the page.
   */
  rect: NoteWindowRect
  pinned: boolean
  /** Font size step, see `QUESTION_FONT_SIZES`. */
  fontStep: number
  z: number
  minimized: boolean
}

/** Text sizes (px) the A− / A+ buttons step through. */
export const QUESTION_FONT_SIZES = [13, 14, 15, 16, 18, 20, 22, 25] as const
export const DEFAULT_FONT_STEP = 2
export const MAX_QUESTION_WINDOWS = 4
export const QUESTION_WINDOW_SIZE = { width: 380, height: 320 }
export const QUESTION_WINDOW_MIN = { width: 240, height: 160 }
const MARGIN = 12
const STORAGE_PREFIX = 'ai-learning:question-window:'

/** 「第 n 题」: the printed number, else the position in the set. */
export function questionWindowLabel(question: Pick<HomeworkQuestion, 'number' | 'order'>): string {
  return question.number?.trim() || String(question.order + 1)
}

export function clampFontStep(step: number): number {
  return Math.min(Math.max(Math.round(step), 0), QUESTION_FONT_SIZES.length - 1)
}

/**
 * Keep a window inside `bounds` (the viewport when pinned; the page width and
 * an unbounded height when it follows the page), at least the minimum size.
 */
export function clampQuestionRect(
  rect: NoteWindowRect,
  bounds: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): NoteWindowRect {
  const width = Math.min(
    Math.max(rect.width, QUESTION_WINDOW_MIN.width),
    Math.max(QUESTION_WINDOW_MIN.width, bounds.width - MARGIN * 2),
  )
  const height = Math.min(
    Math.max(rect.height, QUESTION_WINDOW_MIN.height),
    Math.max(QUESTION_WINDOW_MIN.height, bounds.height - MARGIN * 2),
  )
  return {
    width: Math.round(width),
    height: Math.round(height),
    x: Math.round(
      Math.min(Math.max(rect.x, MARGIN), Math.max(MARGIN, bounds.width - width - MARGIN)),
    ),
    y: Math.round(
      Math.min(Math.max(rect.y, MARGIN), Math.max(MARGIN, bounds.height - height - MARGIN)),
    ),
  }
}

/** Switch between viewport and page coordinates without moving on screen. */
export function convertQuestionPin(
  rect: NoteWindowRect,
  pinned: boolean,
  scroll: { x: number; y: number },
): NoteWindowRect {
  return pinned
    ? { ...rect, x: rect.x - scroll.x, y: rect.y - scroll.y }
    : { ...rect, x: rect.x + scroll.x, y: rect.y + scroll.y }
}

/** Where a new window opens: the top right of the screen, cascading. */
export function defaultQuestionRect(
  index: number,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): NoteWindowRect {
  const { width, height } = QUESTION_WINDOW_SIZE
  const offset = (index % 4) * 28
  return clampQuestionRect(
    { x: viewport.width - width - 24 - offset, y: 88 + offset, width, height },
    viewport,
  )
}

interface StoredLayout {
  rect: NoteWindowRect
  pinned: boolean
  fontStep: number
}

function isRect(value: unknown): value is NoteWindowRect {
  const rect = value as Partial<NoteWindowRect> | null
  return (
    !!rect &&
    [rect.x, rect.y, rect.width, rect.height].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    )
  )
}

/** The layout last used for this question on this device, if any. */
export function readStoredLayout(questionId: string): StoredLayout | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + questionId)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StoredLayout>
    if (!isRect(value.rect)) return null
    return {
      rect: value.rect,
      pinned: value.pinned !== false,
      fontStep: clampFontStep(
        typeof value.fontStep === 'number' ? value.fontStep : DEFAULT_FONT_STEP,
      ),
    }
  } catch {
    return null
  }
}

function storeLayout(window_: QuestionWindow): void {
  try {
    const layout: StoredLayout = {
      rect: window_.rect,
      pinned: window_.pinned,
      fontStep: window_.fontStep,
    }
    window.localStorage.setItem(STORAGE_PREFIX + window_.questionId, JSON.stringify(layout))
  } catch {
    // Private mode / blocked storage: the layout is kept for this visit only.
  }
}

/** Minimise the windows furthest back until at most `MAX_QUESTION_WINDOWS` show. */
function enforceLimit(windows: QuestionWindow[]): QuestionWindow[] {
  const shown = windows.filter((window) => !window.minimized).sort((a, b) => a.z - b.z)
  const excess = new Set(
    shown.slice(0, Math.max(0, shown.length - MAX_QUESTION_WINDOWS)).map((w) => w.questionId),
  )
  if (excess.size === 0) return windows
  return windows.map((window) =>
    excess.has(window.questionId) ? { ...window, minimized: true } : window,
  )
}

interface QuestionWindowState {
  windows: QuestionWindow[]
  nextZ: number
  /**
   * Open the question's window, or bring an open one to the front (with the
   * latest text and translation mode). Returns the question id.
   */
  open: (source: QuestionWindowSource) => string
  close: (questionId: string) => void
  focus: (questionId: string) => void
  setMinimized: (questionId: string, minimized: boolean) => void
  setRect: (questionId: string, rect: NoteWindowRect) => void
  setPinned: (questionId: string, pinned: boolean, rect: NoteWindowRect) => void
  setFontStep: (questionId: string, step: number) => void
  closeSet: (setId: string) => void
}

function patchWindow(
  windows: QuestionWindow[],
  questionId: string,
  patch: (window: QuestionWindow) => QuestionWindow,
): QuestionWindow[] {
  return windows.map((window) => (window.questionId === questionId ? patch(window) : window))
}

export const useQuestionWindows = create<QuestionWindowState>((set, get) => ({
  windows: [],
  nextZ: 1,
  open: (source) => {
    set((state) => {
      const existing = state.windows.find((window) => window.questionId === source.questionId)
      if (existing) {
        return {
          nextZ: state.nextZ + 1,
          windows: enforceLimit(
            patchWindow(state.windows, source.questionId, (window) => ({
              ...window,
              ...source,
              ...(source.translation ? {} : { translation: window.translation }),
              minimized: false,
              z: state.nextZ,
            })),
          ),
        }
      }
      const stored = readStoredLayout(source.questionId)
      const pinned = stored?.pinned ?? true
      const rect = stored
        ? pinned
          ? clampQuestionRect(stored.rect)
          : clampQuestionRect(stored.rect, {
              width: document.documentElement.scrollWidth || window.innerWidth,
              height: Number.POSITIVE_INFINITY,
            })
        : defaultQuestionRect(state.windows.length)
      const created: QuestionWindow = {
        ...source,
        rect,
        pinned,
        fontStep: stored?.fontStep ?? DEFAULT_FONT_STEP,
        z: state.nextZ,
        minimized: false,
      }
      return { nextZ: state.nextZ + 1, windows: enforceLimit([...state.windows, created]) }
    })
    return source.questionId
  },
  close: (questionId) =>
    set((state) => ({
      windows: state.windows.filter((window) => window.questionId !== questionId),
    })),
  focus: (questionId) =>
    set((state) => {
      const target = state.windows.find((window) => window.questionId === questionId)
      if (!target || (!target.minimized && state.windows.every((window) => window.z <= target.z)))
        return state
      return {
        nextZ: state.nextZ + 1,
        windows: enforceLimit(
          patchWindow(state.windows, questionId, (window) => ({
            ...window,
            minimized: false,
            z: state.nextZ,
          })),
        ),
      }
    }),
  setMinimized: (questionId, minimized) =>
    set((state) => ({
      nextZ: state.nextZ + 1,
      windows: enforceLimit(
        patchWindow(state.windows, questionId, (window) => ({
          ...window,
          minimized,
          ...(minimized ? {} : { z: state.nextZ }),
        })),
      ),
    })),
  setRect: (questionId, rect) => {
    set((state) => ({
      windows: patchWindow(state.windows, questionId, (window) => ({ ...window, rect })),
    }))
    const window_ = get().windows.find((window) => window.questionId === questionId)
    if (window_) storeLayout(window_)
  },
  setPinned: (questionId, pinned, rect) => {
    set((state) => ({
      windows: patchWindow(state.windows, questionId, (window) => ({ ...window, pinned, rect })),
    }))
    const window_ = get().windows.find((window) => window.questionId === questionId)
    if (window_) storeLayout(window_)
  },
  setFontStep: (questionId, step) => {
    set((state) => ({
      windows: patchWindow(state.windows, questionId, (window) => ({
        ...window,
        fontStep: clampFontStep(step),
      })),
    }))
    const window_ = get().windows.find((window) => window.questionId === questionId)
    if (window_) storeLayout(window_)
  },
  closeSet: (setId) =>
    set((state) => ({ windows: state.windows.filter((window) => window.setId !== setId) })),
}))
