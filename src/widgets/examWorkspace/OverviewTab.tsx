import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BookA,
  CalendarClock,
  ClipboardCheck,
  ListChecks,
  Mic,
  NotebookText,
  Stethoscope,
  Timer,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Progress } from '@/shared/ui/Progress'
import { EmptyState } from '@/shared/ui/EmptyState'
import type { ExamWorkspaceView } from '@/services/studyPlanService'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import {
  examDiagnosticLink,
  examInterviewLink,
  examOralLink,
  examQuizLink,
  examVocabLink,
  fromWorkspace,
} from './examLinks'
import { ExamTaskList } from './ExamTaskList'
import { TopicMasteryList } from './TopicMastery'
import { TabSection } from './TabSection'
import { byMastery, PHASE_KEYS, WEAK_MASTERY } from './workspaceHelpers'

/**
 * 概览: how ready the student is (tasks done, mastery estimate per topic in
 * scope), today's tasks for this exam, the weak topics, the re-tests due and
 * quick starts (mock exam, review sheet, diagnostic, practice).
 */
export function OverviewTab({
  view,
  onTab,
  onChanged,
}: {
  view: ExamWorkspaceView
  onTab: (tab: string) => void
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { exam, project, topics, mocks, aiMock } = view.context
  const sorted = byMastery(topics)
  const weak = sorted.filter((topic) => topic.mastery !== null && topic.mastery < WEAK_MASTERY)
  const mastery = view.context.mastery
  const nextMock = mocks.find((mock) => !mock.done) ?? mocks[0]
  const aiMockReady = !aiMock.id.startsWith('ai-mock:')
  const subject = project.subject
  const readiness = view.readiness

  const actions: Array<{
    key: string
    icon: ReactNode
    label: string
    to?: string
    onClick?: () => void
  }> = []
  if (nextMock)
    actions.push({
      key: 'mock',
      icon: <Timer className="h-4 w-4" aria-hidden />,
      label: t('examWorkspace.quick.mock'),
      to: fromWorkspace(exam, `/projects/${exam.projectId}/homework/${nextMock.id}/exam`),
    })
  else if (aiMockReady)
    actions.push({
      key: 'ai-mock',
      icon: <Timer className="h-4 w-4" aria-hidden />,
      label: t('examWorkspace.quick.aiMock'),
      to: fromWorkspace(exam, `/projects/${exam.projectId}/homework/${aiMock.id}/exam`),
    })
  else
    actions.push({
      key: 'papers',
      icon: <Timer className="h-4 w-4" aria-hidden />,
      label: t('examWorkspace.quick.generateMock'),
      onClick: () => onTab('papers'),
    })
  actions.push({
    key: 'review',
    icon: <NotebookText className="h-4 w-4" aria-hidden />,
    label: exam.review?.sections.length
      ? t('examWorkspace.quick.openReview')
      : t('examWorkspace.quick.review'),
    onClick: () => onTab('review'),
  })
  actions.push({
    key: 'diagnostic',
    icon: <ClipboardCheck className="h-4 w-4" aria-hidden />,
    label: t('examWorkspace.quick.diagnostic'),
    to: examDiagnosticLink(exam),
  })
  actions.push({
    key: 'quiz',
    icon: <ListChecks className="h-4 w-4" aria-hidden />,
    label: t('examWorkspace.quick.quiz'),
    to: examQuizLink(exam, view.link),
  })
  if (subject === 'medicine' || view.link.syllabus)
    actions.push({
      key: 'oral',
      icon: <Mic className="h-4 w-4" aria-hidden />,
      label: t('examWorkspace.quick.oral'),
      to: examOralLink(exam, view.link),
    })
  if (subject === 'language')
    actions.push({
      key: 'interview',
      icon: <Stethoscope className="h-4 w-4" aria-hidden />,
      label: t('examWorkspace.quick.interview'),
      to: examInterviewLink(exam),
    })
  actions.push({
    key: 'vocab',
    icon: <BookA className="h-4 w-4" aria-hidden />,
    label: t('examWorkspace.quick.vocab'),
    to: examVocabLink(exam),
  })

  return (
    <div
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
      data-workspace-overview
    >
      <div className="space-y-8">
        <TabSection title={t('examWorkspace.readiness')} data-workspace-readiness>
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="tabular-nums">
                {t('examWorkspace.tasksDone', {
                  done: readiness.tasksDone,
                  total: readiness.tasksTotal,
                  minutesDone: readiness.minutesDone,
                  minutesTotal: readiness.minutesTotal,
                })}
              </span>
              <span className="text-muted-foreground">{t(PHASE_KEYS[view.phase])}</span>
            </div>
            <Progress
              value={readiness.percent}
              aria-label={t('examWorkspace.readinessAria', { percent: readiness.percent })}
            />
            <p className="text-sm text-muted-foreground">
              {mastery === null
                ? t('examWorkspace.masteryNone')
                : t('examWorkspace.masteryMean', { percent: Math.round(mastery * 100) })}
              {view.context.mockPercent !== undefined &&
                ` · ${t('examWorkspace.mockScore', { percent: view.context.mockPercent })}`}
            </p>
            <p className="text-xs text-muted-foreground">{t('examWorkspace.estimateNote')}</p>
          </div>
        </TabSection>

        <TabSection
          title={t('examWorkspace.today')}
          action={
            <Button size="sm" variant="ghost" onClick={() => onTab('timeline')}>
              <CalendarClock className="h-4 w-4" aria-hidden />
              {t('examWorkspace.allTasks')}
            </Button>
          }
          data-workspace-today
        >
          {view.today.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('examWorkspace.todayEmpty')}</p>
          ) : (
            <ExamTaskList exam={exam} tasks={view.today} onChanged={onChanged} />
          )}
        </TabSection>

        <TabSection title={t('examWorkspace.topics')} data-workspace-topics>
          {topics.length === 0 ? (
            <EmptyState
              title={t('examWorkspace.noTopics')}
              description={t('examWorkspace.noTopicsHint')}
              action={
                <Button asChild size="sm" variant="outline">
                  <Link to={`/projects/${exam.projectId}?tab=analysis`}>
                    {t('examWorkspace.openAnalysis')}
                  </Link>
                </Button>
              }
            />
          ) : (
            <>
              <TopicMasteryList exam={exam} topics={sorted} limit={8} />
              {sorted.length > 8 && (
                <Button size="sm" variant="ghost" onClick={() => onTab('mistakes')}>
                  {t('examWorkspace.allTopics', { count: sorted.length })}
                </Button>
              )}
            </>
          )}
        </TabSection>
      </div>

      <aside className="space-y-8">
        <TabSection title={t('examWorkspace.quickStart')} data-workspace-quick>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {actions.map((action) =>
              action.to ? (
                <Button key={action.key} asChild variant="outline" className="justify-start">
                  <Link to={action.to} data-quick={action.key}>
                    {action.icon}
                    {action.label}
                  </Link>
                </Button>
              ) : (
                <Button
                  key={action.key}
                  variant="outline"
                  className="justify-start"
                  onClick={action.onClick}
                  data-quick={action.key}
                >
                  {action.icon}
                  {action.label}
                </Button>
              ),
            )}
          </div>
        </TabSection>

        <TabSection title={t('examWorkspace.weak')} data-workspace-weak>
          {weak.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('examWorkspace.weakNone')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {weak.slice(0, 5).map((topic) => (
                <li key={topic.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words">{topic.name}</span>
                  <span className="shrink-0 tabular-nums text-amber-700 dark:text-amber-400">
                    {Math.round(topic.mastery! * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t('examWorkspace.weakNote')}</p>
        </TabSection>

        <TabSection title={t('examWorkspace.retests')} data-workspace-retests>
          <p className={cn('text-sm', view.mistakesDue.length === 0 && 'text-muted-foreground')}>
            {view.mistakesDue.length > 0
              ? t('examWorkspace.retestsDue', { count: view.mistakesDue.length })
              : t('examWorkspace.retestsNone')}
            {view.mistakes.length > 0 &&
              ` · ${t('examWorkspace.openMistakes', { count: view.mistakes.length })}`}
          </p>
          {(view.mistakesDue.length > 0 || view.mistakes.length > 0) && (
            <Button size="sm" variant="outline" onClick={() => onTab('mistakes')}>
              {t('examWorkspace.openMistakesTab')}
            </Button>
          )}
        </TabSection>
      </aside>
    </div>
  )
}
