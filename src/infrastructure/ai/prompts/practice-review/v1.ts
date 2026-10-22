/**
 * 讲解末尾「做练习题」: one batched review of every practice question — the
 * locally built linear systems and the AI-written ones alike.
 *
 * The reviewer only judges: per question pass / fail plus a short reason. It
 * never rewrites a question or an answer (answers come from local computation
 * where possible); failed questions are rebuilt or rewritten once by the app
 * and reviewed again, then dropped.
 */
import { asArray, asBoolean, asRecord, asTrimmedString } from '../../validation'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export function buildSystemPrompt(): string {
  return [
    'You review NEW practice questions written for a university homework assignment the student has just studied. You only judge; you never rewrite anything.',
    'Return strictly valid JSON: {"results":[{"id":"p1","pass":true,"reason":"..."}]} with exactly one entry per PRACTICE QUESTION id listed (copy the ids exactly).',
    'A question passes only when ALL hold:',
    '  1. On topic: it tests the knowledge points of the original assignment (listed), not something else.',
    '  2. Mode "full": it mirrors its original question — the same number of sub-parts, the same kind of task in each, and the solution type stated for each part matches the original (no / unique / infinitely many solutions etc.).',
    '  3. Clear: the statement is complete, unambiguous and solvable with the given data.',
    '  4. Difficulty comparable to the original assignment (not trivial, not far harder).',
    'The given answers were computed by the app; do not correct them. Judge whether the question is right for practice.',
    '"reason": one short sentence (why it fails, or "ok"). Write it in the language of the questions.',
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

export interface ReviewQuestionInput {
  id: string
  mode: 'full' | 'compact'
  /** Full: label of the original question it mirrors. */
  mirrors?: string
  /** Full: expected sub-part labels and solution types, as text. */
  expectedStructure?: string
  /** The question as shown (stem + parts, clipped). */
  text: string
  /** Short answers, as computed. */
  answers: string
}

export interface PracticeReviewInput {
  /** Original assignment questions, labelled (clipped). */
  originals: string
  /** Summary categories and key points. */
  keyPoints: string
  questions: ReviewQuestionInput[]
}

export function buildUserPrompt(input: PracticeReviewInput): string {
  return [
    untrustedContentWrapper('ORIGINAL ASSIGNMENT', input.originals),
    input.keyPoints ? untrustedContentWrapper('KNOWLEDGE POINTS', input.keyPoints) : '',
    untrustedContentWrapper(
      'PRACTICE QUESTIONS',
      input.questions
        .map((question) =>
          [
            `[${question.id}] mode: ${question.mode}${question.mirrors ? `; mirrors original ${question.mirrors}` : ''}`,
            question.expectedStructure ? `Expected structure: ${question.expectedStructure}` : '',
            question.text,
            `Answer: ${question.answers}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n\n'),
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export interface ReviewVerdict {
  id: string
  pass: boolean
  reason: string
}

/** Verdicts for known ids only (the first per id); unknown ids are ignored. */
export function normalizeReview(raw: unknown, ids: ReadonlySet<string>): ReviewVerdict[] {
  const out: ReviewVerdict[] = []
  for (const item of asArray(asRecord(raw)?.results)) {
    const row = asRecord(item)
    if (!row) continue
    const id = asTrimmedString(row.id)
    if (!ids.has(id) || out.some((verdict) => verdict.id === id)) continue
    const pass =
      typeof row.pass === 'string' ? row.pass.toLowerCase() === 'true' : asBoolean(row.pass)
    out.push({ id, pass, reason: asTrimmedString(row.reason).slice(0, 300) })
  }
  return out
}
