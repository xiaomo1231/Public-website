import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import {
  useExams,
  useStudyPlanChanged,
  useStudyPlanService,
} from '@/features/studyPlan/useStudyPlan'
import { useDiagnosticServices } from '@/features/studyPlan/useDiagnosticService'
import type { PlanSuggestion, StudyPlan } from '@/entities/studyPlan/types'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { isAbortError } from '@/shared/lib/generationControl'
import { useTranslation } from '@/i18n'

/**
 * What the plan could not fit (with trade-offs to choose from), and the
 * optional AI summary of priorities and risks (one request, stoppable).
 */
export function PlanInsights(): JSX.Element | null {
  const { t, language } = useTranslation()
  const service = useStudyPlanService()
  const { summary: summaryService, hasAI } = useDiagnosticServices()
  const { exams } = useExams()
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const run = useGenerationRun()
  useStudyPlanChanged(() => setTick((n) => n + 1))
  useEffect(() => {
    let alive = true
    void service.getPlan().then((next) => {
      if (alive) setPlan(next)
    })
    return () => {
      alive = false
    }
  }, [service, tick])
  const names = useMemo(() => new Map(exams.map((exam) => [exam.id, exam.name])), [exams])

  function suggestion(item: PlanSuggestion): string {
    switch (item.kind) {
      case 'add_minutes':
        return t('plan.overflow.addMinutes', { minutes: item.minutesPerDay })
      case 'use_off_days':
        return t('plan.overflow.useOffDays', { days: item.days })
      case 'lower_weight':
        return t('plan.overflow.lowerWeight', { name: names.get(item.examId) ?? '' })
      case 'skip_mastered':
        return t('plan.overflow.skipMastered', { count: item.topics })
    }
  }

  async function summarize() {
    if (!summaryService) return
    setError(null)
    const control = run.start()
    try {
      await summaryService.summarize(language === 'zh-CN' ? 'zh' : 'en', { signal: control.signal })
      setPlan(await service.getPlan())
    } catch (err) {
      if (!isAbortError(err, control.signal)) setError(friendlyAIError(err))
    } finally {
      control.finish()
    }
  }

  if (!plan) return null
  const overflow = plan.overflow
  const running = run.state === 'running' || run.state === 'pausing'
  return (
    <div className="space-y-4">
      {overflow && overflow.dropped.length > 0 && (
        <div
          className="space-y-2 rounded-md border border-amber-500/40 bg-amber-50/50 px-3 py-2 text-sm dark:bg-amber-950/20"
          data-plan-overflow
        >
          <p className="font-medium">
            {t('plan.overflow.title', {
              count: overflow.dropped.length,
              minutes: overflow.droppedMinutes,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {overflow.dropped
              .slice(0, 8)
              .map((item) => item.label)
              .filter(Boolean)
              .join(' · ')}
          </p>
          {overflow.suggestions.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {overflow.suggestions.map((item, i) => (
                <li key={i}>{suggestion(item)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {exams.some((exam) => exam.at > Date.now()) && (
        <div className="space-y-2" data-plan-summary>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!hasAI || running}
              onClick={() => void summarize()}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {plan.summary ? t('plan.summary.refresh') : t('plan.summary.create')}
            </Button>
            <GenerationControls
              kind="single"
              state={run.state}
              onStopNow={run.stopNow}
              hideStatus
            />
            {!hasAI && (
              <span className="text-xs text-muted-foreground">{t('plan.diagnostic.needsAI')}</span>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {plan.summary && (
            <div className="whitespace-pre-wrap rounded-md border bg-card px-3 py-2 text-sm lab:rounded-none">
              <p className="mb-1 text-xs text-muted-foreground">{t('plan.summary.label')}</p>
              {plan.summary.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
