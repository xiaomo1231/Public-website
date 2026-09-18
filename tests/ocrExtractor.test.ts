import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock tesseract.js BEFORE importing the extractor so the dynamic import
// resolves to our stub in test runs (jsdom has no worker, so the real
// library throws MODULE_NOT_FOUND when it tries to spin one up).
const mockRecognize = vi.fn()
vi.mock('tesseract.js', () => {
  return {
    createWorker: vi.fn().mockImplementation(async () => {
      return {
        recognize: mockRecognize,
        terminate: vi.fn().mockResolvedValue(undefined),
      }
    }),
  }
})

// Import after the mock is registered
const { extractOcr } = await import('@/infrastructure/files/ocrExtractor')

describe('extractOcr', () => {
  beforeEach(() => {
    mockRecognize.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns text and confidence when recognition succeeds', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: 'Hello world', confidence: 90 },
    })
    const result = await extractOcr(new Blob(['x'], { type: 'image/png' }))
    expect(result.text).toBe('Hello world')
    expect(result.confidence).toBe(90)
    expect(result.warnings).toEqual([])
  })

  it('emits a warning when confidence is low', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: 'unclear', confidence: 40 },
    })
    const result = await extractOcr(new Blob(['x'], { type: 'image/png' }))
    expect(result.warnings.some((w) => /confidence/i.test(w))).toBe(true)
  })

  it('emits a math warning when math symbols are detected', async () => {
    mockRecognize.mockResolvedValue({
      data: { text: '∫ x dx', confidence: 80 },
    })
    const result = await extractOcr(new Blob(['x'], { type: 'image/png' }))
    expect(result.warnings.some((w) => /math/i.test(w))).toBe(true)
  })

  it('surfaces errors thrown by tesseract', async () => {
    mockRecognize.mockRejectedValue(new Error('recognition failed'))
    await expect(extractOcr(new Blob(['x'], { type: 'image/png' }))).rejects.toThrow(/OCR failed/)
  })
})