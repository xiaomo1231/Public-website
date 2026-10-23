/**
 * 教授答案（卷内附带）: an answer printed in the assignment / past paper itself
 * (a worked solution, a final answer, a circled option, an `Answer n: (c)`
 * line written from highlighted options, a marking-scheme box), split out of
 * the question while it is recognised (`homework-analyzer/v3`).
 *
 * The model only proposes the text; it is kept only when it is found verbatim
 * (NFKC, case, quotes / dashes and whitespace aside; ` … ` may join pieces in
 * order) in the passages it cites. Nothing is guessed: an answer that cannot
 * be found is dropped and the question is kept as recognised.
 *
 * The answer is stored in the question's ordinary professor-answer fields
 * (`answerText` / `answerChunkIds` / `answerStatus: 'matched'`) with
 * `answerSource: 'inline'`, so the walkthrough alignment, marking-scheme
 * parsing, mock-exam checking and compare all use it unchanged. A linked
 * answer file takes precedence; the inline answer (kept in `inlineAnswer`)
 * comes back when that link is removed. Pure functions.
 */

import type { DocumentChunk } from '@/entities/chunk/types'
import { normalizeEvidenceText } from '@/entities/questionHabits/types'
import { MARKED_ANSWERS_SECTION } from '@/infrastructure/files/chunking'
import { normalizeAnswerNumber } from './answerMatching'
import type { HomeworkQuestion } from './types'

/** An answer printed in the material, verbatim, with the chunks it came from. */
export interface InlineAnswer {
  text: string
  chunkIds: string[]
}

/** Longest inline answer kept (characters). */
export const MAX_INLINE_ANSWER_CHARS = 8000

/** Pieces shorter than this must stand on their own (not inside a word). */
const SHORT_PIECE = 6

const ELLIPSIS = /\s*(?:…|\.\.\.)\s*/

const WORD_CHAR = /[\p{L}\p{N}]/u

/** Index of `piece` in `haystack` at or after `from`; short pieces need word boundaries. */
function findPiece(haystack: string, piece: string, from: number): number {
  let at = haystack.indexOf(piece, from)
  if (piece.length >= SHORT_PIECE) return at
  while (at >= 0) {
    const before = at > 0 ? haystack[at - 1]! : ' '
    const after = at + piece.length < haystack.length ? haystack[at + piece.length]! : ' '
    const startsWord = WORD_CHAR.test(piece[0]!)
    const endsWord = WORD_CHAR.test(piece[piece.length - 1]!)
    if (!(startsWord && WORD_CHAR.test(before)) && !(endsWord && WORD_CHAR.test(after))) return at
    at = haystack.indexOf(piece, at + 1)
  }
  return -1
}

/**
 * True when `answer` occurs verbatim in `source`: after NFKC, case, quotes /
 * dashes and whitespace normalisation, every ` … `-joined piece is found in
 * order. Short pieces (a letter, a number) must not sit inside a longer word.
 */
export function answerFoundIn(answer: string, source: string): boolean {
  const pieces = answer
    .split(ELLIPSIS)
    .map(normalizeEvidenceText)
    .filter((piece) => piece.length > 0)
  if (pieces.length === 0) return false
  const haystack = normalizeEvidenceText(source)
  let from = 0
  for (const piece of pieces) {
    const at = findPiece(haystack, piece, from)
    if (at < 0) return false
    from = at + piece.length
  }
  return true
}

/**
 * Check one proposed inline answer. `cited` are the chunks it cites (already
 * resolved against the batch); when it cites none, the question's own
 * passages are searched. Returns the answer with the chunks it was found in,
 * or `undefined` (dropped).
 */
