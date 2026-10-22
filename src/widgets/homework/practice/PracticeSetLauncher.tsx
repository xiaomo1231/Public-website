import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Dumbbell, Loader2 } from 'lucide-react'
import type { HomeworkSet } from '@/entities/homework/types'
import type { PracticeMode } from '@/entities/homework/practice/types'
import type { PracticeRunProgress, PracticeRunResult } from '@/services/practiceSetService'
import { usePracticeSetService } from '@/features/homework/usePracticeSetService'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { Button } from '@/shared/ui/Button'
import { Badge } from '@/shared/ui/Badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { Progress } from '@/shared/ui/Progress'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

const STAGE_KEYS: Record<PracticeRunProgress['stage'], TranslationKey> = {
  writing: 'practiceSet.stage.writing',
  reviewing: 'practiceSet.stage.reviewing',
  saving: 'practiceSet.stage.saving',
}

const MODE_KEYS: Record<PracticeMode, { name: TranslationKey; hint: TranslationKey }> = {
  full: { name: 'practiceSet.mode.full', hint: 'practiceSet.mode.fullHint' },
  compact: { name: 'practiceSet.mode.compact', hint: 'practiceSet.mode.compactHint' },
}

/**
 * 「做练习题」 under the walkthrough summary: choose 完整版 / 精简版, watch the
 * build (pausable), then open the new practice set. Earlier practice sets of
 * this assignment are listed for quick access.
 */
export function PracticeSetLauncher({ set }: { set: HomeworkSet }): JSX.Element | null {
  const { t } = useTranslation()
  const service = usePracticeSetService()
  const [open, setOpen] = useState(false)
  const [existing, setExisting] = useState<HomeworkSet[]>([])

  const load = useCallback(async () => {
    if (!service) return
    setExisting(await service.listPracticeSets(set.id))
  }, [service, set.id])

  useEffect(() => {
    void load().catch(() => undefined)
  }, [load])

  if (set.kind === 'practice') return null

  return (
    <section
      data-print-hidden
      data-practice-launcher
      className="mt-10 space-y-3 border-t pt-6 lecture:max-w-[70ch]"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-lg font-semibold lecture:text-[20px] lecture:font-bold">
          {t('practiceSet.heading')}
        </h2>
        <Button onClick={() => setOpen(true)} disabled={!service}>
          <Dumbbell className="h-4 w-4" aria-hidden />
          {t('practiceSet.open')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('practiceSet.intro')}</p>
      {existing.length > 0 && (
        <ul className="space-y-1 text-sm">
          {existing.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <Link
                to={`/projects/${set.projectId}/homework/${item.id}`}
                className="focus-ring text-primary underline-offset-4 hover:underline"
              >
                {item.title}
              </Link>
              <PracticeStatusBadge set={item} />
            </li>
          ))}
        </ul>
      )}
      {service && (
        <PracticeSetDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) void load()
          }}
          set={set}
          service={service}
          onChanged={() => void load()}
        />
      )}
    </section>
  )
}

export function PracticeStatusBadge({ set }: { set: HomeworkSet }): JSX.Element {
  const { t } = useTranslation()
  if (set.status === 'ready')
    return <Badge variant="outline">{t('practiceSet.count', { count: set.questionCount })}</Badge>
  if (set.status === 'paused')
    return <Badge variant="outline">{t('practiceSet.status.paused')}</Badge>
  if (set.status === 'failed')
    return <Badge variant="destructive">{t('practiceSet.status.failed')}</Badge>
  return <Badge variant="secondary">{t('practiceSet.status.building')}</Badge>
}

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  set: HomeworkSet
  service: NonNullable<ReturnType<typeof usePracticeSetService>>
  onChanged: () => void
}

function PracticeSetDialog({ open, onOpenChange, set, service, onChanged }: DialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PracticeMode>('full')
  const [preview, setPreview] = useState<Record<
    PracticeMode,
    { total: number; local: number }
  > | null>(null)
  const [progress, setProgress] = useState<PracticeRunProgress | null>(null)
  const [result, setResult] = useState<PracticeRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { run, state, start, finish } = useGenerationRun()
  const running = state === 'running' || state === 'pausing'

  useEffect(() => {
    if (!open) return
    setResult(null)
    setError(null)
    void service
      .preview(set.id)
      .then(setPreview)
      .catch((err) => setError(friendlyAIError(err)))
  }, [open, service, set.id])

  const go = async (resumeId?: string): Promise<void> => {
    setError(null)
    setResult(null)
    const control = start()
    try {
      const options = { control, onProgress: setProgress }
      const next = resumeId
        ? await service.resume(resumeId, options)
        : await service.create(set.id, mode, options)
      setResult(next)
      if (next.set.status === 'failed' && next.set.errorMessage) setError(next.set.errorMessage)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      finish()
      setProgress(null)
      onChanged()
    }
  }

  const stageText = progress
    ? t(STAGE_KEYS[progress.stage], {
        done: progress.completed,
        total: progress.total,
      })
    : ''
  const paused = result?.paused === true

  return (
    <Dialog open={open} onOpenChange={(next) => (!running ? onOpenChange(next) : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('practiceSet.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('practiceSet.dialogBody')}</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label={t('practiceSet.modeLabel')} className="grid gap-2">
          {(['full', 'compact'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={mode === item}
              disabled={running}
              onClick={() => setMode(item)}
              className={cn(
                'focus-ring rounded-lg border p-3 text-left transition-colors duration-150 lab:rounded-none',
                mode === item ? 'border-primary bg-theme-primary-soft/40' : 'hover:bg-muted',
              )}
            >
              <span className="block font-medium">{t(MODE_KEYS[item].name)}</span>
              <span className="block text-sm text-muted-foreground">{t(MODE_KEYS[item].hint)}</span>
              {preview && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t('practiceSet.previewCount', {
                    count: preview[item].total,
                    local: preview[item].local,
                  })}
                </span>
              )}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{t('practiceSet.reviewNote')}</p>

        {(running || paused) && (
          <div className="space-y-2">
            {progress && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {stageText}
              </p>
            )}
            {progress && progress.total > 0 && (
              <Progress value={(progress.completed / progress.total) * 100} />
            )}
            <GenerationControls
              kind="parts"
              state={state}
              stopRequested={run?.stopRequested ?? false}
              onPause={() => run?.requestPause()}
              onStopNow={() => run?.stopNow()}
              {...(paused && result ? { onResume: () => void go(result.set.id) } : {})}
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && !result.paused && result.set.status === 'ready' && (
          <div className="space-y-2 rounded-lg border p-3 text-sm lab:rounded-none">
            <p>
              {t('practiceSet.done', { count: result.created })}
              {result.dropped > 0 &&
                ` ${t('practiceSet.droppedSummary', { count: result.dropped })}`}
            </p>
            {(result.set.practice?.droppedReasons ?? []).length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {result.set.practice!.droppedReasons!.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {result && !result.paused && result.set.status === 'ready' ? (
            <Button asChild>
              <Link to={`/projects/${set.projectId}/homework/${result.set.id}`}>
                {t('practiceSet.openSet')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : result && result.set.status === 'failed' ? (
            <Button onClick={() => void go(result.set.id)} disabled={running}>
              {t('practiceSet.retry')}
            </Button>
          ) : (
            <Button
              onClick={() => void go()}
              disabled={running || paused || !service.hasAI() || !preview}
              title={service.hasAI() ? undefined : t('homework.noProvider')}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Dumbbell className="h-4 w-4" />
              )}
              {t('practiceSet.start')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
