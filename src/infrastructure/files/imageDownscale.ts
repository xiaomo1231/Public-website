import {
  fitWithin,
  isAnswerImageMimeType,
  MAX_ANSWER_IMAGE_BYTES,
  MAX_ANSWER_IMAGE_EDGE,
  type AnswerImageMimeType,
} from '@/entities/homework/answerImages'

export interface PreparedImage {
  bytes: ArrayBuffer
  mimeType: AnswerImageMimeType
  width: number
  height: number
}

/** Why an image could not be prepared; the service maps it to a message. */
export class ImagePrepareError extends Error {
  constructor(readonly reason: 'type' | 'decode' | 'size') {
    super(`image ${reason}`)
    this.name = 'ImagePrepareError'
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Raster image types the browser may hand over (e.g. HEIC from an iPad camera). */
export function isConvertibleImageType(type: string): boolean {
  return isAnswerImageMimeType(type) || (/^image\//.test(type) && !/svg/i.test(type))
}

/**
 * Decode an uploaded image and keep it at most `MAX_ANSWER_IMAGE_EDGE` on the
 * long side. A small enough JPEG / PNG / WebP is kept byte-for-byte; otherwise
 * it is re-encoded (PNG stays PNG unless that is too large; other decodable
 * types such as HEIC become JPEG). Anything still above
 * `MAX_ANSWER_IMAGE_BYTES` is refused. Runs in the browser only (canvas);
 * tests inject their own preparer.
 */
export async function prepareAnswerImage(file: Blob): Promise<PreparedImage> {
  if (!isConvertibleImageType(file.type)) throw new ImagePrepareError('type')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // A type the browser cannot decode is as good as unsupported.
    throw new ImagePrepareError(isAnswerImageMimeType(file.type) ? 'decode' : 'type')
  }
  const sourceType: AnswerImageMimeType = isAnswerImageMimeType(file.type)
    ? file.type
    : 'image/jpeg'
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_ANSWER_IMAGE_EDGE)
    const unchanged = width === bitmap.width && height === bitmap.height
    if (unchanged && file.size <= MAX_ANSWER_IMAGE_BYTES && isAnswerImageMimeType(file.type)) {
      return { bytes: await file.arrayBuffer(), mimeType: file.type, width, height }
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new ImagePrepareError('decode')
    // Answers are read like paper: transparency becomes white (and JPEG has none).
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    const attempts: Array<[AnswerImageMimeType, number | undefined]> =
      sourceType === 'image/png'
        ? [
            ['image/png', undefined],
            ['image/jpeg', 0.9],
            ['image/jpeg', 0.75],
          ]
        : [
            [sourceType, 0.9],
            [sourceType, 0.75],
            // Browsers that cannot encode WebP fall back to JPEG.
            ['image/jpeg', 0.85],
          ]
    for (const [type, quality] of attempts) {
      const blob = await toBlob(canvas, type, quality)
      if (blob && blob.size <= MAX_ANSWER_IMAGE_BYTES && blob.type === type) {
        return { bytes: await blob.arrayBuffer(), mimeType: type, width, height }
      }
    }
    throw new ImagePrepareError('size')
  } finally {
    bitmap.close?.()
  }
}
