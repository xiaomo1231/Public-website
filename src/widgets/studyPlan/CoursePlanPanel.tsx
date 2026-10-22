import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { TodayPanel } from './TodayPanel'
import { ExamSetup } from './ExamSetup'
import { useTranslation } from '@/i18n'

/** Course home 「学习计划」 tab: this course's exams and today's tasks for it. */
export function CoursePlanPanel({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-10" data-course-plan>
      <TodayPanel projectId={projectId} />
      <ExamSetup projectId={projectId} />
      <Button asChild variant="outline" size="sm">
        <Link to="/plan">
          <CalendarDays className="h-4 w-4" aria-hidden />
          {t('plan.openFull')}
        </Link>
      </Button>
    </div>
  )
}
