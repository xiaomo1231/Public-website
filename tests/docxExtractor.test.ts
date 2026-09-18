import { describe, expect, it } from 'vitest'
import { extractDocx } from '@/infrastructure/files/docxExtractor'
import { makeTestDocx } from './fixtures/makeTestDocx'

describe('extractDocx', () => {
  it('extracts paragraphs from a DOCX', async () => {
    const blob = await makeTestDocx({
      headings: ['Lecture 3'],
      paragraphs: ['Eigenvalues of a matrix.', 'Characteristic polynomial.'],
    })
    const result = await extractDocx(blob)
    expect(result.textLength).toBeGreaterThan(0)
    expect(result.blocks.some((b) => b.type === 'heading' && /Lecture 3/.test(b.text))).toBe(true)
    expect(
      result.blocks.some((b) => b.type === 'paragraph' && /Eigenvalues/.test(b.text)),
    ).toBe(true)
  })

  it('captures mammoth warnings', async () => {
    const blob = await makeTestDocx({ headings: ['H'], paragraphs: ['P'] })
    const result = await extractDocx(blob)
    // warnings may be empty for clean inputs, but the field must exist
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('rejects non-docx blobs', async () => {
    const bad = new Blob(['this is not a docx'], { type: 'application/octet-stream' })
    await expect(extractDocx(bad)).rejects.toThrow(/DOCX/)
  })
})