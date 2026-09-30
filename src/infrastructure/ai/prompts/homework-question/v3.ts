/**
 * v3 of the homework-question prompt.
 *
 * v2 prepares progressive hints and a worked solution from the question and its
 * source passages. v3 adds an optional professor answer: when the student has
 * linked and confirmed an official answer for THIS question, the help must be
 * grounded in it. Hints still guide without revealing the final answer, and the
 * model must never present its own derivation as the professor's words.
 */
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v3' as const
export const PROMPT_KIND = 'homework-question' as const

export interface HomeworkQuestionInput {
  question: string
  sourceText: string
  language: 'zh' | 'en' | 'mixed'
  /**
   * The professor's answer for THIS question, verbatim. Only ever set after a
   * one-to-one confirmation; never fabricated locally.
   */
  professorAnswer?: string
}

export type HomeworkQuestionMode = 'combined' | 'hints' | 'solution'

export interface HomeworkQuestionOutput {
  hints: string[]
  solution: string
}

export function buildSystemPrompt(
  mode: HomeworkQuestionMode = 'combined',
  compact = false,
  hasProfessorAnswer = false,
): string {
  const task = mode === 'hints'
    ? 'Return strictly valid JSON with one field: {"hints":["string","..."]}. Write 2 to 4 progressive hints. Never state the final answer.'
    : mode === 'solution'
      ? 'Return strictly valid JSON with one field: {"solution":"string"}. Give a complete worked solution with the necessary steps and final answer.'
      : 'Return strictly valid JSON with exactly two fields: {"hints":["string","..."],"solution":"string"}. Write 2 to 4 progressive hints and a complete worked solution.'
  return [
    'You are a patient tutor preparing help for one homework question.',
    task,
    'Hints are shown one at a time. Start with the relevant idea, then guide the next step. Never reveal the final answer in a hint.',
    'Use simple LaTeX only where it helps, wrapped in $...$. Do not invent facts or source citations.',
    ...(hasProfessorAnswer
      ? [
          'A professor\'s official answer for THIS question is supplied in the user message.',
          '  - The worked solution MUST reach and state the professor\'s answer, following the professor\'s method where it is shown.',
          '  - Hints must still guide the student without revealing the final answer, even though the answer is known to you.',
          '  - Never attribute your own wording to the professor. If you add steps the professor did not write, they are your explanation, not the professor\'s words.',
          '  - If the professor\'s answer is incomplete, ambiguous, or disagrees with the source passages, say so plainly instead of inventing a reconciliation.',
        ]
      : []),
    compact
      ? 'Keep the JSON compact. Use one sentence per hint. In the solution include each necessary reasoning step and the final answer, but omit repetition and lengthy introductions.'
      : 'Keep the response focused on this question. Explain the necessary reasoning clearly.',
    'No prose outside JSON and no markdown fences.',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: HomeworkQuestionInput): string {
  const langHint = input.language === 'zh'
    ? 'Write in Simplified Chinese.'
    : input.language === 'en'
      ? 'Write in English.'
      : 'Write in the language of the question.'
  const professorAnswer = input.professorAnswer?.trim()
  return [
    `Prepare help for this question. ${langHint}`,
    untrustedContentWrapper('HOMEWORK QUESTION', input.question),
    input.sourceText.trim()
      ? untrustedContentWrapper('RELEVANT SOURCE PASSAGES', input.sourceText)
      : '',
    professorAnswer
      ? untrustedContentWrapper(
          'PROFESSOR ANSWER FOR THIS QUESTION (reference; the student checks it against the original file)',
          professorAnswer,
        )
      : '',
    'Return JSON only.',
  ].filter(Boolean).join('\n')
}
