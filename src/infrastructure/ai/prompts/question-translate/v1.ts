/**
 * v1 question-translate prompt (查看原题 → 中文翻译).
 *
 * A faithful, sentence-by-sentence Simplified Chinese translation of one
 * homework question — not a summary, an analysis or a hint. Formulas, symbols,
 * sub-part labels and numbers stay exactly as written (checked locally; a
 * reply that changes any of them is rejected). Not cached by version: the
 * result is stored on the question with its source hash.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'question-translate' as const

export interface QuestionTranslateInput {
  /** The question as extracted (Markdown / LaTeX / plain text). */
  question: string
}

export function buildSystemPrompt(): string {
  return [
    'You translate one university homework question into Simplified Chinese for a student who reads Chinese better than the original language.',
    '',
    'Rules:',
    '- Translate faithfully, sentence by sentence, in the original order. Do not summarise, shorten, explain, restate the task in your own words, add hints, add steps or solve anything.',
    '- Keep every formula exactly as written: every $…$ and $$…$$ block, every symbol, variable, vector and matrix name, every subscript and superscript, character for character. Never translate or rewrite inside a formula.',
    '- Keep every sub-part label ((a), (b), (l), (iv) …) exactly as written, in half-width parentheses, at the start of its part as in the original.',
    '- Keep every number exactly as written (do not convert units or round).',
    '- Keep the line and paragraph structure: one line in the original stays one line; blank lines stay blank lines; lists stay lists.',
    '- Key technical terms: give the English term in parentheses on its first occurrence only, e.g. 行最简形（reduced row echelon form）; afterwards Chinese only.',
    '- Names of people, theorems named after people, and code stay as in the original where Chinese has no standard name.',
    '',
    'Output strictly valid JSON only: {"translation":"…"} (Markdown with the LaTeX unchanged).',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: QuestionTranslateInput): string {
  return [
    untrustedContentWrapper('QUESTION', input.question),
    'Respond with the JSON object only.',
  ].join('\n')
}

/** The translation text of a reply, or null when the reply has none. */
export function readTranslation(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = (raw as Record<string, unknown>).translation
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 40_000) : null
}
