import type { TranslationKey } from '@/i18n/types'
import type { PracticeOrigin, PracticePart } from '@/entities/homework/practice/types'
import { fnv1a } from '@/shared/lib/hash'
import type { MistakeType } from './types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import { answerIssueTags } from '@/entities/question/answerDimensions'
import { marketErrorDimension } from '@/entities/econ/graphQuestion'

/**
 * 错题跟进: after a wrong answer the student can look at the explanation, try
 * the same question again, practise a verified variant (改编题), and is
 * re-tested after 1 → 3 → 7 → 14 days with a NEW variant each time (never the
 * identical question). A failed re-test starts the ladder again at 1 day; the
 * last stage passed marks the mistake understood.
 *
 * Everything here is pure; `MistakeFollowUpService` stores it on the Mistake
 * row (`Mistake.followUp`, optional — no new table).
 */

export type MistakeOrigin = 'quiz' | 'practice' | 'homework_practice' | 'mock_exam'

/** The kind of error a grader saw. Only set when the grader says so. */
export type ErrorDimension = 'value' | 'unit' | 'sig_figs' | 'sign' | 'concept'

export const ERROR_DIMENSIONS: readonly ErrorDimension[] = [
  'value',
  'unit',
  'sig_figs',
  'sign',
  'concept',
]

/** Days until the re-test of each stage. */
export const FOLLOW_UP_DAYS: readonly number[] = [1, 3, 7, 14]

const DAY_MS = 24 * 60 * 60 * 1000

/** A verified variant of the mistaken question (改编题). */
export interface MistakeVariant {
  id: string
  /** `variant` — practice on request; `retest` — the scheduled re-test. */
  purpose: 'variant' | 'retest'
  origin: PracticeOrigin
  stem: string
  parts: PracticePart[]
  /** Fingerprint of the question text, so no variant is ever shown twice. */
  hash: string
  createdAt: number
}

export interface FollowUpEvent {
  at: number
  kind: 'retest' | 'retry' | 'variant'
  passed: boolean
  /** Stage the re-test was for. */
  stage?: number
}

export interface MistakeFollowUp {
  /** Index into `FOLLOW_UP_DAYS` of the next re-test. */
  stage: number
  /** When the next re-test is due. */
  dueAt: number
  /** Why it was scheduled (the last error), when the grader said. */
  reason?: ErrorDimension
  history: FollowUpEvent[]
  /** Every stage passed: the ladder is finished. */
  completedAt?: number
  /** The variant being worked on (practice or re-test). */
  current?: MistakeVariant
  /** Hashes of every question shown (the original included), newest last. */
  seen: string[]
}

const HISTORY_CAP = 30
const SEEN_CAP = 40

/** Normalised fingerprint of a question text (used to never repeat one). */
export function questionHash(text: string): string {
  return fnv1a(
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s$\\{}]+/g, ''),
  )
}

/** A new ladder after a wrong answer: first re-test tomorrow. */
export function startFollowUp(
  now: number,
  originalQuestion: string,
  reason?: ErrorDimension,
  previous?: MistakeFollowUp,
): MistakeFollowUp {
  const seen = [...(previous?.seen ?? [])]
  const hash = questionHash(originalQuestion)
  if (!seen.includes(hash)) seen.push(hash)
  return {
    stage: 0,
    dueAt: now + FOLLOW_UP_DAYS[0]! * DAY_MS,
    ...(reason ? { reason } : {}),
    history: previous?.history ?? [],
    seen: seen.slice(-SEEN_CAP),
  }
}

/**
 * The ladder after a re-test: passed ⇒ next stage (or finished after the last),
 * failed ⇒ back to stage 0 (due in 1 day), with the new error as the reason.
 */
export function afterRetest(
  followUp: MistakeFollowUp,
  passed: boolean,
  now: number,
  reason?: ErrorDimension,
): MistakeFollowUp {
  const event: FollowUpEvent = { at: now, kind: 'retest', passed, stage: followUp.stage }
  const history = [...followUp.history, event].slice(-HISTORY_CAP)
  const rest: MistakeFollowUp = { ...followUp, history }
  delete rest.current
  if (!passed) {
    const next: MistakeFollowUp = {
      ...rest,
      stage: 0,
      dueAt: now + FOLLOW_UP_DAYS[0]! * DAY_MS,
    }
    delete next.completedAt
    if (reason) next.reason = reason
    return next
  }
  const stage = followUp.stage + 1
  if (stage >= FOLLOW_UP_DAYS.length) {
    return { ...rest, stage: FOLLOW_UP_DAYS.length, dueAt: now, completedAt: now }
  }
  return { ...rest, stage, dueAt: now + FOLLOW_UP_DAYS[stage]! * DAY_MS }
}

