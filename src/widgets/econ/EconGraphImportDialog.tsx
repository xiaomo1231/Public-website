import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Upload } from 'lucide-react'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { GraphReading, KeyComparison } from '@/entities/econ/graphRead'
import type { EconGraphImportService, GraphImage } from '@/services/econGraphImportService'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { MarketQuestionFigure } from './MarketQuestionFigure'

type Step = 'pick' | 'confirm' | 'variants' | 'done'

function sourceText(image: GraphImage, t: ReturnType<typeof useTranslation>['t']): string {
  switch (image.source.kind) {
    case 'visual':
    case 'page':
      return t('econGraph.source.visual', { page: image.source.page })
    case 'answer':
      return t('econGraph.source.answer', { n: image.source.index })
    case 'upload':
      return t('econGraph.source.upload')
  }
}

/**
 * 「把这张图做成可交互图并出同类题」: pick the picture of the graph, let the
 * vision model read it, compare the rebuilt (computed) diagram with the
 * original and confirm it — never used silently — then, when the professor's
 * answer does not disagree with it, create similar questions (改编题).
 */
export function EconGraphImportDialog({
  open,
  onOpenChange,
  question,
  service,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  question: HomeworkQuestion
  service: EconGraphImportService
}): JSX.Element {
  const { t, language } = useTranslation()
  const [images, setImages] = useState<GraphImage[] | null>(null)
  const [picked, setPicked] = useState(0)
  const [step, setStep] = useState<Step>('pick')
  const [reading, setReading] = useState<GraphReading | null>(null)
  const [comparison, setComparison] = useState<KeyComparison | null>(null)
  const [rejected, setRejected] = useState(false)
  const [count, setCount] = useState(3)
  const [created, setCreated] = useState<HomeworkSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useGenerationRun({ abortOnUnmount: true })

  useEffect(() => {
    if (!open) return
    let alive = true
    setStep('pick')
    setReading(null)
    setComparison(null)
    setCreated(null)
    setRejected(false)
    setError(null)
    void service
      .candidates(question)
      .then((found) => alive && setImages(found))
      .catch(() => alive && setImages([]))
    return () => {
      alive = false
    }
  }, [open, question, service])

  const image = images?.[picked]
  const url = useMemo(
    () => (image ? URL.createObjectURL(new Blob([image.bytes], { type: image.mimeType })) : null),
    [image],
  )
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    const upload: GraphImage = {
      source: { kind: 'upload' },
      bytes: await file.arrayBuffer(),
      mimeType: file.type,
    }
    setImages((current) => [upload, ...(current ?? [])])
    setPicked(0)
  }

  const read = async () => {
    if (!image) return
    const generation = run.start()
    setError(null)
    setRejected(false)
    try {
      const next = await service.read(question, image, {
        signal: generation.signal,
        language: language === 'zh-CN' ? 'zh' : 'en',
      })
      setReading(next)
      setComparison(service.compare(question, next))
      setStep('confirm')
    } catch (err) {
      if (!isGenerationInterruption(err, generation)) setError(friendlyAIError(err))
    } finally {
      generation.finish()
    }
  }

  const create = async () => {
    if (!reading) return
    setBusy(true)
    setError(null)
    try {
      const set = await service.createVariants(question, reading, {
        count,
        language: language === 'zh-CN' ? 'zh' : 'en',
        comparison,
      })
      setCreated(set)
      setStep('done')
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  const disagree = comparison?.status === 'disagree'
  const reading_ = run.state === 'running' || run.state === 'pausing'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto" data-econ-graph-dialog>
        <DialogHeader>
          <DialogTitle>{t('econGraph.title')}</DialogTitle>
          <DialogDescription>{t('econGraph.intro')}</DialogDescription>
        </DialogHeader>

        {step === 'pick' && (
          <div className="space-y-3">
            {rejected && <p className="text-sm text-muted-foreground">{t('econGraph.rejected')}</p>}
            <p className="text-sm font-medium">{t('econGraph.images')}</p>
            {images && images.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('econGraph.noImages')}</p>
            )}
            {images && images.length > 0 && (
              <div
                role="radiogroup"
                aria-label={t('econGraph.images')}
                className="flex flex-wrap gap-2"
              >
                {images.map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    role="radio"
                    aria-checked={picked === index}
                    onClick={() => setPicked(index)}
                    className={cn(
                      'focus-ring min-h-11 rounded-md border px-3 text-xs',
                      picked === index
                        ? 'border-primary bg-primary/10'
                        : 'border-border/80 text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {sourceText(item, t)}
                  </button>
                ))}
              </div>
            )}
            {url && (
              <img
                src={url}
                alt={t('econGraph.original')}
                className="max-h-80 rounded-md border object-contain"
              />
            )}
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border/80 px-3 text-sm hover:bg-accent">
              <Upload className="h-4 w-4" aria-hidden />
              {t('econGraph.upload')}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => void onUpload(e)}
              />
            </label>
          </div>
        )}

        {step !== 'pick' && reading && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <figure className="space-y-1">
                <figcaption className="text-xs font-medium">
                  {t('econGraph.original')}
                  {image ? ` · ${t('econGraph.readFrom', { source: sourceText(image, t) })}` : ''}
                </figcaption>
                {url && (
                  <img
                    src={url}
                    alt={t('econGraph.original')}
                    className="w-full rounded-md border object-contain"
                  />
                )}
              </figure>
              <div className="space-y-1">
                <p className="text-xs font-medium">{t('econGraph.rebuilt')}</p>
                <MarketQuestionFigure figure={reading.figure} className="w-full" />
                {reading.scenarioUnknown && (
                  <p className="text-xs text-muted-foreground">{t('econGraph.scenarioUnknown')}</p>
                )}
              </div>
            </div>
            <p className="text-sm" data-key-comparison={comparison?.status ?? 'none'}>
              {comparison === null
                ? t('econGraph.compare.noKey')
                : comparison.status === 'no-numbers'
                  ? t('econGraph.compare.noNumbers')
                  : t(
                      comparison.status === 'agree'
                        ? 'econGraph.compare.agree'
                        : 'econGraph.compare.disagree',
                      {
                        detail: comparison.details.join('; '),
                      },
                    )}
            </p>
            {step === 'confirm' && (
              <p className="text-sm font-medium">{t('econGraph.confirmPrompt')}</p>
            )}
            {step === 'variants' && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="econ-graph-count">{t('econGraph.variantCount')}</Label>
                  <Input
                    id="econ-graph-count"
                    type="number"
                    min={1}
                    max={6}
                    value={count}
                    onChange={(event) => setCount(Number(event.target.value) || 1)}
                    className="h-11 w-24"
                  />
                </div>
              </div>
            )}
            {step === 'done' && created && (
              <p className="text-sm" role="status">
                {t('econGraph.created', { count: created.questionCount })}{' '}
                <Link
                  className="underline"
                  to={`/projects/${created.projectId}/homework/${created.id}`}
                  onClick={() => onOpenChange(false)}
                >
                  {t('econGraph.open')}
                </Link>
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="flex-wrap gap-2">
          <GenerationControls kind="single" state={run.state} onStopNow={run.stopNow} />
          {step === 'pick' && (
            <Button onClick={() => void read()} disabled={!image || reading_ || !service.hasAI()}>
              {reading_ && <Loader2 className="h-4 w-4 animate-spin" />}
              {reading_ ? t('econGraph.reading') : t('econGraph.read')}
            </Button>
          )}
          {step === 'confirm' && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setRejected(true)
                  setStep('pick')
                  setReading(null)
                }}
              >
                {t('econGraph.reject')}
              </Button>
              <Button onClick={() => setStep('variants')} disabled={disagree}>
                {t('econGraph.confirm')}
              </Button>
            </>
          )}
          {step === 'variants' && (
            <Button onClick={() => void create()} disabled={busy || disagree}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('econGraph.create')}
            </Button>
          )}
        </DialogFooter>
        {!service.hasAI() && step === 'pick' && (
          <p className="text-xs text-muted-foreground">{t('econGraph.noAi')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
