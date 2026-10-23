import { Link } from 'react-router-dom'
import { ArrowRight, Loader2, Play } from 'lucide-react'
import type { HomeworkSet } from '@/entities/homework/types'
import { Button } from '@/shared/ui/Button'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useHomeworkRun } from '@/features/homework/homeworkRuns'
import { pausedCardActions } from '@/widgets/homework/pausedCardActions'
import { useTranslation } from '@/i18n'

/**
 * The run status of one assignment / past paper card: progress while it is
 * read or prepared, 暂停 / 立即停止 while live, 继续 once paused. Shared by
 * the 作业 page and the 考试工作台's 考题与讲解 tab.
 */

/**
 * Pause / stop while an assignment is read or prepared, 继续 once paused. A
 * paused set read from storage (after a reload) offers 继续 without a run.
 */
/** A paused card: the status line, 继续 as the primary action, then 打开讲解. */
export function PausedSetActions({
  set,
  href,
  disabled,
  onResume,
}: {
  set: HomeworkSet
  href: string
  disabled: boolean
  onResume: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { state } = useHomeworkRun(set.documentId)
  const actions = pausedCardActions({
    live: state === 'running' || state === 'pausing',
    questionCount: set.questionCount,
  })
  return (
    <div className="space-y-2">
      {/* Status (paused x / y) and hint; 继续 is the button below. */}
      <SetRunControls set={set} />
      {actions.resume && (
        <Button
          className="w-full"
          onClick={onResume}
          disabled={disabled}
          title={t('generation.resumeHint')}
        >
          <Play className="h-4 w-4" aria-hidden />
          {t('generation.resume')}
        </Button>
      )}
      {actions.open && (
        <Button
          asChild
          variant={actions.open === 'primary' ? 'default' : 'outline'}
          className="w-full"
        >
          <Link to={href}>
            {t('homework.open')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      )}
    </div>
  )
}

export function SetRunControls({
  set,
  onResume,
}: {
  set: HomeworkSet
  onResume?: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const { run, state } = useHomeworkRun(set.documentId)
  const live = state === 'running' || state === 'pausing'
  if (set.status === 'paused' && !live) {
    const total = set.progress?.total
    return (
      <GenerationControls
        kind="parts"
        state={state === 'stopped' ? 'stopped' : 'paused'}
        done={set.progress?.completed ?? 0}
        {...(typeof total === 'number' ? { total } : {})}
        {...(onResume ? { onResume } : {})}
        {...(set.progress?.stage !== 'generating'
          ? { pausedHint: t('homework.pausedIdentifyingHint') }
          : {})}
      />
    )
  }
  if (!live || !run) return null
  return (
    <GenerationControls
      kind="parts"
      state={state}
      stopRequested={run.stopRequested}
      onPause={() => run.requestPause()}
      onStopNow={() => run.stopNow()}
    />
  )
}

/**
 * Stage-aware progress for one assignment card.
 *
 * The bar is only ever driven by real finished work units stored on the set
 * (`progress.completed` / `progress.total`); when the total is not yet known it
 * falls back to an indeterminate bar rather than a fake percentage.
 */
export function SetProgress({ set }: { set: HomeworkSet }): JSX.Element {
  const { t } = useTranslation()
  const progress = set.progress
  const total = progress?.total
  const determinate = typeof total === 'number' && total > 0
  const completed = progress?.completed ?? 0
  const generating = progress?.stage === 'generating'
  const label = generating
    ? determinate
      ? t('homework.progress.generating', { current: completed, total: total as number })
      : t('homework.progress.generatingUnknown')
    : determinate
      ? t('homework.progress.identifying', { current: completed, total: total as number })
      : t('homework.progress.identifyingUnknown')
  const value = determinate ? Math.round((completed / (total as number)) * 100) : undefined
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {label}
      </p>
      <HomeworkProgressBar value={value} label={label} />
    </div>
  )
}

export function HomeworkProgressBar({
  value,
  label,
}: {
  value?: number
  label: string
}): JSX.Element {
  const indeterminate = value === undefined
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': value })}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      {indeterminate ? (
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
      ) : (
        <div
          className="h-full w-full rounded-full bg-primary transition-transform duration-200 ease-out"
          style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, value))}%)` }}
        />
      )}
    </div>
  )
}
