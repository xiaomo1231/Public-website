import { Link } from 'react-router-dom'
import { ArrowRight, CalendarPlus } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { useExams } from '@/features/studyPlan/useStudyPlan'
import { examWorkspacePath } from '@/features/studyPlan/examReturn'
import { countdownParts } from '@/entities/studyPlan/countdown'
import { formatDateTime } from '@/shared/lib/utils'
import { scopeLabel } from '@/widgets/studyPlan/scopeLabels'
import { useTranslation } from '@/i18n'

/**
 * Course home 「考试」: this course's planned exams, each opening its 考试工作台.
 * Adding or editing exams stays in the study plan (no exam spans courses).
 */
export function CourseExamsPanel({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useTranslation()
  const { exams, loaded } = useExams(projectId)
  const now = Date.now()
  const sorted = [...exams].sort((a, b) => {
    const pastA = a.at < now
    const pastB = b.at < now
    if (pastA !== pastB) return pastA ? 1 : -1
    return pastA ? b.at - a.at : a.at - b.at
  })

  if (!loaded) return <LoadingState label={t('common.loading')} />
  return (
    <section className="space-y-4" data-course-exams>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold">{t('examWorkspace.courseTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('examWorkspace.courseHint')}</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={`/projects/${projectId}?tab=plan`}>
            <CalendarPlus className="h-4 w-4" aria-hidden />
            {t('examWorkspace.addExam')}
          </Link>
        </Button>
      </div>
      {sorted.length === 0 ? (
        <EmptyState title={t('plan.exams.none')} />
      ) : (
        <ul className="divide-y rounded-md border lab:rounded-none">
          {sorted.map((exam) => {
            const left = countdownParts(now, exam.at)
            return (
              <li
                key={exam.id}
                className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
                data-course-exam={exam.id}
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={examWorkspacePath(exam.id)}
                    className="focus-ring rounded-sm text-sm font-medium hover:text-primary hover:underline coarse:inline-block coarse:py-2"
                  >
                    {exam.name}
                  </Link>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(exam.at)} ·{' '}
                    {left.past
                      ? t('plan.exams.past')
                      : t('plan.countdown.daysHours', { days: left.days, hours: left.hours })}
                    {' · '}
                    {scopeLabel(exam.scope, t)}
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link
                    to={examWorkspacePath(exam.id)}
                    aria-label={t('examWorkspace.enterAria', { name: exam.name })}
                  >
                    {t('examWorkspace.enter')}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
