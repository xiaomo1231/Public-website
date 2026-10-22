import type { PdfTextItem } from '@/infrastructure/files/pdfLayout'

/**
 * One synthetic pdf.js text item. `y` is the baseline in PDF user space
 * (larger = higher on the page), `h` the font size, as pdf.js reports them.
 * Whitespace items get height 0, exactly like pdf.js.
 */
export function item(
  str: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontName?: string,
): PdfTextItem {
  return {
    str,
    width: w,
    height: str.trim() === '' ? 0 : h,
    transform: [h, 0, 0, h, x, y],
    ...(fontName ? { fontName } : {}),
  }
}
