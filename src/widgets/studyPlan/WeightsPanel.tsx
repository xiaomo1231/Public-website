import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Slider } from '@/shared/ui/Slider'
import { useExams, useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { toast } from '@/features/toast/toastStore'
import type { WeightsView } from '@/services/studyPlanService'
import { rebalanceShares, type WeightReason } from '@/entities/studyPlan/weights'
import type { ExamWeightSetting } from '@/entities/studyPlan/types'
import { useTranslation } from '@/i18n'

/**
 * 权重: suggested time shares per exam with the reasons in plain words, and
 * sliders that always add up to 100 % (moving one rebalances the unlocked
 * others in proportion; a lock keeps an exam's share). Saving re-plans.
 */
export function WeightsPanel(): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const { exams } = useExams()
  const [view, setView] = useState<WeightsView | null>(null)
  const [shares, setShares] = useState<Record<string, ExamWeightSetting>>({})
  const [busy, setBusy] = useState(false)
  // The latest shares, for the slider's commit (fired right after a change).
  const latest = useRef(shares)
  latest.current = shares
  const names = useMemo(() => new Map(exams.map((exam) => [exam.id, exam.name])), [exams])

  const load = useCallback(() => {
    void service.weights().then((next) => {
      setView(next)
      setShares(next.shares)
    })
  }, [service])
  useEffect(load, [load])

  async function persist(next: Record<string, ExamWeightSetting> | undefined) {
    setBusy(true)
    try {
      await service.setWeights(next)
      await service.replan()
      load()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('plan.errors.actionFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  function reason(r: WeightReason): string {
    switch (r.kind) {
      case 'days':
        return t(`plan.weights.reason.days.${r.level}` as const, { days: r.days })
      case 'mastery':
        return t(`plan.weights.reason.mastery.${r.level}` as const, { percent: r.percent })
      case 'no_mastery':
        return t('plan.weights.reason.noMastery')
      case 'mock':
        return t('plan.weights.reason.mock', { percent: r.percent })
      case 'difficulty':
        return t(`plan.weights.reason.difficulty.${r.level}` as const)
      case 'topics':
        return t('plan.weights.reason.topics', { count: r.count })
      case 'little_time':
        return t('plan.weights.reason.littleTime', { minutes: r.minutes })
    }
  }

  if (!view) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  if (view.suggestions.length === 0)
    return <p className="text-sm text-muted-foreground">{t('plan.weights.none')}</p>

  return (
    <section className="space-y-5" data-plan-weights>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold">{t('plan.weights.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('plan.weights.hint')}</p>
      </div>
      <ul className="space-y-5">
        {view.suggestions.map((suggestion) => {
          const current = shares[suggestion.examId] ?? { share: suggestion.share, locked: false }
          const label = names.get(suggestion.examId) ?? ''
          return (
            <li key={suggestion.examId} className="space-y-2" data-weight-exam={suggestion.examId}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{label}</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums" aria-live="polite">
                    {current.share}%
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-pressed={current.locked}
                    aria-label={
                      current.locked
                        ? t('plan.weights.unlock', { name: label })
                        : t('plan.weights.lock', { name: label })
                    }
                    onClick={() => {
                      const next = {
                        ...shares,
                        [suggestion.examId]: { ...current, locked: !current.locked },
                      }
                      setShares(next)
                      void persist(next)
                    }}
                  >
                    {current.locked ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <LockOpen className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[current.share]}
                disabled={busy || current.locked}
                aria-label={t('plan.weights.slider', { name: label })}
                onValueChange={([value]) => {
                  const next = rebalanceShares(latest.current, suggestion.examId, value ?? 0)
                  latest.current = next
                  setShares(next)
                }}
                onValueCommit={() => void persist(latest.current)}
              />
              <p className="text-xs text-muted-foreground">
                {t('plan.weights.suggested', { share: suggestion.share })}{' '}
                {suggestion.reasons.map(reason).join('；')}
              </p>
            </li>
          )
        })}
      </ul>
      {view.manual && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void persist(undefined)}>
          {t('plan.weights.reset')}
        </Button>
      )}
    </section>
  )
}
