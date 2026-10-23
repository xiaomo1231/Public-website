import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { ExamWorkspaceView } from '@/services/studyPlanService'
import type { PlanSuggestion, StudyTask } from '@/entities/studyPlan/types'
import { dayKey, parseDayKey } from '@/entities/studyPlan/calendar'
import { formatDate } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { ExamTaskList } from './ExamTaskList'
import { TabSection } from './TabSection'
import { PHASE_KEYS } from './workspaceHelpers'

function groupByDay(tasks: readonly StudyTask[]): Array<[string, StudyTask[]]> {
  const days = new Map<string, StudyTask[]>()
  for (const task of tasks) days.set(task.date, [...(days.get(task.date) ?? []), task])
  return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * 时间线: only this exam's tasks, day by day from today (完成 / 跳过 / 改日期),
 * the current phase, what the last layout could not fit and the suggestions;
 * earlier days are folded away.
 */
export function TimelineTab({
  view,
  onChanged,
}: {
  view: ExamWorkspaceView
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { exam } = view.context
  const today = dayKey(Date.now())
  const upcoming = useMemo(
    () => groupByDay(view.tasks.filter((task) => task.date >= today)),
    [view.tasks, today],
  )
  const earlier = useMemo(
    () => groupByDay(view.tasks.filter((task) => task.date < today)).reverse(),
    [view.tasks, today],
  )

  function suggestion(item: PlanSuggestion): string {
    switch (item.kind) {
      case 'add_minutes':
        return t('plan.overflow.addMinutes', { minutes: item.minutesPerDay })
      case 'use_off_days':
        return t('plan.overflow.useOffDays', { days: item.days })
      case 'lower_weight':
        return t('plan.overflow.lowerWeight', { name: exam.name })
      case 'skip_mastered':
        return t('plan.overflow.skipMastered', { count: item.topics })
    }
  }

  const day = (date: string) => {
    const label = formatDate(parseDayKey(date).getTime())
    return date === today ? t('examWorkspace.todayLabel', { date: label }) : label
  }

  return (
    <div className="space-y-8" data-workspace-timeline>
      <p className="text-sm text-muted-foreground">
        {t('examWorkspace.phaseNow', { phase: t(PHASE_KEYS[view.phase]) })} ·{' '}
        {t('examWorkspace.daysLeft', { days: view.context.daysLeft })}
      </p>

      {view.overflow.dropped.length > 0 && (
        <div
          className="space-y-2 rounded-md border border-amber-500/60 px-3 py-2 text-sm lab:rounded-none"
          data-workspace-overflow
        >
          <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {t('plan.overflow.title', {
              count: view.overflow.dropped.length,
              minutes: view.overflow.dropped.reduce((sum, item) => sum + item.minutes, 0),
            })}
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {view.overflow.dropped.slice(0, 8).map((item, i) => (
              <li key={`${item.topicId ?? item.label}-${i}`}>
                {item.label} · {t('plan.task.minutes', { minutes: item.minutes })}
              </li>
            ))}
          </ul>
          {view.overflow.suggestions.length > 0 && (
            <ul className="space-y-0.5">
              {view.overflow.suggestions.map((item, i) => (
                <li key={i}>→ {suggestion(item)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('examWorkspace.timelineEmpty')}</p>
      ) : (
        upcoming.map(([date, tasks]) => (
          <TabSection
            key={date}
            title={
              <span className="tabular-nums">
                {day(date)}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {t('plan.task.minutes', {
                    minutes: tasks
                      .filter((task) => task.status !== 'skipped')
                      .reduce((sum, task) => sum + task.minutes, 0),
                  })}
                </span>
              </span>
            }
            data-timeline-day={date}
          >
            <ExamTaskList exam={exam} tasks={tasks} onChanged={onChanged} />
          </TabSection>
        ))
      )}

      {earlier.length > 0 && (
        <details className="space-y-3" data-timeline-earlier>
          <summary className="focus-ring cursor-pointer rounded-sm text-sm text-muted-foreground hover:text-foreground coarse:py-2">
            {t('examWorkspace.earlier', {
              count: earlier.reduce((sum, [, tasks]) => sum + tasks.length, 0),
            })}
          </summary>
          <div className="mt-3 space-y-6">
            {earlier.map(([date, tasks]) => (
              <TabSection key={date} title={<span className="tabular-nums">{day(date)}</span>}>
                <ExamTaskList exam={exam} tasks={tasks} onChanged={onChanged} />
              </TabSection>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
