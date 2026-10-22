import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import { isPracticeSet } from '@/entities/homework/types'

/**
 * Where a practice-set question came from. Practice questions are written from
 * an assignment's walkthrough, not from a course passage, so instead of "no
 * course passage found" they name (and link back to) the assignment, and — in
 * full mode — the original question they mirror.
 */
export interface PracticeSource {
  /** The parent assignment; null when it can no longer be found. */
  parent: { title: string; href: string } | null
  /** The original question's printed number (full mode), when known. */
  questionLabel?: string
}

export function practiceSourceFor(
  set: Pick<HomeworkSet, 'kind' | 'parentSetId' | 'projectId'>,
  parent: Pick<HomeworkSet, 'id' | 'title'> | null,
  parentQuestions: readonly Pick<HomeworkQuestion, 'id' | 'number'>[],
  question: Pick<HomeworkQuestion, 'practice'>,
): PracticeSource | null {
  if (!isPracticeSet(set)) return null
  const linked = parent && parent.id === set.parentSetId ? parent : null
  const sourceId = question.practice?.sourceQuestionId
  const index = sourceId ? parentQuestions.findIndex((item) => item.id === sourceId) : -1
  const questionLabel =
    index >= 0 ? parentQuestions[index]!.number?.trim() || String(index + 1) : undefined
  return {
    parent: linked
      ? {
          title: linked.title,
          href: `/projects/${set.projectId}/homework/${linked.id}?view=walkthrough`,
        }
      : null,
    ...(linked && questionLabel ? { questionLabel } : {}),
  }
}
