import { describe, expect, it } from 'vitest'
import {
  buildSourceReference,
  type DocumentChunk,
  type NewChunkInput,
} from '@/entities/chunk/types'
import {
  chunksFromDocx,
  chunksFromOcr,
  chunksFromPdf,
  chunksFromPptx,
  chunksFromText,
  toStoredChunks,
} from '@/infrastructure/files/chunking'

const baseCtx = {
  documentId: 'd1',
  projectId: 'p1',
  documentName: 'Calculus.pdf',
  type: 'pdf' as const,
}

describe('chunking', () => {
  it('PDF chunks keep page number and section', () => {
    const chunks = chunksFromPdf(baseCtx, [
      { pageNumber: 1, text: 'Intro\nWelcome to calculus.', headings: [{ text: 'Intro' }] },
      { pageNumber: 2, text: 'Derivatives\nA derivative is a rate of change.', headings: [{ text: 'Derivatives' }] },
    ])
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    const page1Chunks = chunks.filter((c) => c.pageNumber === 1)
    expect(page1Chunks.length).toBeGreaterThan(0)
    expect(page1Chunks[0]!.section).toBe('Intro')
    expect(page1Chunks[0]!.sourceReference).toMatch(/Page 1/)
    expect(page1Chunks[0]!.sourceReference).toMatch(/Intro/)
  })

  it('DOCX chunks group headings and paragraphs', () => {
    const chunks = chunksFromDocx(
      baseCtx,
      [
        { type: 'heading', text: 'Lecture 3', level: 1 },
        { type: 'paragraph', text: 'Eigenvalues of a matrix.' },
      ],
    )
    expect(chunks.some((c) => c.section === 'Lecture 3')).toBe(true)
    expect(chunks.some((c) => c.text.includes('Eigenvalues'))).toBe(true)
  })

  it('PPTX chunks include slide number', () => {
    const chunks = chunksFromPptx(baseCtx, [
      { slideNumber: 1, title: 'Intro', body: 'Welcome', notes: '', tables: [], imageCount: 0 },
    ])
    expect(chunks[0]!.pageNumber).toBe(1)
    expect(chunks[0]!.sourceReference).toMatch(/Slide 1/)
  })

  it('OCR chunks mark contentType as ocr', () => {
    const chunks = chunksFromOcr(baseCtx, { text: 'Recognised text\nMore text', confidence: 80, language: 'en' })
    expect(chunks.every((c) => c.contentType === 'ocr')).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('Text chunks pack paragraphs together when they share content type', () => {
    // Short paragraphs get packed into a single chunk so the AI Tutor can
    // see them as one unit. Use a longer text to verify splitting.
    const short = chunksFromText(baseCtx, 'Para A\n\nPara B\n\nPara C')
    expect(short).toHaveLength(1)
    expect(short[0]!.text).toContain('Para A')
    expect(short[0]!.text).toContain('Para C')

    // Each line is long enough that they don't pack.
    const long = chunksFromText(baseCtx, 'P1 '.repeat(300) + '\n\nP2 '.repeat(300))
    expect(long.length).toBeGreaterThanOrEqual(2)
  })

  it('Packs long lines into multiple chunks', () => {
    const long = 'Sentence one. '.repeat(200)
    const chunks = chunksFromText(baseCtx, long)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1200)
  })

  it('toStoredChunks assigns ids and timestamps', () => {
    const inputs: NewChunkInput[] = [
      {
        documentId: 'd1',
        projectId: 'p1',
        contentType: 'paragraph',
        text: 'hi',
        sourceReference: 'X',
        order: 0,
      },
    ]
    const stored: DocumentChunk[] = toStoredChunks(inputs)
    expect(stored[0]!.id).toBeTypeOf('string')
    expect(stored[0]!.createdAt).toBeGreaterThan(0)
  })

  it('buildSourceReference composes file · page · section', () => {
    expect(buildSourceReference({ documentName: 'X.pdf', pageNumber: 3 })).toBe('X.pdf · Page 3')
    expect(
      buildSourceReference({ documentName: 'X.pptx', slideNumber: 2, section: 'Intro' }),
    ).toBe('X.pptx · Slide 2 · § Intro')
  })
})