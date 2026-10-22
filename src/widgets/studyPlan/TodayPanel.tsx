import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CircleSlash, RotateCcw, CalendarArrowUp, ArrowRight, RefreshCw } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Progress } from '@/shared/ui/Progress'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { useExams, useStudyPlanService, useToday } from '@/features/studyPlan/useStudyPlan'
import { useProjects } from '@/features/project/useProjects'
import { toast } from '@/features/toast/toastStore'
import { addDays } from '@/entities/studyPlan/calendar'
import type { StudyTask } from '@/entities/studyPlan/types'
import { TASK_KIND_KEYS, taskLink } from './taskLinks'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

/**
 * 「今天」: today's tasks (all courses, or one course), progress against the
 * day's minutes, and buttons to finish, skip or move a task. Each task links
 * to the page where it is done.
 */
export function TodayPanel({ projectId }: { projectId?: string }): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const { today, refresh, error } = useToday(projectId)
  const { exams } = useExams()
  const { projects } = useProjects()
  const [moving, setMoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const examName = useMemo(() => new Map(exams.map((exam) => [exam.id, exam.name])), [exams])
  const courseName = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('plan.errors.actionFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
      refresh()
    }
  }

  if (error) return <ErrorState title={t('plan.today.title')} description={error} />
  if (!today) return <LoadingState label={t('common.loading')} />

  const upcoming = exams.some(
    (exam) => exam.at > Date.now() && (!projectId || exam.projectId === projectId),
  )
  const percent =
    today.plannedMinutes > 0 ? Math.round((today.doneMinutes / today.plannedMinutes) * 100) : 0

  return (
    <section className="space-y-4" data-plan-today>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold">{t('plan.today.title')}</h2>
          <p className="text-sm tabular-nums text-muted-foreground">
            {t('plan.today.minutes', {
              done: today.doneMinutes,
              planned: today.plannedMinutes,
              available: today.availableMinutes,
            })}
            {today.focusMinutes > 0 &&
              ` · ${t('plan.today.focus', { minutes: today.focusMinutes })}`}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => service.replan().then(() => undefined))}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t('plan.today.replan')}
        </Button>
      </div>
      {today.plannedMinutes > 0 && (
        <Progress value={percent} aria-label={t('plan.today.progress', { percent })} />
      )}

      {today.tasks.length === 0 ? (
        <EmptyState
          title={upcoming ? t('plan.today.empty') : t('plan.today.noExams')}
          description={upcoming ? t('plan.today.emptyHint') : t('plan.today.noExamsHint')}
          {...(!upcoming
            ? {
                action: (
                  <Button asChild size="sm">
                    <Link to="/plan?tab=exams">{t('plan.exams.add')}</Link>
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <ul className="divide-y rounded-md border lab:rounded-none">
          {today.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              examName={examName.get(task.examId)}
              courseName={projectId ? undefined : courseName.get(task.projectId)}
              busy={busy}
              moving={moving === task.id}
              onMoveOpen={() => setMoving(moving === task.id ? null : task.id)}
              onStatus={(status) => void run(() => service.setTaskStatus(task.id, status))}
              onMove={(date) =>
                void run(async () => {
                  await service.moveTask(task.id, date)
                  setMoving(null)
                })
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function TaskRow({
  task,
  examName,
  courseName,
  busy,
  moving,
  onMoveOpen,
  onStatus,
  onMove,
}: {
  task: StudyTask
  examName: string | undefined
  courseName: string | undefined
  busy: boolean
  moving: boolean
  onMoveOpen: () => void
  onStatus: (status: StudyTask['status']) => void
  onMove: (date: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [date, setDate] = useState(() => addDays(task.date, 1))
  const subject = task.topicNames?.join(' · ') || task.title || ''
  const finished = task.status !== 'pending'
  return (
    <li
      className={cn(
        'flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center',
        finished && 'opacity-60',
      )}
      data-task-kind={task.kind}
      data-task-status={task.status}
    >
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', task.status === 'done' && 'line-through')}>
          {t(TASK_KIND_KEYS[task.kind])}
          {subject && <span className="font-normal text-muted-foreground"> · {subject}</span>}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {t('plan.task.minutes', { minutes: task.minutes })}
          {examName && ` · ${examName}`}
          {courseName && ` · ${courseName}`}
          {task.pinned && ` · ${t('plan.task.pinned')}`}
          {task.kind === 'ai_mock' &&
            ` · ${t(task.refId?.startsWith('ai-mock:') ? 'aiMock.task.generate' : 'aiMock.task.take')}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {!finished ? (
          <>
            <Button asChild size="sm">
              <Link to={taskLink(task)}>
                {t('plan.task.open')}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus('done')}>
              <Check className="h-4 w-4" aria-hidden />
              {t('plan.task.done')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus('skipped')}>
              <CircleSlash className="h-4 w-4" aria-hidden />
              {t('plan.task.skip')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-expanded={moving}
              onClick={onMoveOpen}
            >
              <CalendarArrowUp className="h-4 w-4" aria-hidden />
              {t('plan.task.move')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus('pending')}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t('plan.task.undo')}
          </Button>
        )}
      </div>
      {moving && !finished && (
        <form
          className="flex w-full items-center gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault()
            onMove(date)
          }}
        >
          <Input
            type="date"
            value={date}
            min={task.date}
            onChange={(event) => setDate(event.target.value)}
            aria-label={t('plan.task.moveTo')}
            className="h-9 w-40"
          />
          <Button type="submit" size="sm" disabled={busy || !date}>
            {t('plan.task.moveConfirm')}
          </Button>
        </form>
      )}
    </li>
  )
}
