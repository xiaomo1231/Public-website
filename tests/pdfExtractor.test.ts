import { describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => {
  const makeTextItems = (text: string) => {
    const lines = text.split('\n')
    const items: Array<{ str: string; transform: number[] }> = []
    let y = 800
    for (const line of lines) {
      items.push({ str: line, transform: [1, 0, 0, 1, 50, y] })
      y -= 14
    }
    return items
  }

  class FakePDFPage {
    constructor(private text: string) {}
    async getTextContent() {
      return { items: makeTextItems(this.text) }
    }
    async cleanup() {}
  }

  class FakePDFDocument {
    constructor(private pages: Array<{ text: string }>) {}
    get numPages() {
      return this.pages.length
    }
    async getPage(i: number) {
      const p = this.pages[i - 1]
      if (!p) throw new Error('no page')
      return new FakePDFPage(p.text)
    }
    async getMetadata() {
      return {
        info: {
          Title: 'Test PDF',
          Author: 'Tester',
          Subject: 'Demo',
          Producer: 'pdf-lib',
          Creator: 'test',
        },
      }
    }
    async cleanup() {}
    async destroy() {}
  }

  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: Promise.resolve(
        new FakePDFDocument([
          {
            text: 'Chapter 1: Derivatives\nThe derivative measures the sensitivity of a function to its input.',
          },
          {
            text: 'Chapter 2: Integrals\nIntegration is the reverse of differentiation.',
          },
        ]),
      ),
    }),
  }
})

const { extractPdf, groupTextItemsIntoLines } = await import('@/infrastructure/files/pdfExtractor')

describe('PDF math text geometry', () => {
  it('places a painted-before-base vector arrow on its overlapping letter', () => {
    const item = (str: string, x: number, y: number, width: number, height: number) => ({
      str, width, height, transform: [1, 0, 0, 1, x, y],
    })
    expect(groupTextItemsIntoLines([
      item('where', 54, 100, 33, 11),
      item('\u20d7', 93, 100, 0, 11),
      item(' ', 87, 100, 1, 0),
      item('x', 88, 100, 6, 11),
      item(' = (x, y)', 102, 100, 55, 11),
    ])).toEqual(['where x\u20d7 = (x, y)'])
    // A distant mark must never be assigned to an unrelated letter.
    expect(groupTextItemsIntoLines([
      item('\u20d7', 10, 100, 0, 11),
      item('x', 100, 100, 6, 11),
    ])).not.toEqual(['x\u20d7'])
  })
  it('rejoins lowered and raised digits without merging separate lines', () => {
    const item = (str: string, x: number, y: number, width: number, height: number) => ({
      str, width, height, transform: [1, 0, 0, 1, x, y],
    })
    expect(groupTextItemsIntoLines([
      item('V', 10, 100, 8, 11),
      item('1', 18, 98.4, 4, 8),
      item(' = {(x, y) ∈ R', 22, 100, 90, 11),
      item('2', 112, 104.5, 4, 8),
      item(' | x = y}', 116, 100, 55, 11),
      item('and', 10, 80, 20, 11),
    ])).toEqual(['V₁ = {(x, y) ∈ R² | x = y}', 'and'])
  })

  it('does not reinterpret ordinary same-size digits as scripts', () => {
    expect(groupTextItemsIntoLines([
      { str: 'Problem ', width: 45, height: 11, transform: [1, 0, 0, 1, 10, 100] },
      { str: '8', width: 6, height: 11, transform: [1, 0, 0, 1, 55, 100] },
      { str: 'Solution', width: 42, height: 11, transform: [1, 0, 0, 1, 10, 80] },
    ])).toEqual(['Problem 8', 'Solution'])
  })
})

describe('extractPdf (mocked)', () => {
  it('extracts text per page', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    const result = await extractPdf(blob)
    expect(result.pageCount).toBe(2)
    expect(result.pages[0]!.text).toMatch(/Derivative/)
    expect(result.pages[1]!.text).toMatch(/Integration/)
  })

  it('detects headings via heuristic', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    const result = await extractPdf(blob)
    expect(result.pages[0]!.headings.length).toBeGreaterThan(0)
    expect(result.pages[0]!.headings.some((h) => /Chapter 1/.test(h.text))).toBe(true)
  })

  it('reads metadata', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    const result = await extractPdf(blob)
    expect(result.metadata.title).toBe('Test PDF')
    expect(result.metadata.author).toBe('Tester')
  })
})
