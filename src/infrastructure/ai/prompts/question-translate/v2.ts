/**
 * v2 question-translate prompt (查看原题 → 中文翻译). v1 is kept.
 *
 * Same rules as v1, but the reply is plain text between two marker lines
 * instead of `{"translation":"…"}`: in JSON every LaTeX backslash is doubled
 * (and newlines / quotes escaped), which made a formula-heavy question's
 * reply markedly longer than its translation. The text may also be one block
 * of a long question (its stem or one sub-part) when the whole reply did not
 * fit; the parts are translated separately and joined locally.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v2' as const
export const PROMPT_KIND = 'question-translate' as const

export const START_MARKER = '<<<TRANSLATION'
export const END_MARKER = 'TRANSLATION>>>'

export interface QuestionTranslateInput {
  /** The question (or one block of it) as extracted (Markdown / LaTeX / plain text). */
  question: string
  /** Set when `question` is one block of a longer question. */
  part?: { index: number; total: number }
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
    '- The text may be only one part of a longer question (its stem or one sub-part): translate just that part, without adding the rest.',
    '',
    `Output format: a line ${START_MARKER}, then the translation (Markdown with the LaTeX unchanged, written normally: single backslashes, real line breaks — this is not JSON), then a line ${END_MARKER}. Nothing before or after.`,
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: QuestionTranslateInput): string {
  return [
    ...(input.part && input.part.total > 1
      ? [
          `This is part ${input.part.index} of ${input.part.total} of one question; translate this part only.`,
        ]
      : []),
    untrustedContentWrapper('QUESTION', input.question),
    `Respond with the translation between ${START_MARKER} and ${END_MARKER} only.`,
  ].join('\n')
}

/**
 * The translation text of a reply, or null when the reply has none. Reads
 * the text between the markers; tolerates a missing end marker, a code fence
 * around the reply and a v1-style `{"translation":"…"}` object.
 */
export function readTranslation(content: string): string | null {
  let text = content.trim()
  const start = text.indexOf(START_MARKER)
  if (start >= 0) {
    text = text.slice(start + START_MARKER.length)
    const end = text.indexOf(END_MARKER)
    if (end >= 0) text = text.slice(0, end)
  } else {
    const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(text)
    if (fenced) text = fenced[1]!
    if (text.startsWith('{')) {
      try {
        const value = (JSON.parse(text) as Record<string, unknown> | null)?.translation
        text = typeof value === 'string' ? value : ''
      } catch {
        // Not JSON: the text itself.
      }
    }
  }
  text = text.trim()
  return text ? text.slice(0, 40_000) : null
}