export function validateInlineAnswer(
  raw: unknown,
  context: {
    prompt: string
    cited: readonly DocumentChunk[]
    questionChunks: readonly DocumentChunk[]
  },
): InlineAnswer | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (!text || text.length > MAX_INLINE_ANSWER_CHARS) return undefined
  const normalized = normalizeEvidenceText(text)
  if (!normalized) return undefined
  // The question text handed back as its own answer is not an answer.
  const prompt = normalizeEvidenceText(context.prompt)
  if (normalized === prompt || (normalized.length >= 40 && prompt.includes(normalized))) {
    return undefined
  }
  const pool = context.cited.length > 0 ? context.cited : context.questionChunks
  if (pool.length === 0) return undefined
  const ordered = [...pool].sort((a, b) => a.order - b.order)
  if (!answerFoundIn(text, ordered.map((chunk) => chunk.text).join('\n'))) return undefined
  const pieces = text.split(ELLIPSIS).filter((piece) => piece.trim())
  const used = ordered.filter((chunk) => pieces.some((piece) => answerFoundIn(piece, chunk.text)))
  return { text, chunkIds: (used.length > 0 ? used : ordered).map((chunk) => chunk.id) }
}

/**
 * `Answer 7: (c) 1.25; lower` lines written after the pages for highlighted /
 * circled options (`MARKED_ANSWERS_SECTION`), by normalised question number.
 * A number that appears twice is left out (ambiguous).
 */
export function markedAnswerLines(
  chunks: readonly DocumentChunk[],
): Map<string, { text: string; chunkId: string }> {
  const found = new Map<string, { text: string; chunkId: string }>()
  const repeated = new Set<string>()
  for (const chunk of chunks) {
    if (chunk.section !== MARKED_ANSWERS_SECTION) continue
    for (const line of chunk.text.split('\n')) {
      const match = /^\s*Answer\s+([^:]+?)\s*:\s*(\S.*)$/.exec(line)
      if (!match) continue
      const key = normalizeAnswerNumber(match[1]!)
      if (!key) continue
      if (found.has(key)) repeated.add(key)
      else found.set(key, { text: line.trim(), chunkId: chunk.id })
    }
  }
  for (const key of repeated) found.delete(key)
  return found
}

/**
 * Give each recognised question without an inline answer its marked-option
 * line, when its printed number matches exactly one. Local only.
 */
export function attachMarkedAnswers<
  T extends { number?: string; inlineAnswer?: InlineAnswer | undefined },
>(questions: readonly T[], chunks: readonly DocumentChunk[]): T[] {
  const lines = markedAnswerLines(chunks)
  if (lines.size === 0) return [...questions]
  const counts = new Map<string, number>()
  for (const question of questions) {
    if (!question.number) continue
    const key = normalizeAnswerNumber(question.number)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return questions.map((question) => {
    if (question.inlineAnswer || !question.number) return question
    const key = normalizeAnswerNumber(question.number)
    const line = lines.get(key)
    if (!line || counts.get(key) !== 1) return question
    return { ...question, inlineAnswer: { text: line.text, chunkIds: [line.chunkId] } }
  })
}

/** True when the question's professor answer is the one printed in the material. */
export function isInlineAnswer(question: Pick<HomeworkQuestion, 'answerSource'>): boolean {
  return question.answerSource === 'inline'
}

/**
 * The professor-answer fields that put the question's inline answer in
 * place (or clear them when it has none). Used when a linked answer file's
 * link is removed and after a re-recognition.
 */
export function inlineAnswerFields(
  question: Pick<HomeworkQuestion, 'inlineAnswer' | 'number'>,
): Pick<
  HomeworkQuestion,
  | 'answerText'
  | 'answerNumber'
  | 'answerChunkIds'
  | 'answerStatus'
  | 'answerSource'
  | 'answerLinkStale'
> {
  const inline = question.inlineAnswer
  if (!inline?.text.trim()) {
    return {
      answerText: undefined,
      answerNumber: undefined,
      answerChunkIds: undefined,
      answerStatus: undefined,
      answerSource: undefined,
      answerLinkStale: undefined,
    }
  }
  return {
    answerText: inline.text,
    answerNumber: question.number,
    answerChunkIds: [...inline.chunkIds],
    answerStatus: 'matched',
    answerSource: 'inline',
    answerLinkStale: undefined,
  }
}
