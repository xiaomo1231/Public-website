import { describe, expect, it } from 'vitest'
import {
  classifyFontName,
  collapseDoubledMathGlyphs,
  foldMathAlphanumerics,
  repairFontPrivateUse,
} from '@/infrastructure/files/fontGlyphs'
import { groupTextItemsIntoLines, type FontKindLookup } from '@/infrastructure/files/pdfLayout'
import { normalizeExtractedText } from '@/infrastructure/files/textEncoding'
import { item } from './helpers'

/** Font-specific private-use glyphs and styled maths alphanumerics (synthetic). */
describe('extraction regression — special fonts', () => {
  it('font-names: subset prefixes are ignored; Symbol / Wingdings families are told apart', () => {
    expect(classifyFontName('BCDOEE+SymbolMT')).toBe('symbol')
    expect(classifyFontName('Symbol')).toBe('symbol')
    expect(classifyFontName('FZMWZY+Wingdings-Regular')).toBe('wingdings')
    expect(classifyFontName('BCFDEE+Wingdings2')).toBe('wingdings2')
    expect(classifyFontName('Wingdings 3')).toBe('wingdings3')
    expect(classifyFontName('BCEMEE+Webdings')).toBe('webdings')
    expect(classifyFontName('MT-Extra')).toBe('other')
    expect(classifyFontName('ArialMT')).toBe('other')
    expect(classifyFontName(undefined)).toBeUndefined()
  })

  it('pua-per-font: U+F06C is λ in SymbolMT but a bullet in Wingdings, on the same page', () => {
    const kinds: Record<string, string> = { F1: 'BCDOEE+SymbolMT', F2: 'GALIJR+Wingdings-Regular' }
    const lookup: FontKindLookup = (name) => classifyFontName(name ? kinds[name] : undefined)
    expect(
      groupTextItemsIntoLines(
        [
          item('', 10, 100, 10, 12, 'F2'),
          item(' ', 20, 100, 4, 0, 'F2'),
          item('wavelength (', 30, 100, 60, 12, 'F0'),
          item('', 90, 100, 6, 12, 'F1'),
          item(') and angle ', 96, 100, 50, 12, 'F0'),
          item('', 146, 100, 6, 12, 'F1'),
        ],
        lookup,
      ),
    ).toEqual(['● wavelength (λ) and angle α'])
  })

  it('dingbats: Wingdings arrow bullet, Wingdings 2 check / cross, Webdings check', () => {
    expect(repairFontPrivateUse('', 'wingdings')).toBe('➢')
    expect(repairFontPrivateUse('', 'wingdings2')).toBe('✓')
    expect(repairFontPrivateUse('', 'wingdings2')).toBe('✗')
    expect(repairFontPrivateUse('', 'webdings')).toBe('✓')
    // An unknown dingbat on its own is a list marker; inside text it is kept.
    expect(repairFontPrivateUse('', 'wingdings3')).toBe('•')
    expect(repairFontPrivateUse('ab', 'wingdings3')).toBe('ab')
  })

  it('pua-without-font: with no font information nothing is rewritten', () => {
    expect(groupTextItemsIntoLines([item(' item', 10, 100, 40, 12)])).toEqual([' item'])
    expect(repairFontPrivateUse('', undefined)).toBe('')
    expect(repairFontPrivateUse('', 'other')).toBe('')
  })

  it('math-alphanumerics: bold / italic maths letters and digits fold to plain text', () => {
    expect(foldMathAlphanumerics('𝟐𝟎. 𝟗 × 𝟏 𝐦𝐦 = 𝒌𝒈 𝑥 𝜶 ℎ')).toBe('20.9 × 1 mm = kg x α h')
    // Only that block: superscripts, ligatures and CJK stay as they are.
    expect(foldMathAlphanumerics('10³ ﬁ 中文')).toBe('10³ ﬁ 中文')
  })

  it('math-decimal-space: `𝟕. 𝟒𝟐` loses the stray space after the decimal point', () => {
    expect(foldMathAlphanumerics('𝟕. 𝟒𝟐 𝐠')).toBe('7.42 g')
    // A sentence full stop between plain digits is untouched.
    expect(foldMathAlphanumerics('Step 7. 42 trials')).toBe('Step 7. 42 trials')
  })

  it('bold-math-exponent: `× 𝟏𝟎` + a raised `𝟐𝟐` becomes ×10²² from geometry', () => {
    expect(
      groupTextItemsIntoLines([
        item('𝟔. 𝟎𝟐 × 𝟏𝟎', 10, 100, 90, 28),
        item('𝟐𝟑', 100, 110.2, 20, 20.4),
        item(' 𝐦𝐨𝐥', 120, 100, 40, 28),
      ]),
    ).toEqual(['6.02 × 10²³ mol'])
  })

  it('minus-sign: a U+2212 minus and a raised signed exponent survive (10⁻³)', () => {
    expect(
      groupTextItemsIntoLines([
        item('1 mL = 1 × 10', 10, 100, 70, 14),
        item('−3', 80, 105, 10, 9),
        item(' L', 90, 100, 10, 14),
      ]),
    ).toEqual(['1 mL = 1 × 10⁻³ L'])
  })

  it('doubled-italic: PowerPoint paints 𝑣𝑣 for 𝑣; collapsed only with geometric evidence', () => {
    // Two glyphs squeezed into one glyph's width.
    expect(collapseDoubledMathGlyphs('𝑣𝑣', 17, 32)).toBe('𝑣')
    // Normal width: two real letters stay two letters.
    expect(collapseDoubledMathGlyphs('𝑣𝑣', 34, 32)).toBe('𝑣𝑣')
    expect(collapseDoubledMathGlyphs('𝑣𝑣', undefined, 32)).toBe('𝑣𝑣')
    // Once one item on the page confirms it, other runs on the page follow.
    expect(
      groupTextItemsIntoLines([
        item('𝑣𝑣', 10, 200, 17, 32),
        item('𝑣𝑣', 10, 100, 17.4, 32),
        item('A', 27, 93.6, 16, 23.4),
        item('0 ', 43, 93.6, 24, 23.4),
        item('= 𝑣𝑣', 67, 100, 50, 32),
        item('B', 117, 93.6, 16, 23.4),
      ]),
    ).toEqual(['v', 'v_{A0} = v_{B}'])
    // Without any confirming item, a wide run is not collapsed.
    expect(groupTextItemsIntoLines([item('= 𝑥𝑥', 10, 100, 50, 32)])).toEqual(['= xx'])
  })

  it('charges-and-isotopes: OCR-style `40Ca2+` text is never rewritten', () => {
    expect(normalizeExtractedText(foldMathAlphanumerics('the ion 40Ca2+ has'))).toBe(
      'the ion 40Ca2+ has',
    )
  })
})
