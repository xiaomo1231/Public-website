/**
 * Pure model of the pen board: pages of strokes, the stroke being drawn, and
 * undo / redo. No DOM here, so input rules are unit-tested:
 *
 * - a pen (Apple Pencil) or a mouse draws;
 * - a finger never draws — it scrolls the page — and while a pen is down (or
 *   was lifted a moment ago) finger contacts are ignored entirely, so a palm
 *   resting on the screen neither draws nor scrolls.
 */

export type InkTool = 'pen' | 'eraser'
export type PointerKind = 'pen' | 'mouse' | 'touch'

export interface InkPoint {
  x: number
  y: number
  /** 0–1; mouse input is recorded as 0.5. */
  pressure: number
}

export interface Stroke {
  id: number
  tool: InkTool
  color: string
  /** Base width in page units; the pen's pressure varies it per point. */
  width: number
  pressureSensitive: boolean
  points: InkPoint[]
}

export interface BoardSnapshot {
  pages: Stroke[][]
  page: number
}

export interface BoardState extends BoardSnapshot {
  undo: BoardSnapshot[]
  redo: BoardSnapshot[]
  active: { pointerId: number; pointerType: PointerKind; stroke: Stroke } | null
  /** Time of the latest pen contact, for palm rejection after the pen lifts. */
  lastPenAt: number | null
  nextId: number
}

/** Logical page size; the canvas scales it to the screen. */
export const PAGE_WIDTH = 1000
export const PAGE_HEIGHT = 1400
/** Finger contacts are ignored this long after the pen lifts. */
export const PALM_GRACE_MS = 600
export const MAX_PAGES = 10
const HISTORY_LIMIT = 100

export function initialBoard(): BoardState {
  return { pages: [[]], page: 0, undo: [], redo: [], active: null, lastPenAt: null, nextId: 1 }
}

export function asPointerKind(type: string): PointerKind {
  return type === 'pen' || type === 'touch' ? type : 'mouse'
}

/** What a new contact of this kind does now. */
export function pointerIntent(
  state: Pick<BoardState, 'active' | 'lastPenAt'>,
  pointerType: PointerKind,
  now: number,
): 'draw' | 'pan' | 'ignore' {
  if (pointerType === 'pen' || pointerType === 'mouse') return 'draw'
  const penActive =
    state.active?.pointerType === 'pen' ||
    (state.lastPenAt !== null && now - state.lastPenAt < PALM_GRACE_MS)
  return penActive ? 'ignore' : 'pan'
}

/**
 * A finger contact that lands while the pen is writing (or just lifted) is a
 * palm, wherever it lands on the board dialog: it must not press a toolbar
 * button or dismiss the dialog. Pen and mouse contacts never are.
 */
export function isPalmContact(
  state: Pick<BoardState, 'active' | 'lastPenAt'>,
  pointerType: string,
  now: number,
): boolean {
  return asPointerKind(pointerType) === 'touch' && pointerIntent(state, 'touch', now) === 'ignore'
}

/** Pen pressure → width factor (0.35×–1.65×, 1× at a typical 0.5). */
export function pressureWidth(base: number, pressure: number, sensitive: boolean): number {
  if (!sensitive) return base
  const p = Number.isFinite(pressure) && pressure > 0 ? Math.min(1, pressure) : 0.5
  return base * (0.35 + 1.3 * p)
}

export function clampToPage(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(PAGE_WIDTH, Math.max(0, x)),
    y: Math.min(PAGE_HEIGHT, Math.max(0, y)),
  }
}

export type BoardAction =
  | {
      type: 'down'
      pointerId: number
      pointerType: PointerKind
      point: InkPoint
      tool: InkTool
      color: string
      width: number
      now: number
    }
  | { type: 'move'; pointerId: number; points: InkPoint[]; now: number }
  | { type: 'up'; pointerId: number; now: number }
  | { type: 'cancel'; pointerId: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'addPage' }
  | { type: 'deletePage' }
  | { type: 'goto'; page: number }

function snapshot(state: BoardState): BoardSnapshot {
  return { pages: state.pages, page: state.page }
}

/** Apply a change that can be undone. */
function commit(state: BoardState, next: BoardSnapshot): BoardState {
  return {
    ...state,
    ...next,
    undo: [...state.undo, snapshot(state)].slice(-HISTORY_LIMIT),
    redo: [],
  }
}

