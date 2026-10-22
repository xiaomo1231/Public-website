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
const { extractOcr, hasCjk, looksLikeMisreadScript, tidyCjkSpacing } =
  await import('@/infrastructure/files/ocrExtractor')

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

describe('extractOcr — Chinese support', () => {
  const image = () => new Blob(['x'], { type: 'image/png' })

  beforeEach(() => {
    mockRecognize.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  async function createWorkerMock() {
    const tesseract = (await import('tesseract.js')) as unknown as {
      createWorker: ReturnType<typeof vi.fn>
    }
    return tesseract.createWorker
  }

  it('reads English only once when the English pass is confident', async () => {
    mockRecognize.mockResolvedValue({ data: { text: 'The eigenvalue is two', confidence: 91 } })
    const result = await extractOcr(image())
    const createWorker = await createWorkerMock()
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(createWorker.mock.calls[0]![0]).toEqual(['eng'])
    expect(mockRecognize).toHaveBeenCalledTimes(1)
    expect(result.text).toBe('The eigenvalue is two')
  })

  it('retries a misread English pass with Chinese + English and keeps the better result', async () => {
    mockRecognize
      .mockResolvedValueOnce({ data: { text: '#E iti S', confidence: 31 } })
      .mockResolvedValueOnce({ data: { text: '特 征 值 是 2', confidence: 84 } })
    const result = await extractOcr(image())
    const createWorker = await createWorkerMock()
    expect(createWorker.mock.calls.map((call) => call[0])).toEqual([['eng'], ['chi_sim', 'eng']])
    // Spaces Tesseract puts between Chinese characters are removed.
    expect(result.text).toBe('特征值是 2')
    expect(result.confidence).toBe(84)
    expect(result.language).toBe('zh')
  })

  it('keeps the English pass when the Chinese pass is not better', async () => {
    mockRecognize
      .mockResolvedValueOnce({ data: { text: 'blurry words', confidence: 50 } })
      .mockResolvedValueOnce({ data: { text: '模 糊', confidence: 40 } })
    const result = await extractOcr(image())
    expect(result.text).toBe('blurry words')
  })

  it('reads Chinese + English straight away when the caller prefers Chinese', async () => {
    mockRecognize.mockResolvedValue({ data: { text: '线 性 代 数', confidence: 40 } })
    const result = await extractOcr(image(), { preferChinese: true })
    const createWorker = await createWorkerMock()
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(createWorker.mock.calls[0]![0]).toEqual(['chi_sim', 'eng'])
    expect(result.text).toBe('线性代数')
  })

  it('treats symbol soup from an English pass as misread', () => {
    expect(looksLikeMisreadScript('The quick brown fox', 88)).toBe(false)
    expect(looksLikeMisreadScript('~ # ¥ ) ( * & ^ % $ #', 88)).toBe(true)
    expect(looksLikeMisreadScript('a b c d e f g h', 88)).toBe(true)
    expect(looksLikeMisreadScript('fine text', 40)).toBe(true)
  })

  it('detects Chinese names for the language hint', () => {
    expect(hasCjk('第三章 线性代数.png')).toBe(true)
    expect(hasCjk('scan_01.png')).toBe(false)
    expect(hasCjk(undefined)).toBe(false)
    expect(tidyCjkSpacing('矩 阵 A 的 秩')).toBe('矩阵 A 的秩')
  })
})
