import type { ExamScope, ExamTopic } from './types'

/**
 * What a quiz over an exam scope (or one exam topic) is built from.
 *
 * A matched exam topic becomes a group over its course topics (their sources
 * and knowledge points, like a mixed review). An unmatched one becomes a group
 * with no course source — only when the student opted in — and its questions
 * are labelled as AI-generated without a course source.
 */

export type ExamQuizEntry =
  | { kind: 'matched'; examTopicId: string; text: string; topicIds: string[] }
  | { kind: 'unmatched'; examTopicId: string; text: string }

export function planExamScopeEntries(
  examTopics: ExamTopic[],
  knownTopicIds: Set<string>,
  options: { includeUnmatched: boolean; count: number },
): ExamQuizEntry[] {
  const entries: ExamQuizEntry[] = []
  for (const item of [...examTopics].sort((a, b) => a.order - b.order)) {
    const topicIds = (item.topicIds ?? []).filter((id) => knownTopicIds.has(id))
    if (topicIds.length > 0) {
      entries.push({ kind: 'matched', examTopicId: item.id, text: item.text, topicIds })
    } else if (options.includeUnmatched) {
      entries.push({ kind: 'unmatched', examTopicId: item.id, text: item.text })
    }
  }
  const count = Math.max(1, options.count)
  if (entries.length <= count) return entries
  // More exam topics than questions: spread the questions over the scope.
  return Array.from({ length: count }, (_, i) => entries[Math.floor((i * entries.length) / count)]!)
}

/** All exam topics of one scope, or the single topic, for a quiz. */
export function examTopicsFor(
  scopes: ExamScope[],
  selection: { scopeId: string; examTopicId?: string },
): ExamTopic[] {
  const scope = scopes.find((item) => item.id === selection.scopeId)
  if (!scope) return []
  return selection.examTopicId
    ? scope.topics.filter((item) => item.id === selection.examTopicId)
    : scope.topics
}
