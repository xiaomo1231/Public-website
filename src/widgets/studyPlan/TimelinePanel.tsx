import { useEffect, useMemo, useState } from 'react'
import {
  useExams,
  useStudyPlanChanged,
  useStudyPlanService,
} from '@/features/studyPlan/useStudyPlan'
import type { ExamPhase, TimelineView } from '@/services/studyPlanService'
import { parseDayKey } from '@/entities/studyPlan/calendar'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'

const PHASE_KEYS: Record<ExamPhase, TranslationKey> = {
  first_pass: 'plan.phase.first_pass',
  mock: 'plan.phase.mock',
  final: 'plan.phase.final',
  exam: 'plan.phase.exam',
}

/**
 * 时间线: the plan week by week (minutes planned against minutes available,
 * each exam's phase), and per topic its first pass, reviews and a mastery
 * trend from practice (estimates).
 */
export function TimelinePanel(): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const { exams } = useExams()
  const [view, setView] = useState<TimelineView | null>(null)
  const [tick, setTick] = useState(0)
  useStudyPlanChanged(() => setTick((n) => n + 1))
  useEffect(() => {
    let alive = true
    void service.timeline().then((next) => {
      if (alive) setView(next)
    })
    return () => {
      alive = false
    }
  }, [service, tick])
  const names = useMemo(() => new Map(exams.map((exam) => [exam.id, exam.name])), [exams])

  if (!view) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  if (view.weeks.length === 0 || exams.length === 0)
    return <p className="text-sm text-muted-foreground">{t('plan.weights.none')}</p>

  return (
    <section className="space-y-8" data-plan-timeline>
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">{t('plan.timeline.weeks')}</h2>
        <ol className="space-y-3">
          {view.weeks.map((week) => (
            <li key={week.start} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {t('plan.timeline.weekOf', { date: week.start })}
                </span>
                {week.phases.map((phase) => (
                  <span
                    key={phase.examId}
                    className={cn(
                      'rounded-full border px-2 py-0.5 lab:rounded-none',
                      phase.phase === 'final' && 'border-destructive/50 text-destructive',
                      phase.phase === 'exam' &&
                        'border-destructive bg-destructive/10 text-destructive',
                    )}
                  >
                    {names.get(phase.examId) ?? ''} · {t(PHASE_KEYS[phase.phase])}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {week.days.map((day) => {
                  const fill = day.available > 0 ? Math.min(1, day.planned / day.available) : 0
                  const date = parseDayKey(day.date)
                  return (
                    <div
                      key={day.date}
                      className="rounded-sm border p-1 text-[11px] tabular-nums lab:rounded-none"
                      title={t('plan.timeline.dayTitle', {
                        date: day.date,
                        planned: day.planned,
                        available: day.available,
                      })}
                    >
                      <div className="text-muted-foreground">{date.getDate()}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${fill * 100}%` }} />
                      </div>
                      <div className="mt-0.5">
                        {day.available === 0 ? '—' : `${day.planned}/${day.available}`}
                      </div>
                    </div>
                  )
                })}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">{t('plan.timeline.topics')}</h2>
        <p className="text-xs text-muted-foreground">{t('plan.timeline.estimateNote')}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1">
                  {t('plan.timeline.topic')}
                </th>
                <th scope="col">{t('plan.timeline.exam')}</th>
                <th scope="col">{t('plan.timeline.firstPass')}</th>
                <th scope="col">{t('plan.timeline.reviews')}</th>
                <th scope="col">{t('plan.timeline.mastery')}</th>
                <th scope="col">{t('plan.timeline.trend')}</th>
              </tr>
            </thead>
            <tbody>
              {view.topics.map((topic) => (
                <tr key={`${topic.examId}:${topic.topicId}`} className="border-t">
                  <td className="py-1 pr-2">{topic.name}</td>
                  <td className="pr-2 text-muted-foreground">{names.get(topic.examId) ?? ''}</td>
                  <td className="pr-2">
                    {topic.learned
                      ? t('plan.timeline.learned')
                      : topic.learnDate
                        ? topic.learnDate
                        : t('plan.timeline.notScheduled')}
                  </td>
                  <td className="pr-2">
                    {topic.reviewsDone}/{topic.reviewsDone + topic.reviewsPlanned}
                  </td>
                  <td className="pr-2">
                    {topic.mastery === null ? '—' : `${Math.round(topic.mastery * 100)}%`}
                  </td>
                  <td>
                    <span
                      className="inline-flex h-4 items-end gap-0.5"
                      aria-label={t('plan.timeline.trendAria', {
                        values: topic.trend
                          .map((value) => (value === null ? '—' : `${Math.round(value * 100)}%`))
                          .join(', '),
                      })}
                    >
                      {topic.trend.map((value, i) => (
                        <span
                          key={i}
                          className={cn('w-1.5 bg-primary', value === null && 'bg-muted')}
                          style={{ height: `${value === null ? 15 : Math.max(10, value * 100)}%` }}
                        />
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
