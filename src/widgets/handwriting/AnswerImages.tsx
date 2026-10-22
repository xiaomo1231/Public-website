import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, PenLine, X } from 'lucide-react'
import type { HomeworkAnswerImage } from '@/entities/homework/answerImages'
import { MAX_ANSWER_IMAGES_PER_QUESTION } from '@/entities/homework/answerImages'
import type { HomeworkAnswerImageService } from '@/services/homeworkAnswerImageService'
import { Button } from '@/shared/ui/Button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/Dialog'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import { PenBoardDialog } from './PenBoardDialog'

/**
 * Where the images are kept: the question's homework answer
 * (`HomeworkAnswerImageService`) or one mock exam attempt
 * (`MockExamService.imageStore`).
 */
export type AnswerImageStore = Pick<HomeworkAnswerImageService, 'list' | 'add' | 'remove' | 'move'>

export interface AnswerImagesProps {
  questionId: string
  service: AnswerImageStore
  /** Called with the current images after every load / change. */
  onChange?: (images: HomeworkAnswerImage[]) => void
  disabled?: boolean
}

/**
 * Handwritten working for one homework answer: upload / photograph pages, or
 * write them on the pen board. Thumbnails can be enlarged, reordered and
 * removed. Images stay on this device until the student checks the answer or
 * asks the AI about THIS question.
 */
export function AnswerImages({
  questionId,
  service,
  onChange,
  disabled = false,
}: AnswerImagesProps): JSX.Element {
  const { t } = useTranslation()
  const [images, setImages] = useState<HomeworkAnswerImage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [penOpen, setPenOpen] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const imagesRef = useRef<HomeworkAnswerImage[]>([])
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    const next = await service.list(questionId)
    if (!mountedRef.current) return
    // No images before or after: nothing to update (the common case).
    if (next.length === 0 && imagesRef.current.length === 0) return
    imagesRef.current = next
    setImages(next)
    onChangeRef.current?.(next)
  }, [questionId, service])

  useEffect(() => {
    // Without stored images (or storage) the answer simply has none yet.
    void reload().catch(() => undefined)
  }, [reload])

  // Created and revoked by the same effect (a memo + cleanup pair would hand
  // out revoked URLs after StrictMode's simulated unmount).
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const next = images.map((image) =>
      URL.createObjectURL(new Blob([image.bytes], { type: image.mimeType })),
    )
    setUrls(next)
    return () => next.forEach((url) => URL.revokeObjectURL(url))
  }, [images])

  async function run(task: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      try {
        await reload()
      } catch {
        /* keep the last list */
      }
      setBusy(false)
    }
  }

  async function addFiles(files: readonly Blob[], source: HomeworkAnswerImage['source']) {
    // One by one, so a bad file never costs the others.
    const failures: string[] = []
    for (const file of files) {
      try {
        await service.add(questionId, file, source)
      } catch (err) {
        failures.push(friendlyAIError(err))
      }
    }
    if (failures.length) throw new Error([...new Set(failures)].join(' '))
  }

  const full = images.length >= MAX_ANSWER_IMAGES_PER_QUESTION
  const shown = viewing !== null ? images[viewing] : undefined

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          // image/* lets a tablet offer its camera as well as the photo library.
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])]
            event.currentTarget.value = ''
            if (files.length) void run(() => addFiles(files, 'upload'))
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11"
          disabled={disabled || busy || full}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus aria-hidden />
          {t('homework.images.upload')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11"
          disabled={disabled || busy || full}
          onClick={() => setPenOpen(true)}
        >
          <PenLine aria-hidden />
          {t('homework.images.penBoard')}
        </Button>
        {busy && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t('homework.images.saving')}
          </span>
        )}
        {full && (
          <span className="text-xs text-muted-foreground">
            {t('homework.images.tooMany', { max: MAX_ANSWER_IMAGES_PER_QUESTION })}
          </span>
        )}
      </div>

      {images.length > 0 && (
        <ol aria-label={t('homework.images.label')} className="flex flex-wrap gap-3">
          {images.map((image, index) => (
            <li
              key={image.id}
              // Wide enough for three 44 px touch targets under the thumbnail.
              className="relative w-[9.5rem] space-y-1 rounded-lg border border-border bg-card p-1.5 lab:rounded-none"
            >
              <button
                type="button"
                className="focus-ring block w-full overflow-hidden rounded-md bg-card lab:rounded-none"
                aria-label={t('homework.images.enlarge', { n: index + 1 })}
                onClick={() => setViewing(index)}
              >
                <img
                  src={urls[index]}
                  alt={t('homework.images.alt', { n: index + 1 })}
                  className="h-24 w-full object-contain"
                />
              </button>
              <span
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-2.5 rounded bg-background/90 px-1.5 text-xs tabular-nums text-muted-foreground"
              >
                {index + 1}
              </span>
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  disabled={disabled || busy || index === 0}
                  aria-label={t('homework.images.moveEarlier', { n: index + 1 })}
                  title={t('homework.images.moveEarlier', { n: index + 1 })}
                  onClick={() => void run(() => service.move(questionId, image.id, -1))}
                >
                  <ArrowLeft aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  disabled={disabled || busy || index === images.length - 1}
                  aria-label={t('homework.images.moveLater', { n: index + 1 })}
                  title={t('homework.images.moveLater', { n: index + 1 })}
                  onClick={() => void run(() => service.move(questionId, image.id, 1))}
                >
                  <ArrowRight aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-destructive"
                  disabled={disabled || busy}
                  aria-label={t('homework.images.remove', { n: index + 1 })}
                  title={t('homework.images.remove', { n: index + 1 })}
                  onClick={() => void run(() => service.remove(questionId, image.id))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {images.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('homework.images.privacy')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {penOpen && (
        <PenBoardDialog
          open={penOpen}
          onOpenChange={setPenOpen}
          onSave={async (pages) => {
            let failed: unknown = null
            await run(async () => {
              try {
                await addFiles(pages, 'pen')
              } catch (err) {
                failed = err
                throw err
              }
            })
            // Keep the board open (with its ink) when saving failed.
            if (failed) throw failed
          }}
        />
      )}

      <Dialog open={shown !== undefined} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-4xl gap-3 p-4">
          <DialogTitle>
            {t('homework.images.viewerTitle', {
              n: (viewing ?? 0) + 1,
              total: images.length,
            })}
          </DialogTitle>
          {shown && viewing !== null && (
            <>
              <div className="max-h-[75vh] overflow-auto rounded-lg bg-card">
                <img
                  src={urls[viewing]}
                  alt={t('homework.images.alt', { n: viewing + 1 })}
                  className="mx-auto h-auto max-w-full"
                />
              </div>
              {images.length > 1 && (
                <div className="flex justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={viewing === 0}
                    onClick={() => setViewing(viewing - 1)}
                  >
                    <ArrowLeft aria-hidden />
                    {t('homework.images.previous')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={viewing === images.length - 1}
                    onClick={() => setViewing(viewing + 1)}
                  >
                    {t('homework.images.next')}
                    <ArrowRight aria-hidden />
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
