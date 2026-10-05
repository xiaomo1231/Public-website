/**
 * v1 short-answer check prompt.
 *
 * Grades ONE short answer point by point against its scoring points. The
 * model only decides, per point, whether the answer states that idea and
 * quotes the student's own words as evidence; the score (points covered /
 * total) is computed locally, and every quote is verified locally against the
 * student's text — a point whose evidence cannot be found is not covered.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'short-answer-check' as const

export interface ShortAnswerCheckInput {
  question: string
  points: Array<{ id: string; text: string }>
  referenceAnswer: string
  studentAnswer: string
  language: 'zh' | 'en' | 'mixed'
}

export interface ShortAnswerCheckOutput {
  status?: 'ready' | 'insufficient'
  points?: Array<{ id?: unknown; covered?: unknown; evidence?: unknown }>
  contradictions?: unknown
  feedback?: unknown
  reason?: unknown
}

export function buildSystemPrompt(): string {
  return [
    'You check ONE student short answer against its scoring points. You do not give an overall grade; the app computes the score from your per-point decisions.',
    '',
    'For EACH scoring point:',
    '  - `covered: true` when the answer states the same idea in any wording: a synonym, a paraphrase, an equivalent formula, or a correct specific example that clearly expresses the idea all count.',
    '  - `covered: false` when the idea is missing, only hinted at without committing to it, stated incorrectly, or contradicted.',
    '  - When covered, set `evidence` to the shortest passage of the student answer that shows it, copied VERBATIM (exact characters, at most 200). Never paraphrase, translate, fix typos or combine separate passages. If you cannot quote it, the point is not covered.',
    '  - Judge only what is written. Do not give credit for knowledge the student did not express, and do not penalise wording, spelling or style.',
    '',
    '`contradictions`: statements in the answer that are factually wrong given the reference answer and the question, each copied VERBATIM from the answer. Empty when there are none.',
    '`feedback`: 1–3 neutral, specific sentences on which ideas to add or correct. Never judge the student or call a mistake careless.',
    '',
    'If the question or scoring points are too incomplete to judge, return {"status":"insufficient","reason":"..."} instead.',
    '',
    'Output strictly valid JSON only, no prose and no markdown fence:',
    '{"status":"ready","points":[{"id":"p1","covered":true,"evidence":"..."},{"id":"p2","covered":false}],"contradictions":["..."],"feedback":"..."}',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: ShortAnswerCheckInput): string {
  const language =
    input.language === 'zh'
      ? 'Simplified Chinese'
      : input.language === 'en'
        ? 'English'
        : 'the language of the student answer'
  return [
    `Write the feedback in ${language}.`,
    untrustedContentWrapper('QUESTION', input.question),
    untrustedContentWrapper(
      'SCORING POINTS',
      input.points.map((point) => `${point.id}: ${point.text}`).join('\n'),
    ),
    untrustedContentWrapper('REFERENCE ANSWER', input.referenceAnswer),
    untrustedContentWrapper('STUDENT ANSWER', input.studentAnswer),
    'Return one entry in `points` for every scoring point id. Respond with the JSON object only.',
  ].join('\n')
}
