import { fnv1a } from '@/shared/lib/hash'

/**
 * Stable identity matching for homework questions across a re-analysis.
 *
 * A student's work (draft, revealed hints, revealed solution, conversation) is
 * stored ON the question row, so a re-analysis must re-point each incoming
 * question at its previous row rather than replacing every row. This mirrors
 * the course-analysis topic identity: match on content, never on order, consume
 * each old row at most once, and treat ambiguity as "no match" rather than
 * guessing.
 */

export interface MatchableQuestion {
  prompt: string
  number?: string
  /** Real chunk ids the question is grounded in. */
  chunkIds: string[]
}

export type MatchReason =
  | 'prompt-exact'
  | 'prompt-similar'
  | 'number-and-source'
  | 'prompt-partial'
  | 'source-overlap'

export interface QuestionMatch {
  newIndex: number
  oldIndex: number
  reason: MatchReason
  /** Confidence of the accepted pair; used to weigh active vs retired candidates. */
  score: number
}

export interface MatchResult {
  pairs: QuestionMatch[]
  unmatchedNew: number[]
  unmatchedOld: number[]
}

/** The student-owned fields on a question; used to tell a blank row from a worked one. */
export interface StudentWorkFields {
  draftText?: string
  messages?: readonly unknown[]
  revealedHints?: number
  solutionRevealed?: boolean
}

/**
 * True when the student has left any input on a question (draft, revealed
 * hints, revealed solution or conversation). Used to decide whether a row can
 * be safely superseded by a restored archive row.
 */
export function hasStudentWork(fields: StudentWorkFields): boolean {
  return (
    (fields.draftText ?? '').trim() !== '' ||
    (fields.messages?.length ?? 0) > 0 ||
    (fields.revealedHints ?? 0) > 0 ||
    fields.solutionRevealed === true
  )
}

/** Content fingerprint of a question (normalised prompt + its chunk ids). */
export function homeworkContentFingerprint(question: MatchableQuestion): string {
  return fnv1a([normalizePrompt(question.prompt), ...[...question.chunkIds].sort()].join('|'))
}

