import { describe, expect, it } from 'vitest'
import {
  computeSelectionPopupPosition,
  isPopupAnchorVisible,
  POPUP_GAP,
  POPUP_MARGIN,
} from '@/shared/lib/popupPosition'

const VIEWPORT = { viewportWidth: 1000, viewportHeight: 800 }

describe('computeSelectionPopupPosition — desktop', () => {
  it('flips below when there is no room above (selection near the top)', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      anchor: { left: 480, top: 10, width: 40, height: 20 },
      popupWidth: 200,
      popupHeight: 40,
    })
    expect(position.side).toBe('bottom')
    expect(position.top).toBe(10 + 20 + POPUP_GAP)
    expect(position.left).toBe(400)
    expect(position.maxHeight).toBeUndefined()
  })

  it('sits above a selection with room on both sides', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      anchor: { left: 480, top: 400, width: 40, height: 20 },
      popupWidth: 200,
      popupHeight: 40,
    })
    expect(position.side).toBe('top')
    expect(position.top).toBe(400 - POPUP_GAP - 40)
  })

  it('sits above a selection near the bottom', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      anchor: { left: 480, top: 760, width: 40, height: 20 },
      popupWidth: 200,
      popupHeight: 40,
    })
    expect(position.side).toBe('top')
    expect(position.top).toBe(760 - POPUP_GAP - 40)
  })

  it('clamps to the left edge', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      anchor: { left: 10, top: 400, width: 20, height: 20 },
      popupWidth: 200,
      popupHeight: 40,
    })
    expect(position.left).toBe(POPUP_MARGIN)
  })

  it('clamps to the right edge', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      anchor: { left: 990, top: 400, width: 20, height: 20 },
      popupWidth: 200,
      popupHeight: 40,
    })
    expect(position.left).toBe(1000 - POPUP_MARGIN - 200)
    expect(position.left + 200).toBeLessThanOrEqual(1000 - POPUP_MARGIN)
  })

  it('uses the larger side and clamps the height when it fits nowhere', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      anchor: { left: 400, top: 400, width: 40, height: 20 },
      popupWidth: 200,
      popupHeight: 900,
    })
    // spaceAbove = 384, spaceBelow = 364 → the larger side is above.
    expect(position.side).toBe('top')
    expect(position.maxHeight).toBe(400 - POPUP_GAP - POPUP_MARGIN)
    expect(position.top).toBeGreaterThanOrEqual(POPUP_MARGIN)
    expect(position.top + position.maxHeight!).toBeLessThanOrEqual(800 - POPUP_MARGIN)
  })

  it('flips below a tall popup that cannot fit above but fits below', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      anchor: { left: 400, top: 100, width: 40, height: 20 },
      popupWidth: 200,
      popupHeight: 300,
    })
    expect(position.side).toBe('bottom')
    expect(position.top).toBe(100 + 20 + POPUP_GAP)
  })

  it('respects a visualViewport offset', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      viewportOffsetTop: 100,
      anchor: { left: 400, top: 150, width: 40, height: 20 },
      popupWidth: 200,
      popupHeight: 40,
    })
    expect(position.side).toBe('bottom')
    expect(position.top).toBe(150 + 20 + POPUP_GAP)
  })

  it('handles a zero-size / abnormal selection rect', () => {
    const position = computeSelectionPopupPosition({
      ...VIEWPORT,
      anchor: { left: 0, top: 0, width: 0, height: 0 },
      popupWidth: 200,
      popupHeight: 40,
    })
    expect(position.side).toBe('bottom')
    expect(position.left).toBe(POPUP_MARGIN)
    expect(position.top).toBe(POPUP_GAP)
  })

  it('is deterministic', () => {
    const input = {
      ...VIEWPORT,
      anchor: { left: 480, top: 400, width: 40, height: 20 },
      popupWidth: 200,
      popupHeight: 40,
    }
    expect(computeSelectionPopupPosition(input)).toEqual(computeSelectionPopupPosition(input))
  })
})

describe('computeSelectionPopupPosition — mobile', () => {
  it('pins a bottom sheet inside a 375px visual viewport', () => {
    const position = computeSelectionPopupPosition({
      anchor: { left: 40, top: 120, width: 60, height: 20 },
      popupWidth: 300,
      popupHeight: 400,
      viewportWidth: 375,
      viewportHeight: 667,
      mobile: true,
    })
    expect(position.side).toBe('bottom')
    expect(position.left).toBeCloseTo((375 - 300) / 2, 6)
    expect(position.top).toBe(667 - POPUP_MARGIN - 400)
    expect(position.maxHeight).toBeUndefined()
  })

  it('caps a bottom sheet that is taller than the visual viewport', () => {
    const position = computeSelectionPopupPosition({
      anchor: { left: 40, top: 120, width: 60, height: 20 },
      popupWidth: 300,
      popupHeight: 900,
      viewportWidth: 375,
      viewportHeight: 667,
      mobile: true,
    })
    expect(position.maxHeight).toBe(667 - POPUP_MARGIN * 2)
    expect(position.top).toBe(POPUP_MARGIN)
    expect(position.top + position.maxHeight!).toBeLessThanOrEqual(667 - POPUP_MARGIN)
  })

  it('accounts for a visualViewport offset on mobile', () => {
    const position = computeSelectionPopupPosition({
      anchor: { left: 40, top: 120, width: 60, height: 20 },
      popupWidth: 300,
      popupHeight: 400,
      viewportWidth: 375,
      viewportHeight: 667,
      viewportOffsetTop: 50,
      mobile: true,
    })
    expect(position.top).toBe(50 + 667 - POPUP_MARGIN - 400)
  })
})

describe('isPopupAnchorVisible', () => {
  it('is true for a partly visible selection', () => {
    expect(
      isPopupAnchorVisible({
        anchor: { left: 10, top: 10, width: 40, height: 20 },
        ...VIEWPORT,
      }),
    ).toBe(true)
  })

  it('is true for a zero-size anchor (embedded webviews)', () => {
    expect(
      isPopupAnchorVisible({
        anchor: { left: 0, top: 0, width: 0, height: 0 },
        ...VIEWPORT,
      }),
    ).toBe(true)
  })

  it('is false once the selection scrolls out of view', () => {
    expect(
      isPopupAnchorVisible({
        anchor: { left: 10, top: -50, width: 40, height: 20 },
        ...VIEWPORT,
      }),
    ).toBe(false)
    expect(
      isPopupAnchorVisible({
        anchor: { left: 10, top: 810, width: 40, height: 20 },
        ...VIEWPORT,
      }),
    ).toBe(false)
  })

  it('accounts for a visualViewport offset', () => {
    expect(
      isPopupAnchorVisible({
        anchor: { left: 10, top: 40, width: 40, height: 20 },
        ...VIEWPORT,
        viewportOffsetTop: 100,
      }),
    ).toBe(false)
  })
})
