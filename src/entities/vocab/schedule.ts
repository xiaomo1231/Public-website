import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs'
import type { VocabCard, VocabRating } from './types'

/**
 * FSRS-6 scheduling (ts-fsrs) for vocabulary: a target recall of 90%, a
 * little fuzz so words learned together do not all fall due on the same day,
 * and intervals capped at one year (a well-known word still comes back once
 * in a while). Learning steps are ts-fsrs's defaults (1 min, 10 min;
 * relearning 10 min), so a new or forgotten word comes back within the hour.
 */
export const MAX_INTERVAL_DAYS = 365
const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    enable_fuzz: true,
    maximum_interval: MAX_INTERVAL_DAYS,
  }),
)

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A young word (few reviews so far) is not trusted with a long interval even
 * when rated easy: after its 1st / 2nd / 3rd review it comes back within
 * 1 / 3 / 7 days, so a word seen once never vanishes for a week.
 */
export const YOUNG_INTERVAL_DAYS: readonly number[] = [1, 3, 7]

/** 顽固词: forgotten this often, or failing most of its recent reviews. */
export const LEECH_LAPSES = 3
/** Recent reviews looked at, the fewest that count, and the fail share that marks a leech. */
export const LEECH_WINDOW = 6
const LEECH_MIN_REVIEWS = 4
const LEECH_FAIL_SHARE = 0.5
/** Correct reviews in a row that release a word from the leech list. */
export const LEECH_RELEASE_STREAK = 3

/**
 * Whether a word is a 顽固词: lapses ≥ 3, or at least half of its last
 * reviews (4–6 of them) were "forgot". `recent` are its latest ratings, newest last.
 */
export function detectLeech(card: Pick<VocabCard, 'lapses'>, recent: readonly number[]): boolean {
  if (card.lapses >= LEECH_LAPSES) return true
  const window = recent.slice(-LEECH_WINDOW)
  if (window.length < LEECH_MIN_REVIEWS) return false
  return window.filter((rating) => rating === 1).length / window.length >= LEECH_FAIL_SHARE
}

/** What a review may know beyond FSRS. */
export interface ScheduleContext {
  /** The word's latest ratings before this one, newest last (leech detection). */
  recent?: readonly number[]
  /** Start of the next exam of a course that has this word (epoch ms). */
  examAt?: number
}

/** The last week before an exam: a course-exam word is reviewed in it at least once. */
export const EXAM_WEEK_DAYS = 7

function withDue(card: VocabCard, due: number, now: number): VocabCard {
  return { ...card, due, scheduled_days: Math.max(0, Math.round((due - now) / DAY_MS)) }
}

/**
 * The card after a review, with the vocabulary rules on top of FSRS:
 * young words get short intervals, 顽固词 are relearnt over the next days
 * (≤ 1, 2, 3 days as their correct streak grows) and leave the list after
 * three correct reviews in a row, and a course-exam word whose next review
 * would fall after the exam comes back in the exam's final week instead.
 */
export function scheduleVocabCard(
  card: VocabCard,
  rating: VocabRating,
  now: number,
  context: ScheduleContext = {},
): VocabCard {
  let next = rateVocabCard(card, rating, now)
  // Leech bookkeeping.
  const ratings = [...(context.recent ?? []), rating]
  let leech = Boolean(card.leech)
  let streak = card.leechStreak ?? 0
  if (rating === 1) streak = 0
  else if (rating >= 3) streak += 1
  if (!leech && detectLeech(next, ratings)) {
    leech = true
    streak = 0
  } else if (leech && streak >= LEECH_RELEASE_STREAK) {
    leech = false
  }
  const { leech: _leech, leechStreak: _streak, leechAt: _leechAt, ...rest } = next
  next = leech
    ? { ...rest, leech: true, leechStreak: streak, leechAt: card.leechAt ?? now }
    : (rest as VocabCard)

  // Caps (learning steps of minutes are below every cap and stay as they are).
  let cap = Infinity
  const young = YOUNG_INTERVAL_DAYS[next.reps - 1]
  if (young !== undefined) cap = Math.min(cap, young * DAY_MS)
  if (leech) cap = Math.min(cap, (Math.min(streak, 2) + 1) * DAY_MS)
  if (next.due - now > cap) next = withDue(next, now + cap, now)
  if (context.examAt !== undefined) next = examWeekDue(next, context.examAt, now)
  return next
}

/**
 * A course-exam word reviewed before the exam's final week, whose next
 * review would fall after the exam, comes back at the start of that week.
 */
export function examWeekDue(card: VocabCard, examAt: number, now: number): VocabCard {
  const weekStart = examAt - EXAM_WEEK_DAYS * DAY_MS
  if (now >= weekStart || now >= examAt) return card
  if (card.due < examAt) return card
  return withDue(card, weekStart, now)
}

/**
 * Whether a card must be reviewed now for an exam: it is the exam's final
 * week, its last review was before that week and its due date is after the
 * exam (scheduled before the exam was known).
 */
export function dueForExamWeek(card: VocabCard, examAt: number, now: number): boolean {
  const weekStart = examAt - EXAM_WEEK_DAYS * DAY_MS
  if (now < weekStart || now >= examAt) return false
  if (card.due <= now || card.due < examAt) return false
  return (card.last_review ?? card.addedAt) < weekStart
}

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

/**
 * How long each rating would postpone the card (ms), for the rating buttons:
 * the same rules as the review itself (`scheduleVocabCard`).
 */
export function previewVocabIntervals(
  card: VocabCard,
  now: number,
  context: ScheduleContext = {},
): Record<VocabRating, number> {
  const after = (rating: VocabRating) => scheduleVocabCard(card, rating, now, context).due - now
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
