import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Loader2 } from 'lucide-react'
import type { Mistake } from '@/entities/mistake/types'
import type { MistakeVariant } from '@/entities/mistake/followUp'
import { Button } from '@/shared/ui/Button'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import { VariantRunner } from './MistakeFollowUp'
import { followUpReasonKey, useFollowUpService } from './followUpHelpers'

/**
 * 今天要复测 n 题: the due re-tests as a short quiz — one mistake at a time,
 * each with a NEW verified variant; the result moves its schedule.
 */
export function RetestBanner({
  projectId,
  onChanged,
  onlyIds,
}: {
  projectId: string
  onChanged: () => void
  /** Only these mistakes (an exam's scope, 考试工作台); absent = all due. */
  onlyIds?: readonly string[]
}): JSX.Element | null {
  const { t } = useTranslation()
  const service = useFollowUpService()
  const [due, setDue] = useState<Mistake[]>([])
  const [running, setRunning] = useState(false)
  const [index, setIndex] = useState(0)
  const [variant, setVariant] = useState<MistakeVariant | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useGenerationRun({ abortOnUnmount: true })

  const onlyKey = onlyIds ? onlyIds.join(',') : null
  const reload = useCallback(async () => {
    if (!service) return
    const rows = await service.dueRetests(projectId)
    const only = onlyKey === null ? null : new Set(onlyKey.split(','))
    setDue(only ? rows.filter((row) => only.has(row.id)) : rows)
  }, [service, projectId, onlyKey])

  useEffect(() => {
    void reload()
  }, [reload])

  const prepare = useCallback(
    async (mistake: Mistake | undefined) => {
      if (!service || !mistake) return
      const generation = run.start()
      setError(null)
      setVariant(null)
      try {
        setVariant(await service.createVariant(mistake.id, 'retest', { control: generation }))
      } catch (err) {
        if (!isGenerationInterruption(err, generation)) setError(friendlyAIError(err))
      } finally {
        generation.finish()
      }
    },
    [service, run],
  )

  if (due.length === 0 && !running) return null
  const current = due[index]

  return (
    <section
      className="space-y-3 rounded-lg border border-primary/40 p-4 lecture:rounded-none lab:rounded-none"
      aria-label={t('followUp.retestTitle')}
      data-retest-banner
    >
      <div className="flex flex-wrap items-center gap-3">
        <CalendarClock className="h-5 w-5 text-primary" aria-hidden />
        <p className="flex-1 font-medium">
          {running
            ? t('followUp.retestProgress', {
                n: Math.min(index + 1, due.length),
                total: due.length,
              })
            : t('followUp.retestToday', { count: due.length })}
        </p>
        {!running && (
          <Button
            size="sm"
            disabled={!service}
            onClick={() => {
              setRunning(true)
              setIndex(0)
              void prepare(due[0])
            }}
          >
            {t('followUp.retestStart')}
          </Button>
        )}
      </div>
      {running && current && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground" data-retest-reason>
            {t('followUp.retestFor', { kp: current.knowledgePoint })} ·{' '}
            {t(followUpReasonKey(current))}
          </p>
          {run.active && (
            <Loader2 className="h-4 w-4 animate-spin" aria-label={t('followUp.preparing')} />
          )}
          <GenerationControls kind="single" state={run.state} onStopNow={run.stopNow} />
          {error && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void prepare(current)}>
                {t('followUp.retryPrepare')}
              </Button>
            </div>
          )}
          {variant && service && (
            <VariantRunner
              key={variant.id}
              variant={variant}
              service={service}
              mistakeId={current.id}
              onChecked={() => onChanged()}
            />
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = index + 1
                if (next >= due.length) {
                  setRunning(false)
                  setVariant(null)
                  void reload()
                  return
                }
                setIndex(next)
                void prepare(due[next])
              }}
            >
              {index + 1 >= due.length ? t('followUp.retestFinish') : t('followUp.retestNext')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Course home: 今天要复测 n 题 → the mistake book (hidden when nothing is due). */
export function DueRetestsLink({ projectId }: { projectId: string }): JSX.Element | null {
  const { t } = useTranslation()
  const service = useFollowUpService()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!service) return
    let alive = true
    void service.dueRetests(projectId).then((rows) => {
      if (alive) setCount(rows.length)
    })
    return () => {
      alive = false
    }
  }, [service, projectId])
  if (count === 0) return null
  return (
    <Link
      to={`/projects/${projectId}/mistakes`}
      className="flex min-h-[44px] items-center gap-2 rounded-md border border-primary/40 px-3 py-2 text-sm font-medium hover:bg-accent lecture:rounded-none lab:rounded-none"
      data-due-retests
    >
      <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
      {t('followUp.retestToday', { count })}
    </Link>
  )
}
