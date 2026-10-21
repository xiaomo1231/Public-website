import { Loader2, Pause, Play, Square } from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { GenerationRunState } from '@/shared/lib/generationControl'
import { cn } from '@/shared/lib/utils'
import { Button } from './Button'

export interface GenerationControlsProps {
  /**
   * `parts` — a multi-part generation: 暂停 / 立即停止 while it runs, 继续
   * once it was paused or stopped. `single` — one request: 停止 while it runs.
   */
  kind: 'parts' | 'single'
  /** The run's state; `null` / `undefined` when nothing is running. */
  state: GenerationRunState | null | undefined
  /** Parts finished / planned, for the "paused (x / y)" line. */
  done?: number
  total?: number
  /** An immediate stop was requested (the "pausing" line then says "stopping"). */
  stopRequested?: boolean
  onPause?: () => void
  onStopNow?: () => void
  /** Continue a paused run. Without it no 继续 button is shown. */
  onResume?: () => void
  /** Extra line shown while paused (e.g. what survives a reload). */
  pausedHint?: string
  /** Hide the status line (the host already shows one). */
  hideStatus?: boolean
  className?: string
}

/**
 * Pause / continue / stop buttons for an AI generation, placed to the right
 * of its progress indicator. Renders nothing when there is nothing to control.
 */
export function GenerationControls({
  kind,
  state,
  done,
  total,
  stopRequested = false,
  onPause,
  onStopNow,
  onResume,
  pausedHint,
  hideStatus = false,
  className,
}: GenerationControlsProps) {
  const { t } = useTranslation()
  if (!state || state === 'done') return null
  const running = state === 'running'
  const pausing = state === 'pausing'
  const ended = state === 'paused' || state === 'stopped'
  if (kind === 'single' && ended && hideStatus) return null

  let status: string | null = null
  if (pausing) {
    status =
      kind === 'single' || stopRequested
        ? t('generation.stopping')
        : t('generation.finishingCurrent')
  } else if (state === 'paused') {
    status =
      typeof done === 'number' && typeof total === 'number' && total > 0
        ? t('generation.paused', { done, total })
        : t('generation.pausedShort')
  } else if (state === 'stopped') {
    status = kind === 'single' ? t('generation.stoppedKept') : t('generation.stoppedSaved')
  }

  return (
    <div
      role="group"
      aria-label={t('generation.controls')}
      className={cn('flex flex-wrap items-center gap-2', className)}
      data-generation-state={state}
    >
      {!hideStatus && status && (
        <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {pausing && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {status}
        </span>
      )}
      {kind === 'parts' && running && onPause && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onPause}
          title={t('generation.pauseHint')}
        >
          <Pause aria-hidden />
          {t('generation.pause')}
        </Button>
      )}
      {kind === 'parts' && (running || (pausing && !stopRequested)) && onStopNow && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onStopNow}
          title={t('generation.stopNowHint')}
        >
          <Square aria-hidden />
          {t('generation.stopNow')}
        </Button>
      )}
      {kind === 'single' && running && onStopNow && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onStopNow}
          title={t('generation.stopHint')}
        >
          <Square aria-hidden />
          {t('generation.stop')}
        </Button>
      )}
      {kind === 'parts' && ended && onResume && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onResume}
          title={t('generation.resumeHint')}
        >
          <Play aria-hidden />
          {t('generation.resume')}
        </Button>
      )}
      {kind === 'parts' && ended && pausedHint && !hideStatus && (
        <span className="basis-full text-xs text-muted-foreground">{pausedHint}</span>
      )}
    </div>
  )
}
