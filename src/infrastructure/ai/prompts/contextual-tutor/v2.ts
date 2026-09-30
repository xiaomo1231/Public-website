/** Passage-based help for lessons and homework selections. */
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v2' as const

export interface ContextualTutorInput {
  topicTitle?: string
  sectionHeading?: string
  selectedText: string
  surroundingContext: string
  question: string
  language: string
  contextKind?: 'lesson' | 'homework'
}

export function buildSystemPrompt(contextKind: 'lesson' | 'homework' = 'lesson'): string {
  return [
    'You are helping a learner understand a specific selected passage.',
    'Answer the learner’s question using the selection and its nearby context.',
    'Do not regenerate the lesson. Do not modify the lesson.',
    'Do not translate unless the learner explicitly asks for translation.',
    'Do not invent source citations. Preserve mathematical meaning.',
    'Use LaTeX for mathematical notation: inline \\( ... \\), display \\[ ... \\] on their own lines.',
    'Never output Private Use Area characters or raw Unicode maths symbols as the canonical notation.',
    'If the selection is ambiguous, say what is unclear rather than inventing information.',
    contextKind === 'homework'
      ? 'This selection is from homework. Guide the learner with a small next step or hint; do not reveal the final answer or complete solution. The homework page has a separate explicit Answer action.'
      : 'Keep the answer focused on the selected lesson content.',
    'Use 2-5 short paragraphs. Add a small example or formula only if useful.',
    'Answer in the same language as the selected passage unless the learner asks otherwise.',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: ContextualTutorInput): string {
  return [
    input.topicTitle ? `Topic: ${input.topicTitle}` : '',
    input.sectionHeading ? `Section: ${input.sectionHeading}` : '',
    untrustedContentWrapper('SELECTED PASSAGE', input.selectedText),
    input.surroundingContext
      ? untrustedContentWrapper('NEARBY CONTEXT', input.surroundingContext)
      : '',
    untrustedContentWrapper('LEARNER QUESTION', input.question),
  ].filter(Boolean).join('\n')
}
