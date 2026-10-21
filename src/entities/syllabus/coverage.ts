import type { ExamTopic } from './types'

/**
 * Coverage of one exam topic: which course topics teach it, how much the
 * student has practised it, and a mastery *estimate* from that practice.
 * Pure — the caller loads topics, concepts and mastery rows once.
 */

export interface CoverageInput {
  /** Course topics by id. */
  topics: Map<string, { id: string; name: string }>
  /** Knowledge points (concept names) per course topic id. */
  pointsByTopic: Map<string, string[]>
  /** The project's mastery rows. */
  mastery: Array<{ knowledgePoint: string; topicId?: string; mastery: number; attempts: number }>
}

export interface ExamTopicCoverage {
  /** Matched course topics that still exist, in match order. */
  topics: Array<{ id: string; name: string }>
  covered: boolean
  /** Practice attempts on the matched topics' knowledge points. */
  practiceCount: number
  /** Attempt-weighted mean of their mastery estimates; null with no practice. */
  mastery: number | null
}

export function examTopicCoverage(item: ExamTopic, input: CoverageInput): ExamTopicCoverage {
  const topics = (item.topicIds ?? [])
    .map((id) => input.topics.get(id))
    .filter((topic): topic is { id: string; name: string } => Boolean(topic))
  const ids = new Set(topics.map((topic) => topic.id))
  // The knowledge points that stand for this exam topic: the matched topics'
  // concepts and names, plus the exam topic's own text (questions generated
  // for a topic the course material does not cover use it as their point).
  const points = new Set<string>([item.text.toLowerCase()])
  for (const topic of topics) {
    points.add(topic.name.toLowerCase())
    for (const point of input.pointsByTopic.get(topic.id) ?? []) points.add(point.toLowerCase())
  }
  const rows = input.mastery.filter(
    (row) =>
      row.attempts > 0 &&
      ((row.topicId !== undefined && ids.has(row.topicId)) ||
        points.has(row.knowledgePoint.toLowerCase())),
  )
  const practiceCount = rows.reduce((sum, row) => sum + row.attempts, 0)
  const mastery =
    practiceCount > 0
      ? rows.reduce((sum, row) => sum + row.mastery * row.attempts, 0) / practiceCount
      : null
  return { topics, covered: topics.length > 0, practiceCount, mastery }
}
