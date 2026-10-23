import { Link } from 'react-router-dom'
import { BookOpen, ListChecks } from 'lucide-react'
import type { SchedulerTopic } from '@/entities/studyPlan/scheduler'
import type { PlannedExam } from '@/entities/studyPlan/types'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { fromWorkspace } from './examLinks'
import { isCourseTopicId, WEAK_MASTERY } from './workspaceHelpers'

/**
 * Topics in the exam's scope with their mastery estimate (a bar and the
 * percentage, or 暂无练习), open mistakes, and links to the lesson and a
 * quiz on the topic (both return to the workspace).
 */
export function TopicMasteryList({
  exam,
  topics,
  limit,
}: {
  exam: Pick<PlannedExam, 'id' | 'projectId'>
  topics: readonly SchedulerTopic[]
  limit?: number
}): JSX.Element {
  const { t } = useTranslation()
  const shown = limit ? topics.slice(0, limit) : topics
  return (
    <ul className="divide-y rounded-md border lab:rounded-none" data-topic-mastery>
      {shown.map((topic) => {
        const percent = topic.mastery === null ? null : Math.round(topic.mastery * 100)
        const course = isCourseTopicId(topic.id)
        return (
          <li
            key={topic.id}
            className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
            data-topic-row={topic.id}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="break-words text-sm font-medium">{topic.name}</p>
              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 w-32 overflow-hidden rounded-full bg-muted lab:rounded-none"
                  aria-hidden
                >
                  {percent !== null && (
                    <div
                      className={cn(
                        'h-full',
                        topic.mastery! < WEAK_MASTERY ? 'bg-amber-500' : 'bg-primary',
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  )}
                </div>
                <span className="text-xs tabular-nums text-muted-foreground lab:font-mono">
                  {percent === null
                    ? t('plan.review.noPractice')
                    : t('examWorkspace.masteryEstimate', { percent })}
                  {topic.openMistakes > 0 &&
                    ` · ${t('examWorkspace.openMistakes', { count: topic.openMistakes })}`}
                </span>
              </div>
            </div>
            {course && (
              <div className="flex flex-wrap gap-1.5">
                <Link
                  to={fromWorkspace(exam, `/projects/${exam.projectId}/tutor/${topic.id}`)}
                  className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-primary hover:underline coarse:min-h-11"
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden />
                  {t('plan.review.lesson')}
                </Link>
                <Link
                  to={fromWorkspace(
                    exam,
                    `/projects/${exam.projectId}/quiz?topic=${encodeURIComponent(topic.id)}`,
                  )}
                  className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-primary hover:underline coarse:min-h-11"
                >
                  <ListChecks className="h-3.5 w-3.5" aria-hidden />
                  {t('plan.review.practice')}
                </Link>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
