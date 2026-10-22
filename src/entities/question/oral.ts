import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import type { Question } from './types'

/**
 * Oral-exam rehearsal: grouping and per-topic scoring. Pure — the questions of
 * an oral quiz are ordinary short answers that share `oral.group`.
 */

export interface OralTopicGroup {
  group: string
  topic: string
  main: Question
  followUps: Question[]
}

/** The drawn topics of an oral quiz, in quiz order. Questions without `oral` are skipped. */
export function oralGroups(questions: Question[]): OralTopicGroup[] {
  const groups = new Map<string, { topic: string; main?: Question; followUps: Question[] }>()
  for (const question of questions) {
    if (!question.oral) continue
    const entry = groups.get(question.oral.group) ?? { topic: question.oral.topic, followUps: [] }
    if (question.oral.role === 'main' && !entry.main) entry.main = question
    else entry.followUps.push(question)
    groups.set(question.oral.group, entry)
  }
  const result: OralTopicGroup[] = []
  for (const [group, entry] of groups) {
    // A group without its main question (should not happen) shows its first one as main.
    const main = entry.main ?? entry.followUps.shift()
    if (main) result.push({ group, topic: entry.topic, main, followUps: entry.followUps })
  }
  return result
}

export interface OralTopicScore {
  group: string
  topic: string
  /** Scoring points covered, over the graded questions (main + follow-ups). */
  earned: number
  total: number
  /** Questions of the topic not scored: unanswered, not checked, or disputed. */
  unscored: number
  /** earned / total as a percentage; null when nothing was scored. */
  percentage: number | null
}

/**
 * The scoring points of one graded answer, or null when it does not count:
 * disputed, not checked, or without scoring points. Shared by the per-topic
 * scores and the quiz headline so both use the same basis.
 */
export function scoredOralPoints(
  evaluation: QuestionAttempt['evaluation'] | undefined,
): { earned: number; total: number } | null {
  const score = evaluation?.score
  if (
    !evaluation ||
    evaluation.disputed ||
    evaluation.isCorrect === null ||
    !score ||
    score.total <= 0
  ) {
    return null
  }
  return { earned: score.earned, total: score.total }
}

/**
 * Per drawn topic: points covered / total points, main question and
 * follow-ups together. A disputed or unverified answer is not scored.
 */
export function oralTopicScores(
  questions: Question[],
  attempts: QuestionAttempt[],
): OralTopicScore[] {
  // The latest attempt per question (a resumed quiz may have re-answered one).
  const latest = new Map<string, QuestionAttempt>()
  for (const attempt of attempts) {
    const seen = latest.get(attempt.questionId)
    if (!seen || seen.createdAt <= attempt.createdAt) latest.set(attempt.questionId, attempt)
  }
  return oralGroups(questions).map(({ group, topic, main, followUps }) => {
    let earned = 0
    let total = 0
    let unscored = 0
    for (const question of [main, ...followUps]) {
      const score = scoredOralPoints(latest.get(question.id)?.evaluation)
      if (!score) {
        unscored++
        continue
      }
      earned += score.earned
      total += score.total
    }
    return {
      group,
      topic,
      earned,
      total,
      unscored,
      percentage: total > 0 ? Math.round((earned / total) * 100) : null,
    }
  })
}

/** Where an oral session stands: the drawn topic and the question within it (0 = main). */
export interface OralPosition {
  groupIndex: number
  step: number
}

/** The first unanswered question, main before its follow-ups; null when all are answered. */
export function oralResumePoint(
  groups: OralTopicGroup[],
  answered: Set<string>,
): OralPosition | null {
  for (const [groupIndex, group] of groups.entries()) {
    const step = [group.main, ...group.followUps].findIndex((q) => !answered.has(q.id))
    if (step >= 0) return { groupIndex, step }
  }
  return null
}

/**
 * After answering `position`: the next follow-up of the same topic, or
 * `feedback` once the topic's last question is answered.
 */
export function oralNextStep(
  groups: OralTopicGroup[],
  position: OralPosition,
): OralPosition | 'feedback' {
  const group = groups[position.groupIndex]
  if (!group) return 'feedback'
  return position.step < group.followUps.length
    ? { groupIndex: position.groupIndex, step: position.step + 1 }
    : 'feedback'
}
