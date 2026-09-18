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

const { extractPdf } = await import('@/infrastructure/files/pdfExtractor')

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