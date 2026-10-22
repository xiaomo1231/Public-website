import type { ExamWeightSetting } from './types'

/**
 * Suggested time shares between exams (pure, deterministic). Every number is
 * an *estimate* from the student's own records; the reasons say in plain
 * words what moved a share, and the sliders let the student override it.
 */

export interface WeightInput {
  examId: string
  /** Calendar days until the exam (0 = today). */
  daysLeft: number
  /** 0–1 estimate from past papers (question kinds, marks) and topic count. */
  difficulty: number
  /** 0–1 mastery estimate over the exam's topics; null without practice. */
  mastery: number | null
  topicCount: number
  /** Latest mock exam result in percent, when one was checked. */
  mockPercent?: number
  /** Minutes the calendar still offers before this exam. */
  availableMinutes?: number
}

export type WeightReason =
  | { kind: 'days'; days: number; level: 'urgent' | 'soon' | 'far' }
  | { kind: 'mastery'; percent: number; level: 'low' | 'medium' | 'high' }
  | { kind: 'no_mastery' }
  | { kind: 'mock'; percent: number }
  | { kind: 'difficulty'; level: 'hard' | 'medium' | 'easy' }
  | { kind: 'topics'; count: number }
  | { kind: 'little_time'; minutes: number }

export interface WeightSuggestion {
  examId: string
  /** Whole percent; all shares sum to 100. */
  share: number
  /** The unnormalised need behind the share (for tests and the explanation). */
  raw: number
  reasons: WeightReason[]
}

/** Effective mastery: a checked mock exam counts as much as practice records. */
export function effectiveMastery(input: Pick<WeightInput, 'mastery' | 'mockPercent'>): number {
  const practice = input.mastery
  const mock = input.mockPercent !== undefined ? input.mockPercent / 100 : undefined
  if (practice === null && mock === undefined) return 0.5
  if (practice === null) return mock!
  if (mock === undefined) return practice
  return (practice + mock) / 2
}

/** Closer exams need more of today's time; never zero, never unbounded. */
export function urgencyFactor(daysLeft: number): number {
  return 1 / Math.sqrt(Math.max(1, daysLeft))
}

function rawNeed(input: WeightInput): number {
  const urgency = urgencyFactor(input.daysLeft)
  const need = 1.15 - effectiveMastery(input)
  const size = 0.6 + 0.4 * Math.min(1, input.topicCount / 20)
  const difficulty = 0.7 + 0.6 * Math.min(1, Math.max(0, input.difficulty))
  return urgency * need * size * difficulty
}

function reasonsFor(input: WeightInput): WeightReason[] {
  const reasons: WeightReason[] = []
  const level = input.daysLeft <= 7 ? 'urgent' : input.daysLeft <= 21 ? 'soon' : 'far'
  reasons.push({ kind: 'days', days: input.daysLeft, level })
  if (input.mastery === null && input.mockPercent === undefined)
    reasons.push({ kind: 'no_mastery' })
  else if (input.mastery !== null) {
    const percent = Math.round(input.mastery * 100)
    reasons.push({
      kind: 'mastery',
      percent,
      level: percent < 50 ? 'low' : percent < 75 ? 'medium' : 'high',
    })
  }
  if (input.mockPercent !== undefined)
    reasons.push({ kind: 'mock', percent: Math.round(input.mockPercent) })
  reasons.push({
    kind: 'difficulty',
    level: input.difficulty >= 0.66 ? 'hard' : input.difficulty >= 0.4 ? 'medium' : 'easy',
  })
  reasons.push({ kind: 'topics', count: input.topicCount })
  if (input.availableMinutes !== undefined && input.availableMinutes < 600)
    reasons.push({ kind: 'little_time', minutes: input.availableMinutes })
  return reasons
}

