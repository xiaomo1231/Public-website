import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface TestPdfOptions {
  pages?: Array<{
    heading?: string
    paragraphs?: string[]
  }>
}

/**
 * Build a minimal multi-page PDF in memory for extractor tests.
 */
export async function makeTestPdf(options: TestPdfOptions = {}): Promise<Blob> {
  const pages = options.pages ?? [
    {
      heading: 'Chapter 1: Derivatives',
      paragraphs: [
        'The derivative measures the sensitivity of a function to changes in its input.',
        'The slope of the tangent line equals the derivative at a point.',
      ],
    },
    {
      heading: 'Chapter 2: Integrals',
      paragraphs: ['Integration is the reverse of differentiation.', 'Integral of x squared dx.'],
    },
  ]

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const body = await doc.embedFont(StandardFonts.Helvetica)
  let y = 0
  for (const page of pages) {
    const pdfPage = doc.addPage([595, 842])
    y = 780
    if (page.heading) {
      pdfPage.drawText(page.heading, { x: 50, y, size: 18, font, color: rgb(0, 0, 0) })
      y -= 30
    }
    for (const paragraph of page.paragraphs ?? []) {
      const lines = wrapText(paragraph, body, 11, 495)
      for (const line of lines) {
        pdfPage.drawText(line, { x: 50, y, size: 11, font: body })
        y -= 16
        if (y < 60) break
      }
    }
  }

  const bytes = await doc.save()
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([arrayBuffer], { type: 'application/pdf' })
}

function wrapText(text: string, _font: unknown, _size: number, maxWidth: number): string[] {
  const approxCharWidth = 5.5
  const maxChars = Math.floor(maxWidth / approxCharWidth)
  const words = text.split(/\s+/)
  const lines: string[] = []
  let buffer = ''
  for (const word of words) {
    if ((buffer + ' ' + word).trim().length > maxChars && buffer) {
      lines.push(buffer)
      buffer = word
    } else {
      buffer = buffer ? `${buffer} ${word}` : word
    }
  }
  if (buffer) lines.push(buffer)
  return lines
}