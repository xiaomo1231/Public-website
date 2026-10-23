import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import { useExams } from '@/features/studyPlan/useStudyPlan'
import {
  countdownParts,
  countdownUrgency,
  hidesCountdown,
  nearestExam,
  type CountdownUrgency,
} from '@/entities/studyPlan/countdown'
import { useProjects } from '@/features/project/useProjects'
import { useExamActive } from '@/features/focus/examMode'
import { cn } from '@/shared/lib/utils'
import { examWorkspacePath } from '@/features/studyPlan/examReturn'
import { useTranslation } from '@/i18n'

const URGENCY_CLASS: Record<CountdownUrgency, string> = {
  calm: 'bg-muted/60 text-muted-foreground',
  soon: 'bg-primary/10 text-foreground',
  // Status colour (amber), as elsewhere for warnings.
  near: 'bg-amber-500/15 text-amber-900 dark:text-amber-200',
  final: 'bg-destructive/15 text-destructive font-semibold',
}

/**
 * Thin bar with the nearest exam and the time left (「线代期中 · 还有 12 天 6
 * 小时」). Colour follows the urgency; the last 3 days get extra weight.
 * Hidden while the student sits an exam (mock exam, quiz, interview,
 * self-test) and when no exam is planned. Clicking opens that exam's 考试工作台.
 */
export function CountdownBar(): JSX.Element | null {
  const { t } = useTranslation()
  const location = useLocation()
  const { exams } = useExams()
  const { projects } = useProjects()
  // A page that declares an exam in progress (oral rehearsal, self-test…).
  const examActive = useExamActive()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  if (examActive || hidesCountdown(location.pathname, location.search)) return null
  const exam = nearestExam(exams, now)
  if (!exam) return null
  const parts = countdownParts(now, exam.at)
  const urgency = countdownUrgency(now, exam.at)
  const course = projects.find((project) => project.id === exam.projectId)?.name
  const left =
    parts.days > 0
      ? t('plan.countdown.daysHours', { days: parts.days, hours: parts.hours })
      : t('plan.countdown.hoursMinutes', { hours: parts.hours, minutes: parts.minutes })
  const others = exams.filter((other) => other.at > now).length - 1
  return (
    <Link
      to={examWorkspacePath(exam.id)}
      data-countdown={urgency}
      className={cn(
        'focus-ring flex min-h-8 items-center gap-2 px-4 py-1 text-xs transition-colors hover:opacity-90 coarse:min-h-11',
        URGENCY_CLASS[urgency],
        urgency === 'final' && 'ring-1 ring-inset ring-destructive/40',
      )}
      aria-label={t('plan.countdown.aria', { exam: exam.name, left })}
    >
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        {exam.name}
        {course ? <span className="opacity-70"> · {course}</span> : null}
        {' · '}
        <span className="tabular-nums">{left}</span>
      </span>
      {others > 0 && (
        <span className="ml-auto shrink-0 opacity-70">
          {t('plan.countdown.more', { count: others })}
        </span>
      )}
    </Link>
  )
}