/** Whole numbers with the given total, as close to `values`' proportions as possible. */
export function roundToTotal(values: number[], total: number): number[] {
  const sum = values.reduce((a, b) => a + Math.max(0, b), 0)
  if (values.length === 0) return []
  if (sum <= 0) {
    const base = Math.floor(total / values.length)
    return values.map((_, i) => base + (i < total - base * values.length ? 1 : 0))
  }
  const exact = values.map((v) => (Math.max(0, v) / sum) * total)
  const floors = exact.map(Math.floor)
  let left = total - floors.reduce((a, b) => a + b, 0)
  const order = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i]! += 1
    left -= 1
  }
  return floors
}

export function suggestWeights(inputs: WeightInput[]): WeightSuggestion[] {
  const raws = inputs.map(rawNeed)
  const shares = roundToTotal(raws, 100)
  return inputs.map((input, i) => ({
    examId: input.examId,
    share: shares[i]!,
    raw: raws[i]!,
    reasons: reasonsFor(input),
  }))
}

/**
 * Move one slider. Locked exams keep their share; the unlocked others absorb
 * the change in proportion to their current shares, so the total stays 100.
 */
export function rebalanceShares(
  current: Record<string, ExamWeightSetting>,
  changedId: string,
  value: number,
): Record<string, ExamWeightSetting> {
  const ids = Object.keys(current)
  if (!current[changedId]) return current
  const others = ids.filter((id) => id !== changedId)
  const lockedTotal = others
    .filter((id) => current[id]!.locked)
    .reduce((sum, id) => sum + current[id]!.share, 0)
  const free = others.filter((id) => !current[id]!.locked)
  const available = Math.max(0, 100 - lockedTotal)
  const own = free.length === 0 ? available : Math.max(0, Math.min(available, Math.round(value)))
  const rest = available - own
  const shares = roundToTotal(
    free.map((id) => current[id]!.share),
    rest,
  )
  const next: Record<string, ExamWeightSetting> = {}
  for (const id of ids) next[id] = { ...current[id]! }
  next[changedId] = { ...current[changedId]!, share: own }
  free.forEach((id, i) => {
    next[id] = { ...current[id]!, share: shares[i]! }
  })
  return next
}

/**
 * The shares in force: the student's sliders for the exams they set, the
 * suggestion otherwise, scaled so the total is 100 (locked shares kept as
 * long as they fit).
 */
export function effectiveShares(
  suggested: WeightSuggestion[],
  manual: Record<string, ExamWeightSetting> | undefined,
): Record<string, ExamWeightSetting> {
  const ids = suggested.map((s) => s.examId)
  if (ids.length === 0) return {}
  const fromManual = manual && ids.every((id) => manual[id] !== undefined)
  if (!fromManual) {
    return Object.fromEntries(
      suggested.map((s) => [
        s.examId,
        { share: s.share, locked: manual?.[s.examId]?.locked ?? false },
      ]),
    )
  }
  const locked = ids.filter((id) => manual[id]!.locked)
  const lockedTotal = Math.min(
    100,
    locked.reduce((sum, id) => sum + manual[id]!.share, 0),
  )
  const free = ids.filter((id) => !manual[id]!.locked)
  const freeShares = roundToTotal(
    free.map((id) => manual[id]!.share),
    free.length > 0 ? 100 - lockedTotal : 0,
  )
  const out: Record<string, ExamWeightSetting> = {}
  for (const id of locked) out[id] = { share: manual[id]!.share, locked: true }
  free.forEach((id, i) => {
    out[id] = { share: freeShares[i]!, locked: false }
  })
  return out
}

/**
 * Difficulty estimate from the course's past papers and size: more topics and
 * a larger share of calculation / proof questions read as harder. 0–1.
 */
export function examDifficulty(input: {
  topicCount: number
  questions: number
  /** Questions of the kinds that take longest (calculation, proof). */
  heavyQuestions: number
}): number {
  const size = Math.min(1, input.topicCount / 25)
  const heavy = input.questions > 0 ? input.heavyQuestions / input.questions : 0.4
  return Math.round(Math.min(1, 0.15 + 0.45 * size + 0.4 * heavy) * 100) / 100
}
