import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import type { FocusCourseTotal, FocusDayTotal } from '@/entities/focus/types'
import { FocusService, lastDaysRange } from '@/services/focusService'
import { useProjects } from '@/features/project/useProjects'
import { usePomodoroStore } from '@/features/focus/pomodoroStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { LoadingState } from '@/shared/ui/LoadingState'
import { cn } from '@/shared/lib/utils'
import { LOCALE_TAGS, useTranslation } from '@/i18n'
import { FOCUS_STATS_DAYS, formatFocusDuration } from '@/features/focus/focusFormat'

interface StatsData {
  days: FocusDayTotal[]
  courses: FocusCourseTotal[]
}

/**
 * 设置 → 学习时长: focus time from the pomodoro, per day for the last 14 days
 * and per course. Reads `focusSessions` only; nothing here calls the AI.
 */
export function FocusStatsCard({
  className,
  headerClassName,
  titleClassName,
  bodyClassName,
}: {
  className?: string
  headerClassName?: string
  titleClassName?: string
  bodyClassName?: string
}): JSX.Element {
  const { t, language } = useTranslation()
  const { projects } = useProjects()
  const [data, setData] = useState<StatsData | null>(null)
  const [failed, setFailed] = useState(false)
  // Re-read when a focus phase ends or is closed in this tab.
  const sessionKey = usePomodoroStore((s) => `${s.timer.phase}:${s.timer.sessionId ?? ''}`)

  useEffect(() => {
    let alive = true
    const range = lastDaysRange(FOCUS_STATS_DAYS)
    const service = new FocusService()
    Promise.all([service.listByDay(range), service.totalsByCourse(range)])
      .then(([days, courses]) => {
        if (alive) {
          setData({ days, courses })
          setFailed(false)
        }
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [sessionKey])

  const dayFormat = new Intl.DateTimeFormat(LOCALE_TAGS[language], {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  })
  const total = data?.days.reduce((sum, day) => sum + day.focusedMs, 0) ?? 0
  const maxDay = Math.max(1, ...(data?.days.map((day) => day.focusedMs) ?? [0]))
  const courseName = (id: string | null) =>
    id === null
      ? t('focusStats.outside')
      : (projects.find((p) => p.id === id)?.name ?? t('focusStats.unknownCourse'))

  return (
    <Card className={cn(className, 'scroll-mt-20')} id="focus-stats" data-focus-stats>
      <CardHeader className={headerClassName}>
        <CardTitle className={cn(titleClassName, 'flex items-center gap-2')}>
          <BarChart3 className="h-4 w-4 lecture:hidden" aria-hidden />
          {t('focusStats.title')}
        </CardTitle>
        <CardDescription>{t('focusStats.description', { days: FOCUS_STATS_DAYS })}</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-5', bodyClassName)}>
        {failed ? (
          <p className="text-sm text-destructive">{t('focusStats.loadFailed')}</p>
        ) : !data ? (
          <LoadingState />
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground" data-focus-stats-empty>
            {t('focusStats.empty')}
          </p>
        ) : (
          <>
            <p className="text-sm">
              {t('focusStats.total', { time: formatFocusDuration(total, t) })}
            </p>
            <table className="w-full text-sm" data-focus-stats-days>
              <caption className="sr-only">
                {t('focusStats.byDay', { days: FOCUS_STATS_DAYS })}
              </caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t('focusStats.day')}</th>
                  <th scope="col">{t('focusStats.time')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.days].reverse().map((day) => (
                  <tr key={day.day} className="align-middle">
                    <th
                      scope="row"
                      className="w-28 whitespace-nowrap py-1 pr-3 text-left font-normal tabular-nums text-muted-foreground"
                    >
                      {dayFormat.format(day.start)}
                    </th>
                    <td className="py-1">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 bg-muted" aria-hidden>
                          <div
                            className="h-2 bg-primary"
                            style={{ width: `${(day.focusedMs / maxDay) * 100}%` }}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-right tabular-nums">
                          {day.focusedMs > 0 ? formatFocusDuration(day.focusedMs, t) : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <h3 className="mb-1 text-sm font-medium">{t('focusStats.byCourse')}</h3>
              <ul className="divide-y text-sm" data-focus-stats-courses>
                {data.courses.map((course) => (
                  <li
                    key={course.projectId ?? 'outside'}
                    className="flex items-center justify-between gap-3 py-1.5"
                  >
                    <span className="min-w-0 truncate">{courseName(course.projectId)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatFocusDuration(course.focusedMs, t)} ·{' '}
                      {t('focusStats.sessions', { count: course.sessions })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
