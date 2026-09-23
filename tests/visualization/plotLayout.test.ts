import { describe, expect, it } from 'vitest'
import {
  NARROW_THRESHOLD,
  WIDE_LAYOUT,
  layoutForWidth,
} from '@/widgets/tutor/plotLayout'

/**
 * Regression for the Phase 1.1 browser finding: a fixed wide viewBox shrank
 * in-SVG labels to ~5.6px on a 375px viewport. The layout must switch to a
 * narrow design so text keeps its size.
 */
describe('layoutForWidth', () => {
  it('falls back to the wide design when nothing has been measured', () => {
    expect(layoutForWidth(0)).toBe(WIDE_LAYOUT)
    expect(layoutForWidth(Number.NaN)).toBe(WIDE_LAYOUT)
  })

  it('keeps the wide design at and above the threshold', () => {
    expect(layoutForWidth(NARROW_THRESHOLD)).toBe(WIDE_LAYOUT)
    expect(layoutForWidth(718)).toBe(WIDE_LAYOUT)
    expect(layoutForWidth(1440)).toBe(WIDE_LAYOUT)
  })

  it('uses a compact, square-ish design on a phone width', () => {
    const layout = layoutForWidth(325)
    expect(layout.compact).toBe(true)
    expect(layout.width).toBe(325)
    // Square viewBox => the SVG renders at scale 1, so 11px labels stay 11px.
    expect(layout.height).toBe(layout.width)
    expect(layout.width).toBeLessThan(NARROW_THRESHOLD)
  })

  it('clamps very small and mid-size measurements', () => {
    expect(layoutForWidth(120).width).toBe(300)
    expect(layoutForWidth(600)).toBe(WIDE_LAYOUT)
    const mid = layoutForWidth(520)
    expect(mid.compact).toBe(true)
    expect(mid.width).toBe(520)
  })
})
