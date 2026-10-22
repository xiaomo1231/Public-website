import { fnv1a } from '@/shared/lib/hash'
import { matchTokens, type MatchableTopic } from '@/entities/syllabus/match'
import type { SyllabusData } from '@/entities/syllabus/types'
import type { HomeworkQuestionMeta } from './types'

/**
 * A homework question's knowledge points and exam-scope links, matched
 * locally (no AI): a course topic counts when most of its name's words occur
 * in the question; an exam topic counts when it covers one of those course
 * topics, or when most of its own words occur in the question. Used in the
 * question header, by 自测 (mastery knowledge point) and by 错题跟进.
 */

/** Share of a topic name's words that must occur in the question. */
export const QUESTION_TOPIC_COVERAGE = 0.6
export const MAX_QUESTION_TOPICS = 3
export const MAX_QUESTION_EXAM_TOPICS = 3

export interface SyllabusSource {
  documentId: string
  syllabus: SyllabusData
}

function coverage(needle: readonly string[], hay: ReadonlySet<string>): number {
  if (needle.length === 0) return 0
  return needle.filter((token) => hay.has(token)).length / needle.length
}

export function questionMetaFingerprint(
  prompt: string,
  topics: readonly MatchableTopic[],
  syllabi: readonly SyllabusSource[],
): string {
  return fnv1a(
    JSON.stringify({
      prompt,
      topics: topics.map((topic) => [topic.id, topic.name]),
      syllabi: syllabi.map((source) => [
        source.documentId,
        source.syllabus.editedAt ?? source.syllabus.extractedAt,
        source.syllabus.matchedAt ?? 0,
      ]),
    }),
  )
}

export function computeQuestionMeta(
  prompt: string,
  topics: readonly MatchableTopic[],
  syllabi: readonly SyllabusSource[],
  now = Date.now(),
): HomeworkQuestionMeta {
  const words = new Set(matchTokens(prompt))
  const scored = topics
    .map((topic) => ({ topic, score: coverage(matchTokens(topic.name), words) }))
    .filter((entry) => entry.score >= QUESTION_TOPIC_COVERAGE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_QUESTION_TOPICS)
  const topicIds = scored.map((entry) => entry.topic.id)
  const examTopics: HomeworkQuestionMeta['examTopics'] = []
  for (const source of syllabi) {
    for (const scope of source.syllabus.scopes) {
      for (const topic of scope.topics) {
        if (examTopics.length >= MAX_QUESTION_EXAM_TOPICS) break
        const viaTopic = (topic.topicIds ?? []).some((id) => topicIds.includes(id))
        const direct = coverage(matchTokens(topic.text), words) >= QUESTION_TOPIC_COVERAGE
        if (viaTopic || direct)
          examTopics.push({
            documentId: source.documentId,
            scopeId: scope.id,
            scopeLabel: scope.label,
            topicId: topic.id,
            text: topic.text,
          })
      }
    }
  }
  return {
    topicIds,
    knowledgePoints: scored.map((entry) => entry.topic.name),
    examTopics,
    fingerprint: questionMetaFingerprint(prompt, topics, syllabi),
    computedAt: now,
  }
}
