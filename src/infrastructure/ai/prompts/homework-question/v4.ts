/**
 * v4 of the homework-question prompt.
 *
 * Changes only the professor-answer requests (`hasProfessorAnswer`); every
 * prompt without a professor answer is byte-identical to v3.
 *
 *  - The professor answer is mapped to the sub-parts by meaning: a sub-part
 *    may be answered inside another one, labels inside one solution may name
 *    alternative methods, labels may be skipped or mistyped.
 *  - A sub-part the professor left to the student ("I leave the first part to
 *    you") or did not solve is still written, opening with one line saying it
 *    is not from the professor answer.
 *  - `part`: write only one sub-part (a long question split per sub-part),
 *    with the whole question and the whole professor answer as context.
 *  - `partiallyDeferred`: the answer says some of it is left to the student.
 */
import { securityFooter, untrustedContentWrapper } from '../security'
import * as V3 from './v3'

export const VERSION = 'v4' as const
export const PROMPT_KIND = 'homework-question' as const

export type HomeworkQuestionMode = V3.HomeworkQuestionMode
export type HomeworkQuestionOutput = V3.HomeworkQuestionOutput

export interface HomeworkQuestionInput extends V3.HomeworkQuestionInput {
  /** v4: write only this sub-part (professor-answer requests only). */
  part?: { label: string; text: string }
  /** v4: the professor answer leaves some sub-parts to the student. */
  partiallyDeferred?: boolean
}

const ANSWER_RULES = [
  '  - Read the WHOLE professor answer and map its content to the sub-parts of the question by meaning, not only by labels: a sub-part may be answered inside another sub-part’s solution, labels such as (a)/(b) inside one solution may name alternative methods ("two ways"), and a label may be skipped, repeated, out of order or mistyped (e.g. a reference to a part that does not exist). Follow the intended meaning and add one short note on an obvious typo.',
  '  - For every sub-part the professor solved, follow the professor’s method and reach the professor’s result.',
  '  - For a sub-part the professor left to the student (e.g. "I leave the first part to you") or did not solve, still write hints and a complete worked solution, and start that sub-part of the solution with one short line saying so, e.g. "教授答案未给出此小题的解答，以下为讲解。" when writing Chinese or "The professor’s answer gives no solution for this part; this is our own explanation." when writing English. Never present that work as the professor’s.',
  '  - Cover every sub-part of the question in the solution, each under its own label; never stop or refuse because the professor answer is incomplete.',
]

export function buildSystemPrompt(
  mode: HomeworkQuestionMode = 'combined',
  compact = false,
  hasProfessorAnswer = false,
): string {
  const base = V3.buildSystemPrompt(mode, compact, hasProfessorAnswer)
  if (!hasProfessorAnswer) return base
  // v3's "say so plainly instead of inventing a reconciliation" line made a
  // model stop on a partly solved answer; v4 replaces it with explicit rules.
  const lines = base.split('\n')
  const index = lines.findIndex((line) => line.includes("If the professor's answer is incomplete"))
  const replacement = [
    "  - If the professor's answer disagrees with the source passages, say so plainly instead of inventing a reconciliation.",
    ...ANSWER_RULES,
  ]
  if (index < 0) {
    const footer = lines.lastIndexOf(securityFooter())
    lines.splice(footer < 0 ? lines.length : footer, 0, ...ANSWER_RULES)
  } else {
    lines.splice(index, 1, ...replacement)
  }
  return lines.join('\n')
}

export function buildUserPrompt(input: HomeworkQuestionInput): string {
  const base = V3.buildUserPrompt(input)
  if (!input.professorAnswer?.trim() || (!input.part && !input.partiallyDeferred)) return base
  const notes = [
    ...(input.partiallyDeferred
      ? [
          'Note: the professor answer leaves part of this question to the student. Write those sub-parts yourself and label them as not from the professor answer.',
        ]
      : []),
    ...(input.part
      ? [
          `Write the hints and the solution ONLY for sub-part (${input.part.label}). The whole question and the whole professor answer are given for context: find what the professor wrote for this sub-part by meaning. Do not write the other sub-parts.`,
          untrustedContentWrapper(`SUB-PART (${input.part.label})`, input.part.text),
        ]
      : []),
  ]
  const tail = 'Return JSON only.'
  return base.endsWith(tail)
    ? `${base.slice(0, -tail.length)}${notes.join('\n')}\n${tail}`
    : [base, ...notes].join('\n')
}
