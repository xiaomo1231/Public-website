import type { StudyTask, StudyTaskKind } from '@/entities/studyPlan/types'
import type { TranslationKey } from '@/i18n/types'
import { parseReviewSheetRef } from '@/entities/studyPlan/review'
import { parseChapterRef } from '@/entities/studyPlan/scope'

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
    case 'ai_mock': {
      // `ai-mock:<examId>`: open 生成模拟卷 for that exam; else take the paper.
      const examId = task.refId?.startsWith('ai-mock:') ? task.refId.slice('ai-mock:'.length) : ''
      if (task.refId && !examId) return `${base}/homework/${task.refId}/exam`
      return `${base}/homework?aiMock=${encodeURIComponent(examId || 'new')}`
    }
    case 'homework':
      return task.refId ? `${base}/homework/${task.refId}?view=guided` : `${base}/homework`
    case 'practice_set':
      return `${base}/practice`
    case 'review_material': {
      // A chapter of a 「按章节」 scope (`chapter:<documentId>:<nodeId>`): its file.
      const chapter = parseChapterRef(task.refId)
      if (chapter) return `${base}/documents/${chapter.documentId}`
      return task.refId ? `${base}/documents/${task.refId}` : `${base}/files`
    }
    case 'review_sheet': {
      const ref = parseReviewSheetRef(task.refId)
      return ref
        ? `${base}/exam-review/${ref.examId}#${encodeURIComponent(ref.sectionId)}`
        : '/plan?tab=exams'
    }
  }
}

/** The 复习提纲 page of an exam. */
export function reviewSheetLink(exam: { id: string; projectId: string }): string {
  return `/projects/${exam.projectId}/exam-review/${exam.id}`
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
  review_material: 'plan.task.review_material',
  review_sheet: 'plan.task.review_sheet',
}
