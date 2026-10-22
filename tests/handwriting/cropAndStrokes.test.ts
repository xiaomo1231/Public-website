import { describe, expect, it } from 'vitest'
import {
  assignmentSummary,
  cropToPixels,
  FULL_PAGE,
  isUsableCrop,
  orderAssignments,
  pointInBox,
  rectFromPoints,
} from '@/entities/handwriting/crop'
import { readStoredStrokes, storeStrokes, storedPageHasInk } from '@/entities/handwriting/strokes'
import {
  inkFingerprint,
  pagesFromStored,
  pagesToSave,
} from '@/widgets/handwriting/writingAreaModel'
import {
  boardFromPages,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type Stroke,
} from '@/widgets/handwriting/strokeModel'

describe('photo crop / assignment (纸上作答)', () => {
  it('spans a rectangle between two points in any direction, clamped to the page', () => {
    expect(rectFromPoints({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 })).toEqual({
      x: 0.2,
      y: 0.3,
      width: expect.closeTo(0.4, 6),
      height: expect.closeTo(0.5, 6),
    })
    expect(rectFromPoints({ x: -1, y: -1 }, { x: 2, y: 2 })).toEqual(FULL_PAGE)
    expect(pointInBox({ x: 150, y: 50 }, { left: 100, top: 0, width: 100, height: 200 })).toEqual({
      x: 0.5,
      y: 0.25,
    })
  })

  it('ignores tiny selections (a stray tap)', () => {
    expect(isUsableCrop({ x: 0.1, y: 0.1, width: 0.01, height: 0.5 })).toBe(false)
    expect(isUsableCrop({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })).toBe(true)
  })

  it('maps the selection to whole pixels inside the photo', () => {
    expect(cropToPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 4000, 3000)).toEqual({
      x: 1000,
      y: 1500,
      width: 2000,
      height: 750,
    })
    const edge = cropToPixels({ x: 0.999, y: 0.999, width: 0.5, height: 0.5 }, 100, 100)
    expect(edge.x + edge.width).toBeLessThanOrEqual(100)
    expect(edge.width).toBeGreaterThanOrEqual(1)
  })

  it('summarises which questions got regions and orders regions by page and position', () => {
    const items = [
      { id: 'a', pageIndex: 1, rect: { x: 0, y: 0.5, width: 1, height: 0.2 }, questionId: 'q2' },
      { id: 'b', pageIndex: 0, rect: { x: 0, y: 0.6, width: 1, height: 0.2 }, questionId: 'q1' },
      { id: 'c', pageIndex: 0, rect: { x: 0, y: 0.1, width: 1, height: 0.2 }, questionId: 'q1' },
      { id: 'd', pageIndex: 0, rect: FULL_PAGE, questionId: 'gone' },
    ]
    const summary = assignmentSummary(['q1', 'q2', 'q3'], items)
    expect(summary.counts.get('q1')).toBe(2)
    expect(summary.unassigned).toEqual(['q3'])
    expect(summary.unknown.map((item) => item.id)).toEqual(['d'])
    expect(orderAssignments(items.slice(0, 3)).map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('writing-area strokes (平板手写)', () => {
  const stroke = (id: number, tool: 'pen' | 'eraser' = 'pen'): Stroke => ({
    id,
    tool,
    color: '#111827',
    width: 3.5,
    pressureSensitive: true,
    points: [
      { x: 10.04, y: 20.06, pressure: 0.512 },
      { x: 30, y: 40, pressure: 0.6 },
    ],
  })

  it('stores strokes compactly and reads them back', () => {
    const stored = storeStrokes([stroke(1)], { width: PAGE_WIDTH, height: PAGE_HEIGHT })
    expect(stored.strokes[0]!.points).toEqual([10, 20.1, 0.51, 30, 40, 0.6])
    const read = readStoredStrokes(JSON.parse(JSON.stringify(stored)))
    expect(read?.strokes).toHaveLength(1)
    expect(storedPageHasInk(read)).toBe(true)
    expect(storedPageHasInk(storeStrokes([stroke(2, 'eraser')], { width: 1, height: 1 }))).toBe(
      false,
    )
  })

  it('drops malformed stored strokes instead of drawing them wrongly', () => {
    expect(readStoredStrokes(null)).toBeNull()
    expect(readStoredStrokes({ v: 2, strokes: [] })).toBeNull()
    const read = readStoredStrokes({
      v: 1,
      width: 1000,
      height: 1400,
      strokes: [
        { tool: 'pen', points: [1, 2] },
        { tool: 'laser', points: [1, 2, 3] },
        { tool: 'pen', points: [1, 2, 'x'] },
        { tool: 'pen', points: [1, 2, 0.5], color: '#000', width: 2, pressureSensitive: true },
      ],
    })
    expect(read?.strokes).toHaveLength(1)
  })

  it('saves only pages with ink and restores them at their page index', () => {
    const pages = [[stroke(1)], [], [stroke(2, 'eraser')], [stroke(3)]]
    const toSave = pagesToSave(pages)
    expect(toSave.map((item) => item.page)).toEqual([0, 3])
    const restored = pagesFromStored(
      toSave.map((item) => ({ writingPage: item.page, strokes: item.strokes })),
    )
    expect(restored).toHaveLength(4)
    expect(restored[1]).toEqual([])
    expect(restored[3]![0]!.points[1]).toEqual({ x: 30, y: 40, pressure: 0.6 })
    const board = boardFromPages(restored)
    expect(board.pages).toHaveLength(4)
    expect(board.undo).toEqual([])
    expect(board.nextId).toBe(3)
    // Strokes saved on another page size are scaled onto the board's page.
    const scaled = pagesFromStored([
      { writingPage: 0, strokes: storeStrokes([stroke(1)], { width: 500, height: 700 }) },
    ])
    expect(scaled[0]![0]!.points[1]).toEqual({ x: 60, y: 80, pressure: 0.6 })
  })

  it('fingerprints the ink so unchanged boards are not saved again', () => {
    expect(inkFingerprint([[stroke(1)]])).toBe(inkFingerprint([[stroke(1)]]))
    expect(inkFingerprint([[stroke(1)]])).not.toBe(inkFingerprint([[stroke(1)], [stroke(2)]]))
  })
})
