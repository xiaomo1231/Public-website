/**
 * Local clean-up of a photographed page before OCR: shadows and uneven light
 * are divided out (each pixel against the mean brightness of its
 * neighbourhood), the result is greyscale. Nothing leaves the device.
 *
 * Measured on the course's own exam photos (11 phone pictures, tesseract
 * `eng`, pictures scaled to 2000 px): mean confidence 70.6 → 74.4 and
 * confident words (≥ 80) 1159 → 1265. It hurt a few evenly lit pictures, so
 * OCR keeps whichever pass is more confident (see `ocrExtractor.ts`).
 */

/** Window radius (pixels) for the background estimate. */
function radiusFor(width: number, height: number): number {
  return Math.max(8, Math.round(Math.min(width, height) / 40))
}

/**
 * Divide out the local background of an RGBA image (in place on a copy).
 * Pure: `rgba` is not modified.
 */
export function normalizeIllumination(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const n = width * height
  const out = new Uint8ClampedArray(rgba.length)
  if (n === 0 || rgba.length < n * 4) return out
  const luma = new Float64Array(n)
  for (let i = 0; i < n; i++)
    luma[i] = 0.299 * rgba[4 * i]! + 0.587 * rgba[4 * i + 1]! + 0.114 * rgba[4 * i + 2]!
  // Integral image of the brightness, for constant-time window means.
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += luma[y * width + x]!
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + row
    }
  }
  const r = radiusFor(width, height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const sum =
        integral[y1 * stride + x1]! -
        integral[y0 * stride + x1]! -
        integral[y1 * stride + x0]! +
        integral[y0 * stride + x0]!
      const mean = sum / ((y1 - y0) * (x1 - x0))
      const value = Math.min(255, ((255 * luma[y * width + x]!) / Math.max(1, mean)) * 0.95)
      const i = 4 * (y * width + x)
      out[i] = out[i + 1] = out[i + 2] = value
      out[i + 3] = 255
    }
  }
  return out
}

/** Longest side of the cleaned-up copy (keeps the work bounded on 12 MP photos). */
const MAX_SIDE = 2000

/**
 * The illumination-normalised copy of a picture as PNG. Browser-only: returns
 * `null` where images cannot be decoded or drawn (tests), which just skips
 * the second OCR pass.
 */
export async function illuminationNormalizedImage(blob: Blob): Promise<Blob | null> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined')
      return null
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const image = context.getImageData(0, 0, width, height)
    image.data.set(normalizeIllumination(image.data, width, height))
    context.putImageData(image, 0, 0)
    return await canvas.convertToBlob({ type: 'image/png' })
  } catch {
    return null
  }
}
