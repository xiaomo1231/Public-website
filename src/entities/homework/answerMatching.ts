/**
 * Deterministic matching between a professor answer sheet and a homework's
 * questions.
 *
 * The rule is deliberately conservative: an answer is only auto-assigned when
 * it is a *unique one-to-one* match on the printed number. Duplicate numbers
 * (on either side), missing numbers, or any answer that is not uniquely tied to
 * a question are handed to the student for manual review. Nothing is ever
 * matched by position, and an unconfirmed answer is never used to generate.
 *
 * Pure functions — no storage, no AI — so the rules are directly testable.
 */

/** One answer entry parsed from the linked answer document. */
export interface AnswerEntry {
  /** Printed number, when one was recognised. */
  number?: string
  /** Verbatim answer text (may include working steps). */
  text: string
  /** Real chunk ids of the answer document this entry came from. */
  chunkIds: string[]
}

export type AnswerAssignmentStatus = 'matched' | 'needs_review' | 'none'

export type AnswerMatchReason =
  | 'number-unique'
  | 'answer-number-duplicate'
  | 'question-number-duplicate'
  | 'question-number-missing'
  | 'answer-number-missing'
  | 'no-answers'

export interface AnswerAssignment {
  questionId: string
  /** Index into the parsed entries, when a candidate exists. */
  answerIndex?: number
  status: AnswerAssignmentStatus
  reason: AnswerMatchReason
}

export interface AnswerMatchResult {
  assignments: AnswerAssignment[]
  /** Entry indices not used by any auto-confirmed assignment. */
  unmatchedAnswers: number[]
}

/** A line that starts a numbered answer, e.g. `3. 42`, `Q4) x = 2`, `5、`. */
const ENTRY_START = /^\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.)、:：]\s*(.*)$/i

/** Canonical form of a printed number: digits lose leading zeros, text is lowercased. */
export function normalizeAnswerNumber(raw: string): string {
  const trimmed = raw.trim().replace(/[.、)）:：\s]+$/, '')
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed))
  return trimmed.toLowerCase()
}

/**
 * Parse answer entries from the answer document's real chunks, in order.
 *
 * A numbered line starts a new entry; following lines belong to it. When the
 * document has no recognisable numbering at all, the whole text becomes a
 * single unnumbered entry so the student can still assign it manually.
 */
export function parseAnswerEntries(
  chunks: ReadonlyArray<{ id: string; text: string }>,
): AnswerEntry[] {
  const entries: AnswerEntry[] = []
  let current: AnswerEntry | null = null

  const flush = () => {
    if (!current) return
    const text = current.text.trim()
    if (text) entries.push({ ...current, text })
    current = null
  }

  for (const chunk of chunks) {
    const lines = (chunk.text ?? '').replace(/\r\n?/g, '\n').split('\n')
    for (const line of lines) {
      const start = ENTRY_START.exec(line)
      if (start) {
        flush()
        const number = normalizeAnswerNumber(start[1]!)
        current = {
          ...(number ? { number } : {}),
          text: (start[2] ?? '').trim(),
          chunkIds: [chunk.id],
        }
        continue
      }
      if (!current) continue
      if (line.trim()) current.text += (current.text ? '\n' : '') + line.trim()
      if (!current.chunkIds.includes(chunk.id)) current.chunkIds.push(chunk.id)
    }
  }
  flush()

  if (entries.length === 0) {
    const text = chunks.map((chunk) => chunk.text.trim()).filter(Boolean).join('\n\n')
    if (text) return [{ text, chunkIds: chunks.map((chunk) => chunk.id) }]
  }
  return entries
}

/**
 * Match questions to answer entries.
 *
 * Only a unique number on both sides yields `matched`. Everything else is
 * `needs_review` (a candidate exists but must be confirmed) or `none` (no
 * candidate at all). No positional or fuzzy matching is performed.
 */
export function matchAnswersToQuestions(
  questions: ReadonlyArray<{ id: string; number?: string }>,
  entries: readonly AnswerEntry[],
): AnswerMatchResult {
  const assignments: AnswerAssignment[] = []

  if (entries.length === 0) {
    return {
      assignments: questions.map((question) => ({
        questionId: question.id,
        status: 'none',
        reason: 'no-answers',
      })),
      unmatchedAnswers: [],
    }
  }

  const answersByNumber = new Map<string, number[]>()
  entries.forEach((entry, index) => {
    if (!entry.number) return
    const list = answersByNumber.get(entry.number) ?? []
    list.push(index)
    answersByNumber.set(entry.number, list)
  })

  const questionsByNumber = new Map<string, string[]>()
  for (const question of questions) {
    if (!question.number) continue
    const key = normalizeAnswerNumber(question.number)
    const list = questionsByNumber.get(key) ?? []
    list.push(question.id)
    questionsByNumber.set(key, list)
  }

  const used = new Set<number>()
  for (const question of questions) {
    if (!question.number) {
      assignments.push({ questionId: question.id, status: 'needs_review', reason: 'question-number-missing' })
      continue
    }
    const key = normalizeAnswerNumber(question.number)
    const answerIndices = answersByNumber.get(key) ?? []
    const questionIds = questionsByNumber.get(key) ?? []

    if (answerIndices.length === 0) {
      assignments.push({ questionId: question.id, status: 'none', reason: 'answer-number-missing' })
    } else if (answerIndices.length > 1) {
      assignments.push({ questionId: question.id, status: 'needs_review', reason: 'answer-number-duplicate' })
    } else if (questionIds.length > 1) {
      assignments.push({ questionId: question.id, status: 'needs_review', reason: 'question-number-duplicate' })
    } else {
      const answerIndex = answerIndices[0]!
      used.add(answerIndex)
      assignments.push({ questionId: question.id, answerIndex, status: 'matched', reason: 'number-unique' })
    }
  }

  const unmatchedAnswers = entries.map((_, index) => index).filter((index) => !used.has(index))
  return { assignments, unmatchedAnswers }
}
