import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Crop, ImagePlus, Loader2, ScanLine, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Badge } from '@/shared/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Label } from '@/shared/ui/Label'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import {
  assignmentSummary,
  cropToPixels,
  FULL_PAGE,
  isUsableCrop,
  pointInBox,
  rectFromPoints,
  type CropRect,
} from '@/entities/handwriting/crop'
import type { ExamImageStore, MockExamHandwriting } from '@/services/mockExamService'

interface UploadedPage {
  id: string
  file: File
  url: string
}

/** Cut `rect` (page fractions) out of the photo at full resolution, as a JPEG. */
async function cropPhoto(file: Blob, rect: CropRect): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const px = cropToPixels(rect, bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = px.width
    canvas.height = px.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, px.width, px.height)
    ctx.drawImage(bitmap, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('crop failed'))),
        'image/jpeg',
        0.92,
      ),
    )
  } finally {
    bitmap.close?.()
  }
}

/**
 * 纸上作答 → 拍照上传: photograph the finished pages, then give each region
 * (or a whole page) to its question. Each region is saved at once as one
 * answer image of that question in this attempt; the page photos themselves
 * stay in memory only (a reload keeps the saved regions, not the pages).
 * Nothing is recognised until 「完成上传，开始识别」.
 */
export function PaperAnswerUpload({
  questions,
  handwriting,
  store,
  onChanged,
  onDone,
}: {
  questions: Array<{ id: string; number: string }>
  handwriting: MockExamHandwriting
  store: ExamImageStore
  onChanged: () => Promise<void> | void
  onDone: () => Promise<void> | void
}): JSX.Element {
  const { t } = useTranslation()
  const [pages, setPages] = useState<UploadedPage[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [questionId, setQuestionId] = useState(questions[0]?.id ?? '')
  const [rect, setRect] = useState<CropRect | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragRef = useRef<{ pointerId: number; start: { x: number; y: number } } | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => () => pages.forEach((page) => URL.revokeObjectURL(page.url)), [pages])

  const page = pages[pageIndex]
  const numberOf = useMemo(() => new Map(questions.map((q) => [q.id, q.number])), [questions])
  // Regions already saved, from this session's pages, drawn on the photo.
  const savedOnPage = handwriting.items.flatMap((item) =>
    item.images
      .filter((image) => image.crop && page && image.crop.page === pageIndex)
      .map((image) => ({ id: image.id, questionId: item.questionId, rect: image.crop! })),
  )
  const summary = assignmentSummary(
    questions.map((q) => q.id),
    handwriting.items.flatMap((item) =>
      item.images.map((image) => ({
        id: image.id,
        pageIndex: image.crop?.page ?? 0,
        rect: image.crop ?? FULL_PAGE,
        questionId: item.questionId,
      })),
    ),
  )

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const box = overlayRef.current?.getBoundingClientRect()
    if (!box) return
    event.preventDefault()
    overlayRef.current?.setPointerCapture?.(event.pointerId)
    const start = pointInBox({ x: event.clientX, y: event.clientY }, box)
    dragRef.current = { pointerId: event.pointerId, start }
    setRect(null)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    const box = overlayRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !box) return
    setRect(rectFromPoints(drag.start, pointInBox({ x: event.clientX, y: event.clientY }, box)))
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setRect((current) => (current && isUsableCrop(current) ? current : null))
  }

  async function assign(region: CropRect): Promise<void> {
    if (!page || !questionId) return
    setBusy(true)
    setError(null)
    try {
      const blob = region === FULL_PAGE ? page.file : await cropPhoto(page.file, region)
      await store.add(questionId, blob, 'upload', { crop: { ...region, page: pageIndex } })
      setRect(null)
      await onChanged()
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(imageQuestionId: string, imageId: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await store.remove(imageQuestionId, imageId)
      await onChanged()
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-paper-upload>
      <CardHeader>
        <CardTitle className="text-base">{t('paperUpload.title')}</CardTitle>
        <CardDescription>{t('paperUpload.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])].filter((file) =>
              file.type.startsWith('image/'),
            )
            event.currentTarget.value = ''
            if (!files.length) return
            setPages((prev) => [
              ...prev,
              ...files.map((file) => ({
                id: crypto.randomUUID(),
                file,
                url: URL.createObjectURL(file),
              })),
            ])
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus aria-hidden />
            {t('paperUpload.addPages')}
          </Button>
          {pages.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('paperUpload.pages')}>
              {pages.map((item, index) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={index === pageIndex ? 'default' : 'outline'}
                  className="h-11 min-w-11"
                  aria-pressed={index === pageIndex}
                  onClick={() => {
                    setPageIndex(index)
                    setRect(null)
                  }}
                >
                  {t('paperUpload.pageN', { n: index + 1 })}
                </Button>
              ))}
            </div>
          )}
        </div>

        {page ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex justify-center rounded-md border bg-muted/30 p-2">
              <div className="relative inline-block">
                <img
                  src={page.url}
                  alt={t('paperUpload.pageAlt', { n: pageIndex + 1 })}
                  className="block max-h-[70vh] max-w-full select-none"
                  draggable={false}
                />
                <div
                  ref={overlayRef}
                  role="presentation"
                  // Drawing a region with a finger or the pen must not scroll.
                  className="absolute inset-0 cursor-crosshair touch-none"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    dragRef.current = null
                  }}
                >
                  {savedOnPage.map((item) => (
                    <div
                      key={item.id}
                      className="pointer-events-none absolute border-2 border-primary/70 bg-primary/10"
                      style={{
                        left: `${item.rect.x * 100}%`,
                        top: `${item.rect.y * 100}%`,
                        width: `${item.rect.width * 100}%`,
                        height: `${item.rect.height * 100}%`,
                      }}
                    >
                      <span className="absolute left-0 top-0 bg-primary-strong px-1 text-xs text-primary-foreground">
                        {numberOf.get(item.questionId)}
                      </span>
                    </div>
                  ))}
                  {rect && (
                    <div
                      className="pointer-events-none absolute border-2 border-dashed border-foreground bg-foreground/10"
                      style={{
                        left: `${rect.x * 100}%`,
                        top: `${rect.y * 100}%`,
                        width: `${rect.width * 100}%`,
                        height: `${rect.height * 100}%`,
                      }}
                      data-crop-selection
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{t('paperUpload.dragHint')}</p>
              <div className="space-y-1">
                <Label htmlFor="paper-upload-question">{t('paperUpload.question')}</Label>
                <select
                  id="paper-upload-question"
                  className="h-11 w-full rounded-md border border-input bg-background px-2"
                  value={questionId}
                  onChange={(event) => setQuestionId(event.target.value)}
                >
                  {questions.map((q) => (
                    <option key={q.id} value={q.id}>
                      {t('mockExam.questionLabel', { number: q.number })}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                className="h-11 w-full"
                disabled={busy || !rect}
                onClick={() => rect && void assign(rect)}
              >
                <Crop aria-hidden />
                {t('paperUpload.assignRegion')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => void assign(FULL_PAGE)}
              >
                {t('paperUpload.assignPage')}
              </Button>
              {busy && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {t('homework.images.saving')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t('paperUpload.noPages')}</p>
        )}

        <div className="space-y-2">
          <p className="font-medium">{t('paperUpload.assigned')}</p>
          <ul className="space-y-1">
            {questions.map((q) => {
              const item = handwriting.items.find((entry) => entry.questionId === q.id)
              const count = summary.counts.get(q.id) ?? 0
              return (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center gap-2"
                  data-paper-question={q.id}
                >
                  <span className="min-w-[6rem]">
                    {t('mockExam.questionLabel', { number: q.number })}
                  </span>
                  <Badge variant={count ? 'secondary' : 'outline'}>
                    {count ? t('paperUpload.regions', { count }) : t('paperUpload.none')}
                  </Badge>
                  {item?.images.map((image, index) => (
                    <Button
                      key={image.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-11"
                      disabled={busy}
                      aria-label={t('paperUpload.removeRegion', { n: index + 1, number: q.number })}
                      onClick={() => void remove(q.id, image.id)}
                    >
                      <X aria-hidden />
                      {index + 1}
                    </Button>
                  ))}
                </li>
              )
            })}
          </ul>
          {summary.unassigned.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('paperUpload.unassignedNote', { count: summary.unassigned.length })}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" className="h-11" disabled={busy} onClick={() => void onDone()}>
            <ScanLine aria-hidden />
            {t('paperUpload.done')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
