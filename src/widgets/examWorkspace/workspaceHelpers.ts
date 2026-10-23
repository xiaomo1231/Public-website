import type { ExamWorkspaceView } from '@/services/studyPlanService'
import type { SchedulerTopic } from '@/entities/studyPlan/scheduler'
import type { PlannedExam, StudyTask } from '@/entities/studyPlan/types'
import { examWorkspacePath } from '@/features/studyPlan/examReturn'
import { taskLink } from '@/widgets/studyPlan/taskLinks'
import type { TranslationKey } from '@/i18n/types'
import { fromWorkspace } from './examLinks'

/** Where a task of this exam is done, opened from its workspace. */
export function workspaceTaskLink(
  exam: Pick<PlannedExam, 'id' | 'projectId'>,
  task: StudyTask,
): string {
  // The 复习提纲 is a tab of the workspace itself.
  if (task.kind === 'review_sheet') return examWorkspacePath(exam.id, 'review')
  return fromWorkspace(exam, taskLink(task))
}

/** A topic id that is a course topic (not an exam topic / chapter stand-in). */
export function isCourseTopicId(id: string): boolean {
  return !id.startsWith('exam:') && !id.startsWith('unit:')
}

/** Weakest first; topics without practice after the practised ones. */
export function byMastery(topics: readonly SchedulerTopic[]): SchedulerTopic[] {
  return [...topics].sort((a, b) => {
    if (a.mastery === null && b.mastery === null) return 0
    if (a.mastery === null) return 1
    if (b.mastery === null) return -1
    return a.mastery - b.mastery
  })
}

/** Below this estimate a topic is listed as 可能需要复习的部分. */
export const WEAK_MASTERY = 0.6

export const PHASE_KEYS: Record<ExamWorkspaceView['phase'], TranslationKey> = {
  first_pass: 'plan.phase.first_pass',
  mock: 'plan.phase.mock',
  final: 'plan.phase.final',
  exam: 'plan.phase.exam',
}
