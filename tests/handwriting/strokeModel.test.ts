import { describe, expect, it } from 'vitest'
import {
  boardHasInk,
  boardReducer,
  initialBoard,
  inkFromToken,
  MAX_PAGES,
  PALM_GRACE_MS,
  pointerIntent,
  pressureWidth,
  strokeSegments,
  type BoardAction,
  type BoardState,
  type PointerKind,
} from '@/widgets/handwriting/strokeModel'

function run(state: BoardState, ...actions: BoardAction[]): BoardState {
  return actions.reduce(boardReducer, state)
}

function down(pointerType: PointerKind, pointerId = 1, now = 0, x = 10): BoardAction {
  return {
    type: 'down',
    pointerId,
    pointerType,
    point: { x, y: 10, pressure: 0.5 },
    tool: 'pen',
    color: '#111',
    width: 4,
    now,
  }
}

function line(pointerType: PointerKind, pointerId = 1, now = 0): BoardAction[] {
  return [
    down(pointerType, pointerId, now),
    { type: 'move', pointerId, points: [{ x: 50, y: 60, pressure: 0.8 }], now: now + 10 },
    { type: 'up', pointerId, now: now + 20 },
  ]
}

describe('pen board stroke model', () => {
  it('a pen draws a stroke', () => {
    const state = run(initialBoard(), ...line('pen'))
    expect(state.pages[0]).toHaveLength(1)
    expect(state.pages[0]![0]!.points).toHaveLength(2)
    expect(state.pages[0]![0]!.pressureSensitive).toBe(true)
    expect(boardHasInk(state)).toBe(true)
  })

  it('a mouse draws (desktop) without pressure', () => {
    const state = run(initialBoard(), ...line('mouse'))
    expect(state.pages[0]).toHaveLength(1)
    expect(state.pages[0]![0]!.pressureSensitive).toBe(false)
  })

  it('a finger never draws; it pans, and is ignored while a pen is active', () => {
    const fingerOnly = run(initialBoard(), ...line('touch'))
    expect(fingerOnly.pages[0]).toHaveLength(0)
    expect(pointerIntent(initialBoard(), 'touch', 0)).toBe('pan')

    const penDown = run(initialBoard(), down('pen', 1, 1000))
    expect(pointerIntent(penDown, 'touch', 1005)).toBe('ignore')
    // A palm landing mid-stroke does not interrupt or add a stroke.
    const withPalm = run(penDown, down('touch', 2, 1005), {
      type: 'up',
      pointerId: 2,
      now: 1006,
    })
    expect(withPalm.active?.pointerId).toBe(1)
    const lifted = run(withPalm, { type: 'up', pointerId: 1, now: 1010 })
    expect(lifted.pages[0]).toHaveLength(1)
    // Still ignored right after the pen lifts, then scrolling resumes.
    expect(pointerIntent(lifted, 'touch', 1010 + PALM_GRACE_MS - 1)).toBe('ignore')
    expect(pointerIntent(lifted, 'touch', 1010 + PALM_GRACE_MS + 1)).toBe('pan')
  })

  it('a second pointer cannot start a stroke while one is drawing', () => {
    const state = run(initialBoard(), down('pen', 1), down('mouse', 2))
    expect(state.active?.pointerId).toBe(1)
    const moved = run(state, {
      type: 'move',
      pointerId: 2,
      points: [{ x: 1, y: 1, pressure: 0.5 }],
      now: 1,
    })
    expect(moved.active?.stroke.points).toHaveLength(1)
  })

  it('cancel drops the stroke in progress', () => {
    const state = run(initialBoard(), down('pen'), { type: 'cancel', pointerId: 1 })
    expect(state.active).toBeNull()
    expect(state.pages[0]).toHaveLength(0)
    expect(state.undo).toHaveLength(0)
  })

  it('undo / redo strokes, clear and pages', () => {
    let state = run(initialBoard(), ...line('pen', 1, 0), ...line('pen', 2, 100))
    expect(state.pages[0]).toHaveLength(2)
    state = run(state, { type: 'undo' })
    expect(state.pages[0]).toHaveLength(1)
    state = run(state, { type: 'redo' })
    expect(state.pages[0]).toHaveLength(2)
    state = run(state, { type: 'clear' })
    expect(state.pages[0]).toHaveLength(0)
    state = run(state, { type: 'undo' })
    expect(state.pages[0]).toHaveLength(2)

    state = run(state, { type: 'addPage' })
    expect(state.pages).toHaveLength(2)
    expect(state.page).toBe(1)
    state = run(state, ...line('pen', 3, 200))
    expect(state.pages[1]).toHaveLength(1)
    state = run(state, { type: 'goto', page: 0 })
    expect(state.page).toBe(0)
    state = run(state, { type: 'undo' }) // undoes the page-2 stroke, returns to page 2
    expect(state.page).toBe(1)
    expect(state.pages[1]).toHaveLength(0)

    // A new action clears the redo stack.
    state = run(state, ...line('pen', 4, 300))
    expect(state.redo).toHaveLength(0)
  })

  it('caps pages and keeps at least one', () => {
    let state = initialBoard()
    for (let i = 0; i < MAX_PAGES + 3; i++) state = run(state, { type: 'addPage' })
    expect(state.pages).toHaveLength(MAX_PAGES)
    state = run(initialBoard(), { type: 'deletePage' })
    expect(state.pages).toHaveLength(1)
  })

  it('an eraser alone leaves the page blank', () => {
    const state = run(
      initialBoard(),
      { ...(down('pen') as Extract<BoardAction, { type: 'down' }>), tool: 'eraser' },
      { type: 'up', pointerId: 1, now: 1 },
    )
    expect(state.pages[0]).toHaveLength(1)
    expect(boardHasInk(state)).toBe(false)
  })

  it('pressure varies the width for a pen only', () => {
    expect(pressureWidth(4, 1, true)).toBeCloseTo(6.6)
    expect(pressureWidth(4, 0.1, true)).toBeLessThan(4)
    expect(pressureWidth(4, 0, true)).toBeCloseTo(4) // no pressure reported → typical
    expect(pressureWidth(4, 1, false)).toBe(4)
    const stroke = run(initialBoard(), ...line('pen')).pages[0]![0]!
    const [segment] = strokeSegments(stroke)
    expect(segment!.width).toBeCloseTo(pressureWidth(4, 0.65, true))
  })

  it('clamps points to the page and turns theme tokens into dark ink', () => {
    const state = run(initialBoard(), down('pen', 1, 0, -50), { type: 'up', pointerId: 1, now: 1 })
    expect(state.pages[0]![0]!.points[0]!.x).toBe(0)
    expect(inkFromToken('199 89% 70%', 'x')).toBe('hsl(199 89% 42%)')
    expect(inkFromToken('0 72% 30%', 'x')).toBe('hsl(0 72% 30%)')
    expect(inkFromToken('not a colour', 'fallback')).toBe('fallback')
  })
})
