import { describe, expect, it, vi } from 'vitest'
import {
  capturePointer,
  DRAG_THRESHOLD,
  dragThreshold,
  dropIndexAt,
  isTouchLike,
  passedDragThreshold,
  pointerKind,
  releasePointer,
} from '@/shared/lib/pointerGesture'
import { computeSelectionPopupPosition } from '@/shared/lib/popupPosition'

describe('pointer kinds (2h3)', () => {
  it('treats finger and pen as touch-like, everything else as a mouse', () => {
    expect(pointerKind('touch')).toBe('touch')
    expect(pointerKind('pen')).toBe('pen')
    expect(pointerKind('mouse')).toBe('mouse')
    expect(pointerKind('')).toBe('mouse')
    expect(pointerKind(undefined)).toBe('mouse')
    expect(isTouchLike('touch')).toBe(true)
    expect(isTouchLike('pen')).toBe(true)
    expect(isTouchLike('mouse')).toBe(false)
  })
})

describe('drag threshold', () => {
  it('needs more travel for a finger than a pen, and least for a mouse', () => {
    expect(DRAG_THRESHOLD.touch).toBeGreaterThan(DRAG_THRESHOLD.pen)
    expect(DRAG_THRESHOLD.pen).toBeGreaterThan(DRAG_THRESHOLD.mouse)
    expect(dragThreshold('touch')).toBe(DRAG_THRESHOLD.touch)
  })

  it('keeps a wobbly tap a tap and starts a drag past the threshold', () => {
    const start = { x: 100, y: 100 }
    expect(passedDragThreshold(start, { x: 104, y: 103 }, 'touch')).toBe(false)
    expect(passedDragThreshold(start, { x: 104, y: 103 }, 'mouse')).toBe(true)
    expect(passedDragThreshold(start, { x: 100, y: 108 }, 'touch')).toBe(true)
    expect(passedDragThreshold(start, { x: 103, y: 104 }, 'pen')).toBe(false)
    expect(passedDragThreshold(start, { x: 100, y: 106 }, 'pen')).toBe(true)
  })
})

describe('drop index of a dragged list item', () => {
  // Four items, 40px tall, centres at 20 / 60 / 100 / 140.
  const mids = [20, 60, 100, 140]

  it('stays in place while the pointer is between its neighbours', () => {
    expect(dropIndexAt(mids, 1, 50)).toBe(1)
    expect(dropIndexAt(mids, 1, 90)).toBe(1)
  })

  it('moves down past each centre crossed, and up likewise', () => {
    expect(dropIndexAt(mids, 0, 110)).toBe(2)
    expect(dropIndexAt(mids, 0, 500)).toBe(3)
    expect(dropIndexAt(mids, 3, 10)).toBe(0)
    expect(dropIndexAt(mids, 3, 70)).toBe(2)
  })
})

describe('pointer capture', () => {
  it('captures and releases on the handle, and tolerates missing support', () => {
    const element = document.createElement('div')
    const set = vi.fn()
    const release = vi.fn()
    Object.assign(element, {
      setPointerCapture: set,
      hasPointerCapture: () => true,
      releasePointerCapture: release,
    })
    capturePointer(element, 7)
    releasePointer(element, 7)
    expect(set).toHaveBeenCalledWith(7)
    expect(release).toHaveBeenCalledWith(7)
    // A pointer already gone throws; that is not an error for the gesture.
    Object.assign(element, {
      setPointerCapture: () => {
        throw new Error('NotFoundError')
      },
    })
    expect(() => capturePointer(element, 8)).not.toThrow()
    expect(() => capturePointer(null, 8)).not.toThrow()
  })
})

describe('selection popup side for touch', () => {
  const base = {
    popupWidth: 200,
    popupHeight: 40,
    viewportWidth: 1000,
    viewportHeight: 800,
  }

  it('prefers below the selection for touch (the iPadOS menu sits above)', () => {
    const anchor = { left: 400, top: 300, width: 100, height: 20 }
    expect(computeSelectionPopupPosition({ ...base, anchor }).side).toBe('top')
    const touch = computeSelectionPopupPosition({ ...base, anchor, prefer: 'bottom', gap: 28 })
    expect(touch.side).toBe('bottom')
    expect(touch.top).toBe(300 + 20 + 28)
  })

  it('still flips above when there is no room below', () => {
    const anchor = { left: 400, top: 760, width: 100, height: 20 }
    expect(computeSelectionPopupPosition({ ...base, anchor, prefer: 'bottom' }).side).toBe('top')
  })
})