/** A practice event (再试一次 / 改编题) — it never moves the re-test schedule. */
export function withPracticeEvent(
  followUp: MistakeFollowUp,
  kind: 'retry' | 'variant',
  passed: boolean,
  now: number,
): MistakeFollowUp {
  return {
    ...followUp,
    history: [...followUp.history, { at: now, kind, passed }].slice(-HISTORY_CAP),
  }
}

/** Remember a shown variant (so it is never shown again). */
export function rememberVariant(
  followUp: MistakeFollowUp,
  variant: MistakeVariant,
): MistakeFollowUp {
  const seen = followUp.seen.includes(variant.hash)
    ? followUp.seen
    : [...followUp.seen, variant.hash]
  return { ...followUp, current: variant, seen: seen.slice(-SEEN_CAP) }
}

export function isRetestDue(
  mistake: { status: string; followUp?: MistakeFollowUp },
  now: number,
): boolean {
  const followUp = mistake.followUp
  return (
    mistake.status === 'active' &&
    !!followUp &&
    followUp.completedAt === undefined &&
    followUp.dueAt <= now
  )
}

/** The days of the stage the next re-test is for (1, 3, 7, 14). */
export function stageDays(followUp: MistakeFollowUp): number {
  return FOLLOW_UP_DAYS[Math.min(followUp.stage, FOLLOW_UP_DAYS.length - 1)]!
}

/** Mistake categories that name the error kind directly. */
const TYPE_DIMENSION: Partial<Record<MistakeType, ErrorDimension>> = {
  unit: 'unit',
  sign: 'sign',
  calculation: 'value',
  conceptual: 'concept',
  formula: 'concept',
}

/**
 * The error kind of a wrong answer: what the grader reported for a numeric
 * answer (`answerIssueTags`: value / unit / significant figures, judged
 * separately), else the mistake category. `undefined` when nothing says.
 */
export function errorDimensionOf(input: {
  evaluation?: Pick<QuestionEvaluation, 'dimensions' | 'market'>
  mistakeType?: MistakeType
}): ErrorDimension | undefined {
  // Graph questions: the item that failed (a direction, the drawing, a value).
  const market = input.evaluation?.market
  if (market && market.kind !== 'area_read') {
    const dimension = marketErrorDimension(market)
    if (dimension) return dimension
  }
  const tags = input.evaluation ? answerIssueTags(input.evaluation) : []
  if (tags.includes('unit')) return 'unit'
  if (tags.includes('value')) return 'value'
  if (tags.includes('sigfig')) return 'sig_figs'
  return input.mistakeType ? TYPE_DIMENSION[input.mistakeType] : undefined
}

export const ERROR_DIMENSION_REASON_KEYS: Record<ErrorDimension, TranslationKey> = {
  value: 'followUp.reason.value',
  unit: 'followUp.reason.unit',
  sig_figs: 'followUp.reason.sig_figs',
  sign: 'followUp.reason.sign',
  concept: 'followUp.reason.concept',
}

/** What the variant must exercise, for the generator (English, prompt text). */
export const ERROR_DIMENSION_FOCUS: Record<ErrorDimension, string> = {
  value:
    'The student previously made a calculation error here. The new question must need a similar calculation with a single numeric answer (give a "numeric" check).',
  unit: 'The student previously gave a wrong or missing unit. The new question must have a numeric answer WITH a unit, where the unit has to be stated or converted (give a "numeric" check with the unit).',
  sig_figs:
    'The student previously gave the answer to the wrong number of significant figures. The new question must state explicitly how many significant figures the answer must have, and the answer must be written to exactly that many.',
  sign: 'The student previously got a sign or direction wrong. The new question must hinge on getting the sign / direction right.',
  concept:
    'The student previously misunderstood the underlying concept. The new question must test the same concept in a different setting.',
}
