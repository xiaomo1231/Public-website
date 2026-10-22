import { describe, expect, it } from 'vitest'
import { groupTextItemsIntoLines, layoutTextItems } from '@/infrastructure/files/pdfLayout'
import { item } from './helpers'

/**
 * Exponents, subscripts, degrees, radicals, `×10⁻¹` and stacked fractions
 * rebuilt from glyph geometry. Every input is synthetic; each case is one
 * error pattern seen in real course PDFs (see README.md).
 */
describe('extraction regression — exponents and scripts', () => {
  it('superscript-after-blank: a zero-height space never moves the baseline (21.5² not 21.52)', () => {
    expect(
      groupTextItemsIntoLines([
        item('x', 10, 100, 6, 11.5),
        item('2', 16, 103.5, 4, 8),
        item(' ', 20, 103.5, 3, 0),
        item('+', 23, 100, 9, 11.5),
        item(' ', 32, 100, 3, 0),
        item('7.5', 35, 100, 15, 11.5),
        item('2', 50, 103.5, 4, 8),
        item(' ', 54, 103.5, 4, 0),
        item('m/s', 58, 100, 18, 11.5),
        item('2', 76, 103.5, 4, 8),
      ]),
    ).toEqual(['x² + 7.5² m/s²'])
  })

  it('superscript-not-a-new-line: a raised exponent stays on its line (no stray "2)" line)', () => {
    expect(
      groupTextItemsIntoLines([
        item('v', 10, 100, 6, 11.5),
        item('f', 16, 98.2, 3, 8),
        // pdf.js gives this space zero height on the subscript's baseline.
        item(' ', 19, 98.2, 3, 0),
        item('= (0.5 m/s', 22, 100, 60, 11.5),
        item('2', 82, 104.9, 4, 8),
        item(')(4 s) = 2 m/s', 86, 100, 70, 11.5),
        item('Next line', 10, 80, 50, 11.5),
      ]),
    ).toEqual(['v_{f} = (0.5 m/s²)(4 s) = 2 m/s', 'Next line'])
  })

  it('degree-ring: a raised ◦ after a number becomes ° on the same line', () => {
    expect(
      groupTextItemsIntoLines([
        item('cos 60', 10, 100, 30, 12),
        item('◦', 40, 105, 4, 8),
        item(' ', 44, 105, 4, 0),
        item('= 0.5', 48, 100, 25, 12),
      ]),
    ).toEqual(['cos 60° = 0.5'])
  })

  it('subscript-letters: lowered letters after a variable become _{…}', () => {
    expect(
      groupTextItemsIntoLines([
        item('v', 10, 100, 6, 12),
        item('f', 16, 98.2, 3, 8),
        item('y', 19, 98.2, 4, 8),
        item(' ', 23, 98.2, 3, 0),
        item('= 0', 26, 100, 18, 12),
      ]),
    ).toEqual(['v_{fy} = 0'])
  })

  it('subscript-digits: lowered digits keep Unicode subscripts (H₂O)', () => {
    expect(
      groupTextItemsIntoLines([
        item('H', 10, 100, 8, 12),
        item('2', 18, 97.5, 4, 8),
        item('O', 22, 100, 8, 12),
      ]),
    ).toEqual(['H₂O'])
  })

  it('stacked-scripts: an index set under an exponent is not a fraction (v_{fs}²)', () => {
    expect(
      groupTextItemsIntoLines([
        item('v', 10, 100, 6, 12),
        item('2', 16, 103.5, 4, 8),
        item('f', 16, 98.2, 3, 8),
        item('s', 19, 98.2, 3, 8),
        item(' = 0', 24, 100, 20, 12),
      ]),
    ).toEqual(['v_{fs}² = 0'])
  })

  it('times-ten-exponent: `x10` + raised `-1` is ×10⁻¹ (geometry only)', () => {
    expect(
      groupTextItemsIntoLines([
        item('5.75 x10', 10, 100, 45, 14),
        item('-1', 55, 105, 8, 9),
        item(' g', 63, 100, 10, 14),
      ]),
    ).toEqual(['5.75 ×10⁻¹ g'])
    // Without raised geometry the text is left exactly as printed.
    expect(groupTextItemsIntoLines([item('5.75 x10-1 g', 10, 100, 70, 14)])).toEqual([
      '5.75 x10-1 g',
    ])
  })

  it('radical-sign: a raised √ stays on the line it opens', () => {
    expect(
      groupTextItemsIntoLines([
        item('v = −', 10, 100, 30, 12),
        item('√', 40, 110.4, 10, 12),
        item('49', 50, 100, 12, 12),
        item(' m/s', 62, 100, 20, 12),
      ]),
    ).toEqual(['v = −√49 m/s'])
  })

  it('same-size-digits: ordinary digits on the baseline are never scripts', () => {
    expect(
      groupTextItemsIntoLines([item('Problem ', 10, 100, 45, 11), item('8', 55, 100, 6, 11)]),
    ).toEqual(['Problem 8'])
  })
})

describe('extraction regression — stacked fractions', () => {
  it('display-fraction: numerator above, denominator below → a/b on one line', () => {
    expect(
      groupTextItemsIntoLines([
        item('s = ', 10, 100, 20, 12),
        item('1', 40, 108, 6, 12),
        item('2', 40, 92, 6, 12),
        item('at', 50, 100, 10, 12),
      ]),
    ).toEqual(['s = 1/2 at'])
  })

  it('display-fraction-groups: multi-token parts are parenthesised', () => {
    expect(
      groupTextItemsIntoLines([
        item('t =', 10, 100, 15, 12),
        item('x + 1', 40, 108, 25, 12),
        item('2 m/s', 42, 92, 22, 12),
        item(' = 3 s', 70, 100, 30, 12),
      ]),
    ).toEqual(['t = (x + 1)/(2 m/s) = 3 s'])
  })

  it('inline-half: a small raised 1 over a small lowered 2 is 1/2, not ¹2', () => {
    expect(
      groupTextItemsIntoLines([
        item('Δs =', 10, 100, 25, 12),
        item(' ', 35, 100, 5, 0),
        item('1', 40, 104.7, 4, 8),
        item('2', 40, 95.9, 4, 8),
        item(' ', 44, 95.9, 1, 0),
        item('a', 46, 100, 6, 12),
      ]),
    ).toEqual(['Δs = 1/2 a'])
  })

  it('ambiguous-stack: stacked but asymmetric runs keep their text and flag the line', () => {
    const lines = layoutTextItems([
      item('y =', 10, 100, 15, 12),
      item('k', 40, 108, 6, 12),
      item('m', 40, 97, 8, 12),
      item('+ 1', 50, 100, 15, 12),
    ])
    expect(lines.map((line) => line.text).join(' ')).toContain('k')
    expect(lines.map((line) => line.text).join(' ')).not.toContain('/')
    expect(lines.some((line) => line.warnings?.includes('fraction'))).toBe(true)
  })
})
