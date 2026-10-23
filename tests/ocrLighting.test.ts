import { describe, expect, it, vi } from 'vitest'

const recognize = vi.fn()
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({ recognize, terminate: vi.fn(async () => undefined) })),
}))
const cleaned = new Blob(['clean'], { type: 'image/png' })
vi.mock('@/infrastructure/files/ocrPreprocess', () => ({
  illuminationNormalizedImage: vi.fn(async () => cleaned),
}))

const { extractOcr, extractOcrPages } = await import('@/infrastructure/files/ocrExtractor')

describe('OCR of photographed pages', () => {
  it('keeps the more confident of the original and the lighting-normalised pass', async () => {
    recognize.mockReset()
    recognize
      .mockResolvedValueOnce({ data: { text: 'shadowy text', confidence: 66 } })
      .mockResolvedValueOnce({ data: { text: 'clean text', confidence: 84 } })
    const result = await extractOcr(new Blob(['x'], { type: 'image/jpeg' }), {
      preferChinese: false,
      languages: ['eng'],
      normalizeLighting: true,
    })
    expect(result.text).toBe('clean text')
    expect(recognize.mock.calls[1]![0]).toBe(cleaned)
  })

  it('skips the second pass when the first is confident, and reads pages with one worker', async () => {
    recognize.mockReset()
    recognize.mockResolvedValue({ data: { text: 'printed page', confidence: 91 } })
    const pages = await extractOcrPages([new Blob(['1']), new Blob(['2'])], {
      languages: ['eng'],
      normalizeLighting: true,
    })
    expect(pages.map((page) => page?.text)).toEqual(['printed page', 'printed page'])
    expect(recognize).toHaveBeenCalledTimes(2)
    const tesseract = (await import('tesseract.js')) as unknown as {
      createWorker: ReturnType<typeof vi.fn>
    }
    expect(tesseract.createWorker).toHaveBeenCalledTimes(2) // once per call above
  })
})
