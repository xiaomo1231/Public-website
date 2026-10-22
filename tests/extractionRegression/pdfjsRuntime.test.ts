import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { extractPdf } from '@/infrastructure/files/pdfExtractor'
import { chunksFromPdf } from '@/infrastructure/files/chunking'
import { detectStructure } from '@/infrastructure/files/structureDetection'

/**
 * The real pdf.js we ship, on synthetic PDFs. pdf.js 6's modern build needs
 * very recent JavaScript APIs; where one is missing, font loading fails and
 * glyphs such as − Δ π ° vanish without an error (Node 24 has none of them).
 * The extractor imports the legacy build, which brings its own polyfills —
 * if anyone switches back to the modern build these tests fail.
 */

async function pdfBytes(build: (doc: PDFDocument) => Promise<void>): Promise<Blob> {
  const doc = await PDFDocument.create()
  await build(doc)
  const bytes = await doc.save()
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
}

beforeAll(async () => {
  // Tests parse on the main thread through pdf.js's "fake worker".
  ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker =
    // @ts-expect-error -- pdfjs-dist ships no type declarations for the worker bundle.
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
})

describe('extraction regression — pdf.js runtime', () => {
  it('runtime-apis: the legacy build provides every API the parser calls', async () => {
    await import('pdfjs-dist/legacy/build/pdf.mjs')
    const map = Map.prototype as unknown as Record<string, unknown>
    expect(typeof map.getOrInsertComputed).toBe('function')
    expect(typeof (Math as unknown as Record<string, unknown>).sumPrecise).toBe('function')
    expect(typeof (Uint8Array.prototype as unknown as Record<string, unknown>).toHex).toBe(
      'function',
    )
    expect(typeof (Uint8Array as unknown as Record<string, unknown>).fromBase64).toBe('function')
    expect(typeof (Promise as unknown as Record<string, unknown>).try).toBe('function')
  })

  it('no-dropped-glyphs: − Δ π ° from a Symbol font and a text font all survive', async () => {
    const blob = await pdfBytes(async (doc) => {
      const page = doc.addPage([400, 300])
      const helvetica = await doc.embedFont(StandardFonts.Helvetica)
      const symbol = await doc.embedFont(StandardFonts.Symbol)
      page.drawText('Angle 60° and', { x: 20, y: 250, size: 12, font: helvetica })
      page.drawText('Δ = π − 1', { x: 120, y: 250, size: 12, font: symbol })
      // An exponent: smaller, raised.
      page.drawText('a = 9.8 m/s', { x: 20, y: 200, size: 12, font: helvetica })
      page.drawText('2', { x: 81, y: 204, size: 8, font: helvetica })
    })
    const result = await extractPdf(blob)
    const text = result.pages[0]!.text
    for (const glyph of ['°', 'π', '−']) expect(text).toContain(glyph)
    // Symbol's "Delta" glyph is reported as U+2206 INCREMENT (or U+0394).
    expect(text).toMatch(/[Δ∆]/)
    expect(text).toContain('m/s²')
  })

  it('table-and-titles: a real table becomes a table chunk; deck dividers become sections', async () => {
    const blob = await pdfBytes(async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const title = doc.addPage([600, 400])
      title.drawText('Unit 3: Reaction', { x: 40, y: 320, size: 30, font })
      title.drawText('Rates and', { x: 40, y: 284, size: 30, font })
      title.drawText('Equilibria', { x: 40, y: 248, size: 30, font })
      const outline = doc.addPage([600, 400])
      outline.drawText('In this unit:', { x: 40, y: 340, size: 20, font })
      outline.drawText('A/ The mole', { x: 40, y: 300, size: 20, font })
      outline.drawText('B/ Yields', { x: 40, y: 270, size: 20, font })
      const divider = doc.addPage([600, 400])
      divider.drawText('A/ The mole and', { x: 40, y: 220, size: 30, font })
      divider.drawText('molar mass', { x: 40, y: 184, size: 30, font })
      const table = doc.addPage([600, 400])
      const rows = [
        ['Salt', 'Colour'],
        ['Sodium chloride', 'White'],
        ['Copper sulfate', 'Blue'],
        ['Iron oxide', 'Red-brown'],
      ]
      rows.forEach(([a, b], index) => {
        table.drawText(a!, { x: 40, y: 340 - index * 18, size: 12, font })
        table.drawText(b!, { x: 300, y: 340 - index * 18, size: 12, font })
      })
      const second = doc.addPage([600, 400])
      second.drawText('B/ Yields', { x: 40, y: 220, size: 30, font })
    })
    const result = await extractPdf(blob)
    const chunks = chunksFromPdf(
      { documentId: 'd', projectId: 'p', documentName: 'Unit 3.pdf', type: 'pdf' },
      result.pages,
    )
    const tableChunk = chunks.find((chunk) => chunk.contentType === 'table')
    expect(tableChunk?.text).toContain('| Sodium chloride | White |')
    const { nodes } = detectStructure(chunks)
    expect(nodes.map((node) => `${node.type}:${node.number}:${node.title}`)).toEqual([
      'unit:3:Reaction Rates and Equilibria',
      'section:A:The mole and molar mass',
      'section:B:Yields',
    ])
  })
})
