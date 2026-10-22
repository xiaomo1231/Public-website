import { PAGE_HEIGHT, PAGE_WIDTH, strokeSegments, type Stroke } from './strokeModel'

/** Draw part of a stroke (from point index `from`) onto a transparent ink layer. */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
  from = 1,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // The eraser removes ink and leaves the paper (a separate layer) untouched.
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = stroke.tool === 'eraser' ? '#000' : stroke.color
  for (const segment of strokeSegments(stroke, from)) {
    ctx.lineWidth = segment.width * scale
    ctx.beginPath()
    ctx.moveTo(segment.x0 * scale, segment.y0 * scale)
    ctx.lineTo(segment.x1 * scale, segment.y1 * scale)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawPage(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  scale: number,
): void {
  ctx.clearRect(0, 0, PAGE_WIDTH * scale, PAGE_HEIGHT * scale)
  for (const stroke of strokes) drawStroke(ctx, stroke, scale)
}

/** Pixel scale of an exported page: 1400 × 1960, within the 2000 px image limit. */
export const EXPORT_SCALE = 1.4

/** One page as a PNG on white paper (ink only, no grid), for an answer image. */
export async function exportPagePng(strokes: readonly Stroke[]): Promise<Blob> {
  const width = Math.round(PAGE_WIDTH * EXPORT_SCALE)
  const height = Math.round(PAGE_HEIGHT * EXPORT_SCALE)
  const ink = document.createElement('canvas')
  ink.width = width
  ink.height = height
  const inkCtx = ink.getContext('2d')
  const paper = document.createElement('canvas')
  paper.width = width
  paper.height = height
  const paperCtx = paper.getContext('2d')
  if (!inkCtx || !paperCtx) throw new Error('canvas unavailable')
  drawPage(inkCtx, strokes, EXPORT_SCALE)
  paperCtx.fillStyle = '#ffffff'
  paperCtx.fillRect(0, 0, width, height)
  paperCtx.drawImage(ink, 0, 0)
  return new Promise((resolve, reject) =>
    paper.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('export failed'))),
      'image/png',
    ),
  )
}
