import type { PlannedExamScope } from '@/entities/studyPlan/types'
import { chaptersScopeSize } from '@/entities/studyPlan/scope'
import type { TranslationKey, TranslationParams } from '@/i18n/types'

export const SCOPE_KEYS: Record<PlannedExamScope['kind'], TranslationKey> = {
  course: 'plan.scope.course',
  syllabus: 'plan.scope.syllabus',
  topics: 'plan.scope.topics',
  materials: 'plan.scope.materials',
  chapters: 'plan.scope.chapters',
}

/** The scope as shown on a saved exam's row (with how many chapters / topics). */
export function scopeLabel(
  scope: PlannedExamScope,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  if (scope.kind === 'chapters')
    return t('plan.scope.chaptersCount', { count: chaptersScopeSize(scope) })
  if (scope.kind === 'topics') return t('plan.scope.topicsCount', { count: scope.topicIds.length })
  return t(SCOPE_KEYS[scope.kind])
}
