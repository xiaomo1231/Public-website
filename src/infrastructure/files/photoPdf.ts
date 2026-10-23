import { PDFDocument } from 'pdf-lib'
import { prepareAnswerImage } from './imageDownscale'

/**
 * 考卷照片合并: photos of one paper become one PDF, one photo per page, built in
 * the browser with pdf-lib. Each photo is fitted onto an A4 page (portrait or
 * landscape to match the photo) keeping its aspect ratio. The PDF has no text
 * layer, so processing reads every page with local OCR and — for a paper,
 * homework or answer key — the vision model (看图识别), like a photo file.
 */

export interface PdfPageImage {
  bytes: ArrayBuffer | Uint8Array
  mimeType: 'image/jpeg' | 'image/png'
  width: number
  height: number
}

/** A4 in PDF points. */
const A4 = { short: 595.28, long: 841.89 }
const MARGIN = 18

/** Page size and image box for one photo (pure; exported for tests). */
export function fitOnPage(
  width: number,
  height: number,
): { page: [number, number]; box: { x: number; y: number; width: number; height: number } } {
  const landscape = width > height
  const pageWidth = landscape ? A4.long : A4.short
  const pageHeight = landscape ? A4.short : A4.long
  const maxWidth = pageWidth - 2 * MARGIN
  const maxHeight = pageHeight - 2 * MARGIN
  const scale = Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height))
  const w = width * scale
  const h = height * scale
  return {
    page: [pageWidth, pageHeight],
    box: { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h },
  }
}

/** One PDF with the images as pages, in the given order. */
export async function imagesToPdf(
  pages: ReadonlyArray<PdfPageImage>,
  options: { title?: string } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  if (options.title) pdf.setTitle(options.title)
  pdf.setProducer('AI Learning Platform')
  for (const image of pages) {
    const bytes = image.bytes instanceof Uint8Array ? image.bytes : new Uint8Array(image.bytes)
    const embedded =
      image.mimeType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    const { page, box } = fitOnPage(embedded.width, embedded.height)
    pdf.addPage(page).drawImage(embedded, box)
  }
  return pdf.save()
}

/**
 * Browser-only: downscale a photo (`prepareAnswerImage`: ≤2000 px, HEIC →
 * JPEG) and make sure pdf-lib can embed it (WebP is re-encoded as JPEG).
 */
export async function preparePdfPage(file: Blob): Promise<PdfPageImage> {
  const prepared = await prepareAnswerImage(file)
  if (prepared.mimeType === 'image/jpeg' || prepared.mimeType === 'image/png') {
    return {
      bytes: prepared.bytes,
      mimeType: prepared.mimeType,
      width: prepared.width,
      height: prepared.height,
    }
  }
  const bitmap = await createImageBitmap(new Blob([prepared.bytes], { type: prepared.mimeType }))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88),
    )
    if (!blob) throw new Error('jpeg encode failed')
    return {
      bytes: await blob.arrayBuffer(),
      mimeType: 'image/jpeg',
      width: bitmap.width,
      height: bitmap.height,
    }
  } finally {
    bitmap.close?.()
  }
}

export type PdfPagePreparer = (file: Blob) => Promise<PdfPageImage>

/** Merge photos (already in page order) into one PDF `File` named `name`. */
export async function buildPhotoPdfFile(
  files: ReadonlyArray<Blob>,
  name: string,
  prepare: PdfPagePreparer = preparePdfPage,
): Promise<File> {
  const pages: PdfPageImage[] = []
  for (const file of files) pages.push(await prepare(file))
  const bytes = await imagesToPdf(pages, { title: name.replace(/\.pdf$/i, '') })
  // Copy into a plain ArrayBuffer (pdf-lib may return a view on a larger one).
  const buffer = bytes.slice().buffer
  return new File([buffer], name, { type: 'application/pdf', lastModified: Date.now() })
}