/** Lowercase, drop punctuation/symbols, collapse whitespace — CJK-safe. */
export function normalizePrompt(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeNumber(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toLowerCase()
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizePrompt(text).split(' ').filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function overlapRatio(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let intersection = 0
  for (const id of sa) if (sb.has(id)) intersection += 1
  return intersection / Math.min(sa.size, sb.size)
}

/** Minimum score to accept a match; below this the pair is unrelated. */
const MIN_SIMILARITY = 0.65
const MIN_OVERLAP = 0.5

/** Score one incoming↔existing pair, or `null` when it is not a reliable match. */
export function scoreQuestionPair(
  incoming: MatchableQuestion,
  existing: MatchableQuestion,
): { score: number; reason: MatchReason } | null {
  const newPrompt = normalizePrompt(incoming.prompt)
  const oldPrompt = normalizePrompt(existing.prompt)
  if (newPrompt && newPrompt === oldPrompt) {
    return { score: 100, reason: 'prompt-exact' }
  }

  const similarity = jaccard(tokenSet(incoming.prompt), tokenSet(existing.prompt))
  const overlap = overlapRatio(incoming.chunkIds, existing.chunkIds)
  const sameNumber =
    Boolean(incoming.number) && normalizeNumber(incoming.number) === normalizeNumber(existing.number)

  if (similarity >= 0.8) return { score: 70 + similarity * 10, reason: 'prompt-similar' }
  if (sameNumber && overlap >= MIN_OVERLAP) {
    return { score: 55 + overlap * 10, reason: 'number-and-source' }
  }
  if (similarity >= MIN_SIMILARITY) return { score: 45 + similarity * 10, reason: 'prompt-partial' }
  if (overlap >= MIN_OVERLAP) return { score: 35 + overlap * 10, reason: 'source-overlap' }
  return null
}

/**
 * Greedy best-match: the strongest candidate is assigned first, and neither an
 * incoming nor an existing question is ever used twice. A question that cannot
 * be matched confidently is reported as unmatched instead of being forced onto
 * the closest guess.
 */
export function matchHomeworkQuestions(
  incoming: readonly MatchableQuestion[],
  existing: readonly MatchableQuestion[],
): MatchResult {
  const candidates: Array<QuestionMatch & { score: number }> = []
  for (let newIndex = 0; newIndex < incoming.length; newIndex += 1) {
    for (let oldIndex = 0; oldIndex < existing.length; oldIndex += 1) {
      const scored = scoreQuestionPair(incoming[newIndex]!, existing[oldIndex]!)
      if (scored) candidates.push({ newIndex, oldIndex, ...scored })
    }
  }

  candidates.sort(
    (a, b) => b.score - a.score || a.newIndex - b.newIndex || a.oldIndex - b.oldIndex,
  )

  const usedNew = new Set<number>()
  const usedOld = new Set<number>()
  const pairs: QuestionMatch[] = []
  for (const candidate of candidates) {
    if (usedNew.has(candidate.newIndex) || usedOld.has(candidate.oldIndex)) continue
    usedNew.add(candidate.newIndex)
    usedOld.add(candidate.oldIndex)
    pairs.push({
      newIndex: candidate.newIndex,
      oldIndex: candidate.oldIndex,
      reason: candidate.reason,
      score: candidate.score,
    })
  }

  const unmatchedNew = incoming
    .map((_, index) => index)
    .filter((index) => !usedNew.has(index))
  const unmatchedOld = existing
    .map((_, index) => index)
    .filter((index) => !usedOld.has(index))

  return { pairs, unmatchedNew, unmatchedOld }
}

/**
 * Reasons backed by the question TEXT. Restoring archived student work demands
 * this stronger evidence: a bare shared-passage overlap (`source-overlap`) or a
 * number/topic pairing (`number-and-source`) can coincide for two genuinely
 * different questions, and chunk ids are not stable across a re-processing. The
 * prompt, by contrast, is stable, so only text evidence may revive a record.
 */
const PROMPT_MATCH_REASONS: readonly MatchReason[] = [
  'prompt-exact',
  'prompt-similar',
  'prompt-partial',
]

export function isPromptEvidence(reason: MatchReason): boolean {
  return PROMPT_MATCH_REASONS.includes(reason)
}

export interface RetiredMatchResult {
  /** Strict one-to-one pairs only: neither side is shared. */
  pairs: QuestionMatch[]
  /**
   * Incoming indices with more than one reliable retired candidate. These are
   * deliberately NOT restored — a guess could attach another question's work.
   */
  ambiguousNew: number[]
}

/**
 * Match the still-unplaced incoming questions against retired rows.
 *
 * Restoration must be provable, so the rule is stricter than the active pass:
 * a pair is accepted only when it is the *unique* reliable candidate on both
 * sides. A new question with two plausible retired rows, or two new questions
 * competing for the same retired row, is left untouched (the row stays in the
 * archive, the new question is treated as genuinely new).
 */
export function matchRetiredCandidates(
  incoming: readonly MatchableQuestion[],
  eligibleNew: readonly number[],
  retired: readonly MatchableQuestion[],
): RetiredMatchResult {
  const newCounts = new Map<number, number>()
  const retiredCounts = new Map<number, number>()
  const candidates: QuestionMatch[] = []
  for (const newIndex of eligibleNew) {
    const incomingQuestion = incoming[newIndex]
    if (!incomingQuestion) continue
    for (let oldIndex = 0; oldIndex < retired.length; oldIndex += 1) {
      const scored = scoreQuestionPair(incomingQuestion, retired[oldIndex]!)
      if (!scored || !isPromptEvidence(scored.reason)) continue
      candidates.push({ newIndex, oldIndex, reason: scored.reason, score: scored.score })
      newCounts.set(newIndex, (newCounts.get(newIndex) ?? 0) + 1)
      retiredCounts.set(oldIndex, (retiredCounts.get(oldIndex) ?? 0) + 1)
    }
  }

  const pairs = candidates.filter(
    (candidate) =>
      newCounts.get(candidate.newIndex) === 1 && retiredCounts.get(candidate.oldIndex) === 1,
  )
  const ambiguousNew = [...newCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([index]) => index)

  return { pairs, ambiguousNew }
}
