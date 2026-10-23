import { useState } from 'react'
import type { PlannedExam, StudyTask } from '@/entities/studyPlan/types'
import { useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { toast } from '@/features/toast/toastStore'
import { TaskRow } from '@/widgets/studyPlan/TodayPanel'
import { useTranslation } from '@/i18n'
import { workspaceTaskLink } from './workspaceHelpers'

/**
 * Tasks of one exam with 完成 / 跳过 / 改日期 / 撤销 (the same actions as 今天);
 * each change re-plans and `onChanged` re-reads the workspace.
 */
export function ExamTaskList({
  exam,
  tasks,
  onChanged,
}: {
  exam: Pick<PlannedExam, 'id' | 'projectId'>
  tasks: StudyTask[]
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const [moving, setMoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      onChanged()
    }
  }

  return (
    <ul className="divide-y rounded-md border lab:rounded-none" data-exam-tasks>
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          examName={undefined}
          courseName={undefined}
          busy={busy}
          moving={moving === task.id}
          href={workspaceTaskLink(exam, task)}
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
  )
}
