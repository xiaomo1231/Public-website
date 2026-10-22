/**
 * v1 guided-steps prompt (引导练习, non-matrix questions).
 *
 * Converts an existing, stored walkthrough of one homework question into a
 * short sequence of practice steps with blanks. The model only restructures
 * the walkthrough: every blank's answer must be copied from it (checked
 * locally; blanks whose answer is not found are dropped), and each blank
 * names the kind of local grader it needs. No new mathematics is written.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'guided-steps' as const

export interface GuidedStepsInput {
  question: string
  /** The walkthrough's conclusion + body (Markdown + LaTeX). */
  walkthrough: string
  /** Blank kinds the course's graders support, e.g. ["expression","number","text"]. */
  kinds: readonly string[]
}

export function buildSystemPrompt(): string {
  return [
    'You turn an existing worked solution (the WALKTHROUGH) of one homework question into guided practice: a short sequence of steps the student completes by filling in blanks.',
    '',
    'Rules:',
    '- Follow the walkthrough’s own steps and order; 3–8 steps. Do not add methods, results or facts that are not in the walkthrough.',
    '- Each step: "text" restates what is done in this step (Markdown, LaTeX in $…$), with 1–3 key results replaced by placeholders [[1]], [[2]], … (ids unique within the step). Choose results a student should compute or recall, not trivial words.',
    '- "answer" of a blank: the result exactly as the walkthrough states it, in plain grader syntax: expressions in calculator syntax (x^2/2 + 1, sqrt(3), 2*pi), numbers as numbers, quantities as number + unit (9.8 m/s^2), chemical equations as 2H2 + O2 -> 2H2O, program output verbatim. It must be copied from the walkthrough, never newly computed.',
    '- "kind" of a blank, from the allowed list only: expression (a formula / expression, graded by equivalence), number (a plain number, graded with a relative tolerance), quantity (number + unit), chemistry (a chemical equation), text (a term or short phrase; give other accepted spellings in "accepted", e.g. the English or Chinese name, an abbreviation), exact (program output or code, matched exactly).',
    '- "explanation": what the walkthrough says about this step (why it is done, how the result is obtained), shown as a hint. Keep the walkthrough’s language.',
    '- "title": a few words naming the step.',
    '- Write the step text in the same language as the walkthrough.',
    '',
    'Output strictly valid JSON only:',
    '{"steps":[{"title":"…","text":"… [[1]] …","explanation":"…","blanks":[{"id":"1","answer":"…","kind":"expression","accepted":["…"],"tolerance":0.01}]}]}',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: GuidedStepsInput): string {
  return [
    `Allowed blank kinds: ${JSON.stringify(input.kinds)}`,
    untrustedContentWrapper('QUESTION', input.question),
    untrustedContentWrapper('WALKTHROUGH', input.walkthrough),
    'Respond with the JSON object only.',
  ].join('\n')
}
