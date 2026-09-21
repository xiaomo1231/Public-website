/**
 * Contextual tutor prompt — answering a question about a passage the learner
 * selected in the current lesson.
 *
 * This is a reading aid, not a lesson generator: the model explains the
 * selection and must not regenerate, modify or translate the lesson.
 * Output is plain text (Markdown + LaTeX), not JSON.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface ContextualTutorInput {
  topicTitle?: string
  sectionHeading?: string
  /** The selection, already canonicalised to LaTeX when it was maths. */
  selectedText: string
  /** A short excerpt around the selection — never the whole lesson. */
  surroundingContext: string
  /** The learner's question, or a fixed prompt for the "Explain" action. */
  question: string
  language: string
}

export function buildSystemPrompt(): string {
  return [
    "You are helping the learner understand a specific piece of the current lesson.",
    '',
    "Answer the learner's question using the selected passage and its nearby context.",
    'Do not regenerate the lesson.',
    'Do not modify the lesson.',
    'Do not translate unless the user explicitly asks for translation.',
    'Do not invent source citations.',
    'Preserve mathematical meaning.',
    'Use LaTeX for mathematical notation: inline \\( ... \\), display \\[ ... \\] on their own lines.',
    'Never output Private Use Area characters or raw Unicode maths symbols as the canonical notation.',
    'If the selected content is ambiguous, explain the ambiguity instead of inventing information.',
    'Keep the answer focused on the selected content.',
    '',
    'Length: 2-5 short paragraphs. Add a short example, formula or bullet list only when it helps.',
    'Answer in the same language as the selected passage unless the learner asks otherwise.',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: ContextualTutorInput): string {
  return [
    input.topicTitle ? `Topic: ${input.topicTitle}` : '',
    input.sectionHeading ? `Section: ${input.sectionHeading}` : '',
    // The passage and the question both come from the user's material and must
    // be treated as data, never as instructions.
    untrustedContentWrapper('SELECTED PASSAGE', input.selectedText),
    input.surroundingContext
      ? untrustedContentWrapper('NEARBY CONTEXT', input.surroundingContext)
      : '',
    untrustedContentWrapper('LEARNER QUESTION', input.question),
  ]
    .filter(Boolean)
    .join('\n')
}
