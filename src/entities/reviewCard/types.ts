/**
 * Term flashcards with spaced repetition — memorisation-heavy courses
 * (anatomy, histology, physiology terms, 名词解释) need daily review.
 *
 * Scheduling follows the SM-2 family (as in Anki): each review rates recall
 * (again / hard / good / easy) and moves the card's next due date out by its
 * interval × ease. Everything is local; nothing calls the AI.
 */

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

export type ReviewCardSource = 'concept' | 'table' | 'manual'

export interface ReviewCard {
  id: string
  projectId: string
  topicId?: string
  /** The prompt side, e.g. a term or "三角肌 — 神经支配". */
  front: string
  /** The answer side. */
  back: string
  source: ReviewCardSource
  /** Concept name, used to feed knowledge-point mastery. */
  knowledgePoint?: string
  /** Next review time (ms). */
  due: number
  /** Current interval in days (0 = still learning). */
  interval: number
  ease: number
  /** Successful reviews in a row. */
  reps: number
  lapses: number
  lastReviewedAt?: number
  createdAt: number
  updatedAt: number
}

export const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
export const INITIAL_EASE = 2.5
const MIN_EASE = 1.3

/** The card state after a review. */
export function scheduleReview(card: ReviewCard, grade: ReviewGrade, now: number): ReviewCard {
  let { interval, ease, reps, lapses } = card
  let dueIn: number
  if (grade === 'again') {
    reps = 0
    lapses += card.reps > 0 ? 1 : 0
    ease = Math.max(MIN_EASE, ease - 0.2)
    interval = 0
    dueIn = 10 * MINUTE_MS
  } else if (grade === 'hard' && reps === 0) {
    // A shaky first recall stays in learning and comes back the same day.
    interval = 0
    dueIn = 6 * 60 * MINUTE_MS
  } else {
    if (grade === 'hard') {
      interval = Math.max(1, Math.round(interval * 1.2))
      ease = Math.max(MIN_EASE, ease - 0.15)
    } else if (grade === 'good') {
      interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease)
    } else {
      interval = reps === 0 ? 3 : Math.round(Math.max(interval, 1) * ease * 1.3)
      ease += 0.15
    }
    reps += 1
    dueIn = interval * DAY_MS
  }
  return { ...card, interval, ease, reps, lapses, due: now + dueIn, lastReviewedAt: now, updatedAt: now }
}

/** How long each grade would postpone the card, for the rating buttons. */
export function previewIntervals(card: ReviewCard, now: number): Record<ReviewGrade, number> {
  return {
    again: scheduleReview(card, 'again', now).due - now,
    hard: scheduleReview(card, 'hard', now).due - now,
    good: scheduleReview(card, 'good', now).due - now,
    easy: scheduleReview(card, 'easy', now).due - now,
  }
}

export function newCard(input: {
  projectId: string
  front: string
  back: string
  source: ReviewCardSource
  topicId?: string
  knowledgePoint?: string
  now: number
}): ReviewCard {
  return {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    front: input.front,
    back: input.back,
    source: input.source,
    ...(input.topicId ? { topicId: input.topicId } : {}),
    ...(input.knowledgePoint ? { knowledgePoint: input.knowledgePoint } : {}),
    due: input.now,
    interval: 0,
    ease: INITIAL_EASE,
    reps: 0,
    lapses: 0,
    createdAt: input.now,
    updatedAt: input.now,
  }
}
