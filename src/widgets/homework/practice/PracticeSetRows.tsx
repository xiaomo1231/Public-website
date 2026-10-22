import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Play, Trash2 } from 'lucide-react'
import type { HomeworkSet } from '@/entities/homework/types'
import { usePracticeSetService } from '@/features/homework/usePracticeSetService'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import { PracticeStatusBadge } from './PracticeSetLauncher'

/**
 * The practice sets made from one assignment, listed under its card on the
 * homework page: open, continue an unfinished build, delete.
 */
export function PracticeSetRows({
  projectId,
  sets,
  onChanged,
}: {
  projectId: string
  sets: HomeworkSet[]
  onChanged: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  if (sets.length === 0) return null
  return (
    <div className="space-y-1.5 border-t pt-3 lecture:border-t-0 lecture:pt-0" data-practice-sets>
      <p className="text-xs font-medium text-muted-foreground">{t('practiceSet.listTitle')}</p>
      <ul className="space-y-1.5">
        {sets.map((set) => (
          <PracticeSetRow key={set.id} projectId={projectId} set={set} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  )
}

function PracticeSetRow({
  projectId,
  set,
  onChanged,
}: {
  projectId: string
  set: HomeworkSet
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const service = usePracticeSetService()
  const [confirm, setConfirm] = useState(false)
  const { run, state, start, finish } = useGenerationRun()
  const running = state === 'running' || state === 'pausing'
  // 继续 needs a draft to continue from (a build where every question was
  // dropped is `failed` with nothing left to do).
  const unfinished =
    (set.status === 'paused' || set.status === 'failed') && Boolean(set.practice?.draft)
  const stranded =
    set.status === 'analyzing' && !running && Boolean(service) && !service!.isRunning(set.id)

  // Building, but no run behind it (the page was reloaded mid-build).
  useEffect(() => {
    if (!stranded || !service) return
    let alive = true
    void service
      .recoverInterrupted(set.id)
      .then((next) => {
        if (alive && next && next.status !== 'analyzing') onChanged()
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [stranded, service, set.id, onChanged])

  const resume = async (): Promise<void> => {
    if (!service) return
    const control = start()
    try {
      await service.resume(set.id, { control })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('practiceSet.status.failed'),
        description: friendlyAIError(err),
      })
    } finally {
      finish()
      onChanged()
    }
  }

  const remove = async (): Promise<void> => {
    if (!service) return
    try {
      await service.deletePracticeSet(set.id, projectId)
      toast({ variant: 'success', title: t('practiceSet.deleted') })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('homework.deleteFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setConfirm(false)
      onChanged()
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      {set.status === 'ready' ? (
        <Link
          to={`/projects/${projectId}/homework/${set.id}`}
          className="focus-ring min-w-0 truncate text-primary underline-offset-4 hover:underline"
        >
          {set.title}
        </Link>
      ) : (
        <span className="min-w-0 truncate">{set.title}</span>
      )}
      <PracticeStatusBadge set={set} />
      {running ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
          <GenerationControls
            kind="parts"
            state={state}
            stopRequested={run?.stopRequested ?? false}
            onPause={() => run?.requestPause()}
            onStopNow={() => run?.stopNow()}
          />
        </>
      ) : (
        unfinished && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void resume()}
            disabled={!service?.hasAI() || service.isRunning(set.id)}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {t('generation.resume')}
          </Button>
        )
      )}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-destructive hover:text-destructive"
        aria-label={t('practiceSet.delete')}
        onClick={() => setConfirm(true)}
        // A build started from the launcher dialog runs without this row's control.
        disabled={running || !service || service.isRunning(set.id)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('practiceSet.deleteTitle')}
        description={t('practiceSet.deleteBody', { name: set.title })}
        confirmLabel={t('practiceSet.delete')}
        onConfirm={() => void remove()}
      />
    </li>
  )
}
