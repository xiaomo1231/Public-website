import type { StudyTask, StudyTaskKind } from '@/entities/studyPlan/types'
import type { TranslationKey } from '@/i18n/types'

/** Where a study task is done: an existing page of the app. */
export function taskLink(
  task: Pick<StudyTask, 'kind' | 'projectId' | 'topicId' | 'refId'>,
): string {
  const base = `/projects/${task.projectId}`
  // An exam topic without a course topic: its row in the exam-topic list.
  const courseTopic = task.topicId && !task.topicId.startsWith('exam:') ? task.topicId : undefined
  switch (task.kind) {
    case 'learn':
      return courseTopic ? `${base}/tutor/${courseTopic}` : `${base}?tab=exams`
    case 'review':
    case 'day_practice':
      return courseTopic ? `${base}/quiz?topic=${encodeURIComponent(courseTopic)}` : `${base}/quiz`
    case 'weak_spots':
      return `${base}/mastery`
    case 'mistakes':
      return `${base}/mistakes`
    case 'cards':
      return `${base}/cards`
    case 'vocab':
      return '/vocab'
    case 'mock':
      return task.refId ? `${base}/homework/${task.refId}/exam` : `${base}/homework`
    case 'ai_mock':
      return '/plan?tab=diagnostic'
    case 'homework':
      return task.refId ? `${base}/homework/${task.refId}?view=guided` : `${base}/homework`
    case 'practice_set':
      return `${base}/practice`
  }
}

export const TASK_KIND_KEYS: Record<StudyTaskKind, TranslationKey> = {
  learn: 'plan.task.learn',
  review: 'plan.task.review',
  day_practice: 'plan.task.day_practice',
  mistakes: 'plan.task.mistakes',
  cards: 'plan.task.cards',
  vocab: 'plan.task.vocab',
  mock: 'plan.task.mock',
  ai_mock: 'plan.task.ai_mock',
  homework: 'plan.task.homework',
  practice_set: 'plan.task.practice_set',
  weak_spots: 'plan.task.weak_spots',
}
