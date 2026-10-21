import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs'
import type { VocabCard, VocabRating } from './types'

/**
 * FSRS-6 scheduling (ts-fsrs) for vocabulary: a target recall of 90%, a
 * little fuzz so words learned together do not all fall due on the same day,
 * and intervals capped at five years.
 */
const scheduler = fsrs(
  generatorParameters({ request_retention: 0.9, enable_fuzz: true, maximum_interval: 1825 }),
)

function toFsrs(card: VocabCard): Card {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state,
    ...(card.last_review !== undefined ? { last_review: new Date(card.last_review) } : {}),
  } as Card
}

function fromFsrs(card: Card, base: VocabCard): VocabCard {
  return {
    ...base,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state as VocabCard['state'],
    ...(card.last_review ? { last_review: card.last_review.getTime() } : {}),
  }
}

/** A word that has never been reviewed. */
export function newVocabCard(word: string, bookId: string, now: number): VocabCard {
  const empty = createEmptyCard(new Date(now))
  return fromFsrs(empty, {
    word,
    bookId,
    addedAt: now,
    mistakes: 0,
  } as VocabCard)
}

/** The card after a review. */
export function rateVocabCard(card: VocabCard, rating: VocabRating, now: number): VocabCard {
  const { card: next } = scheduler.next(toFsrs(card), new Date(now), rating as Grade)
  return fromFsrs(next, card)
}

/** How long each rating would postpone the card (ms), for the rating buttons. */
export function previewVocabIntervals(card: VocabCard, now: number): Record<VocabRating, number> {
  const preview = scheduler.repeat(toFsrs(card), new Date(now))
  const after = (rating: VocabRating) => preview[rating as Grade].card.due.getTime() - now
  return { 1: after(1), 2: after(2), 3: after(3), 4: after(4) }
}

/** Reviewed but not yet graduated from the short learning steps. */
export function isLearning(card: VocabCard): boolean {
  return card.state === 1 || card.state === 3
}

/** An interval of three weeks or more. */
export function isMature(card: VocabCard): boolean {
  return card.state === 2 && card.scheduled_days >= 21
}
