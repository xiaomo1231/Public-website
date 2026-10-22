import { describe, expect, it, vi } from 'vitest'

const mockRecognize = vi.fn()
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockImplementation(async () => ({
    recognize: mockRecognize,
    terminate: vi.fn().mockResolvedValue(undefined),
  })),
}))

const { extractOcr, looksLikeHandwritingNoise } =
  await import('@/infrastructure/files/ocrExtractor')

const printed = (text: string) => text.split(' ').map((word) => ({ text: word, confidence: 92 }))

/** Photographed, marked exam pages read by OCR (synthetic word lists). */
describe('extraction regression — OCR of marked exam photos', () => {
  it('clean-print: consistently confident words are not flagged', () => {
    expect(
      looksLikeHandwritingNoise({
        words: printed('Given the following compounds choose the correct name for each one'),
        confidence: 91,
      }),
    ).toBe(false)
  })

  it('pencil-working: many low-confidence fragments flag the picture', () => {
    const words = [
      ...printed('A block of metal has the following measured density'),
      ...['l6.0b', 'mmxl8', '5S5l', 'x1O3', 'mm^3', 'z6.11', 'g/cm3'].map((text) => ({
        text,
        confidence: 31,
      })),
    ]
    expect(looksLikeHandwritingNoise({ words, confidence: 70 })).toBe(true)
  })

  it('red-ink: a marker pen lowers the bar', () => {
    const words = [
      ...printed('The plotted values show a steady linear increase with time'),
      { text: 'ok', confidence: 40 },
      { text: 'x2', confidence: 35 },
    ]
    expect(looksLikeHandwritingNoise({ words, confidence: 80 })).toBe(false)
    expect(looksLikeHandwritingNoise({ words, confidence: 80, redInkRatio: 0.01 })).toBe(true)
  })

  it('too-little-text: fewer than eight words never decides', () => {
    expect(
      looksLikeHandwritingNoise({ words: [{ text: 'ab', confidence: 5 }], confidence: 5 }),
    ).toBe(false)
  })

  it('extractor: the flag is set from tesseract blocks; isotope text stays as read', async () => {
    const lowWords = ['l6.0b', 'mmxl8', '5S5l', 'x1O3', 'mm3x', 'z6.11', 'g/cm', 'Ab12'].map(
      (text) => ({ text, confidence: 28 }),
    )
    mockRecognize.mockResolvedValue({
      data: {
        text: 'the ion written as 40Ca2+ l6.0b mmxl8',
        confidence: 64,
        blocks: [
          {
            paragraphs: [
              {
                lines: [{ words: [...printed('the ion written as 40Ca2+'), ...lowWords] }],
              },
            ],
          },
        ],
      },
    })
    const result = await extractOcr(new Blob(['x'], { type: 'image/png' }))
    expect(result.handwriting).toBe(true)
    expect(result.text).toContain('40Ca2+')
    // Blocks are requested so per-word confidence is available.
    expect(mockRecognize.mock.calls[0]![2]).toMatchObject({ blocks: true })
  })
})
