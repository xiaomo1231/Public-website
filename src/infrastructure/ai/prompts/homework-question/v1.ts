/**
 * Writes the progressive hints and the full worked solution for ONE homework
 * question, from that question's own source passages.
 *
 * The hints are shown one at a time and must never reveal the final answer;
 * the solution is revealed only when the student explicitly asks for it. The
 * solution is AI-generated and labelled as such in the UI.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'homework-question' as const

export interface HomeworkQuestionInput {
  question: string
  sourceText: string
  language: 'zh' | 'en' | 'mixed'
}

export interface HomeworkQuestionOutput {
  hints: string[]
  solution: string
}

const JSON_SHAPE_HINT = `{ "hints": ["string", "..."], "solution": "string" }`

export function buildSystemPrompt(): string {
  return [
    'You are a patient tutor preparing help for one homework question.',
    'Return strictly valid JSON with exactly two fields: "hints" and "solution". No prose, no markdown fences.',
    '',
    'Hints (2 to 4, shown one at a time, in order):',
    '  - Hint 1 orients the student: what the question is really asking and which idea applies.',
    '  - Later hints narrow the method or point to the next concrete step.',
    '  - Hints must build up gradually and must NEVER state the final numeric or symbolic answer.',
    '  - Prefer a guiding question or a small "try this next" over stating a result.',
    '  - Each hint is one or two sentences.',
    '',
    'Solution:',
    '  - A complete, self-contained worked solution: the reasoning steps and the final answer.',
    '  - Use simple LaTeX only where it helps, wrapped in $...$ (e.g. $x^2 + 2x$).',
    '',
    'Stay on the supplied question only. If the source passages are insufficient, give the best supported guidance while clearly saying what is missing; never invent facts.',
    '',
    'JSON schema:',
    JSON_SHAPE_HINT,
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: HomeworkQuestionInput): string {
  const langHint =
    input.language === 'zh'
      ? 'Write the hints and solution in Simplified Chinese.'
      : input.language === 'en'
        ? 'Write the hints and solution in English.'
        : 'Write in the language of the question.'
  return [
    'Prepare progressive hints and a full worked solution for this question.',
    `Language preference: ${input.language}. ${langHint}`,
    '',
    `Question:\n${input.question}`,
    '',
    'Relevant source passages:',
    untrustedContentWrapper('SOURCE PASSAGES', input.sourceText),
    '',
    'Respond with JSON only.',
  ].join('\n')
}

export const EXPECTED_OUTPUT_TYPE = 'HomeworkQuestionOutput' as const