function touchPen(state: BoardState, pointerType: PointerKind, now: number): number | null {
  return pointerType === 'pen' ? now : state.lastPenAt
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'down': {
      if (state.active) return state
      if (pointerIntent(state, action.pointerType, action.now) !== 'draw') return state
      const stroke: Stroke = {
        id: state.nextId,
        tool: action.tool,
        color: action.color,
        width: action.width,
        pressureSensitive: action.pointerType === 'pen',
        points: [{ ...action.point, ...clampToPage(action.point.x, action.point.y) }],
      }
      return {
        ...state,
        active: { pointerId: action.pointerId, pointerType: action.pointerType, stroke },
        lastPenAt: touchPen(state, action.pointerType, action.now),
        nextId: state.nextId + 1,
      }
    }
    case 'move': {
      const active = state.active
      if (!active || active.pointerId !== action.pointerId || action.points.length === 0)
        return state
      const points = action.points.map((point) => ({
        ...point,
        ...clampToPage(point.x, point.y),
      }))
      return {
        ...state,
        active: {
          ...active,
          stroke: { ...active.stroke, points: [...active.stroke.points, ...points] },
        },
        lastPenAt: touchPen(state, active.pointerType, action.now),
      }
    }
    case 'up': {
      const active = state.active
      if (!active || active.pointerId !== action.pointerId) return state
      const pages = state.pages.map((strokes, index) =>
        index === state.page ? [...strokes, active.stroke] : strokes,
      )
      return {
        ...commit(state, { pages, page: state.page }),
        active: null,
        lastPenAt: touchPen(state, active.pointerType, action.now),
      }
    }
    case 'cancel': {
      if (!state.active || state.active.pointerId !== action.pointerId) return state
      return { ...state, active: null }
    }
    case 'undo': {
      const previous = state.undo.at(-1)
      if (!previous || state.active) return state
      return {
        ...state,
        ...previous,
        undo: state.undo.slice(0, -1),
        redo: [...state.redo, snapshot(state)],
      }
    }
    case 'redo': {
      const next = state.redo.at(-1)
      if (!next || state.active) return state
      return {
        ...state,
        ...next,
        redo: state.redo.slice(0, -1),
        undo: [...state.undo, snapshot(state)],
      }
    }
    case 'clear': {
      if (state.active || (state.pages[state.page]?.length ?? 0) === 0) return state
      const pages = state.pages.map((strokes, index) => (index === state.page ? [] : strokes))
      return commit(state, { pages, page: state.page })
    }
    case 'addPage': {
      if (state.active || state.pages.length >= MAX_PAGES) return state
      return commit(state, { pages: [...state.pages, []], page: state.pages.length })
    }
    case 'deletePage': {
      if (state.active || state.pages.length <= 1) return state
      const pages = state.pages.filter((_, index) => index !== state.page)
      return commit(state, { pages, page: Math.min(state.page, pages.length - 1) })
    }
    case 'goto': {
      if (state.active) return state
      const page = Math.min(state.pages.length - 1, Math.max(0, action.page))
      return page === state.page ? state : { ...state, page }
    }
  }
}

/** Whether a page has visible ink (an eraser alone leaves the page blank). */
export function pageHasInk(strokes: readonly Stroke[]): boolean {
  return strokes.some((stroke) => stroke.tool === 'pen')
}

export function boardHasInk(state: Pick<BoardState, 'pages'>): boolean {
  return state.pages.some(pageHasInk)
}

/**
 * Line segments of a stroke, each with its own width (pressure). A single
 * point becomes a zero-length segment, drawn as a dot with round caps.
 */
export function strokeSegments(
  stroke: Stroke,
  from = 1,
): Array<{ x0: number; y0: number; x1: number; y1: number; width: number }> {
  const { points } = stroke
  if (points.length === 1 && from <= 1) {
    const p = points[0]!
    const width = pressureWidth(stroke.width, p.pressure, stroke.pressureSensitive)
    return [{ x0: p.x, y0: p.y, x1: p.x, y1: p.y, width }]
  }
  const out = []
  for (let i = Math.max(1, from); i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const width = pressureWidth(
      stroke.width,
      (a.pressure + b.pressure) / 2,
      stroke.pressureSensitive,
    )
    out.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, width })
  }
  return out
}

/**
 * A theme colour token (`"H S% L%"`) as an ink colour that stays readable on
 * light paper in either app theme: lightness is capped at 42%.
 */
export function inkFromToken(raw: string, fallback: string): string {
  const match = /^\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*$/.exec(raw)
  if (!match) return fallback
  const h = Number(match[1])
  const s = Number(match[2])
  const l = Math.min(42, Number(match[3]))
  if (![h, s, l].every(Number.isFinite)) return fallback
  return `hsl(${h} ${s}% ${l}%)`
}
