/**
 * Passage-based help for lessons, homework and homework walkthroughs.
 *
 * v3 adds the walkthrough context (the reader is studying a worked solution,
 * so the answer may explain any step freely) and the earlier turns of the same
 * conversation, so a follow-up question is understood in context. Without
 * history and outside a walkthrough it asks exactly what v2 asked.
 */
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v3' as const

export type ContextualTutorKind = 'lesson' | 'homework' | 'walkthrough'

export interface ContextualTutorTurn {
  question: string
  answer: string
}

export interface ContextualTutorInput {
  topicTitle?: string
  sectionHeading?: string
  selectedText: string
  surroundingContext: string
  question: string
  language: string
  contextKind?: ContextualTutorKind
  history?: ContextualTutorTurn[]
}

function contextRule(contextKind: ContextualTutorKind): string {
  if (contextKind === 'homework') {
    return 'This selection is from homework. Guide the learner with a small next step or hint; do not reveal the final answer or complete solution. The homework page has a separate explicit Answer action.'
  }
  if (contextKind === 'walkthrough') {
    return 'This selection is from a complete worked walkthrough of the homework that the learner is reading, so the solution is already in front of them. Explain the selected step fully: why it is done, where each number comes from, and what it means. If the arithmetic or reasoning in the selection looks wrong, say so plainly and show the correct step.'
  }
  return 'Keep the answer focused on the selected lesson content.'
}

export function buildSystemPrompt(contextKind: ContextualTutorKind = 'lesson'): string {
  return [
    'You are helping a learner understand a specific selected passage.',
    'Answer the learner’s question using the selection and its nearby context.',
    'Do not regenerate the lesson. Do not modify the lesson.',
    'Do not translate unless the learner explicitly asks for translation.',
    'Do not invent source citations. Preserve mathematical meaning.',
    'Use LaTeX for mathematical notation: inline \\( ... \\), display \\[ ... \\] on their own lines.',
    'Never output Private Use Area characters or raw Unicode maths symbols as the canonical notation.',
    'If the selection is ambiguous, say what is unclear rather than inventing information.',
    contextRule(contextKind),
    'Use 2-5 short paragraphs. Add a small example or formula only if useful.',
    'Answer in the same language as the selected passage unless the learner asks otherwise.',
    securityFooter(),
  ].join('\n')
}

const MAX_HISTORY_TURNS = 6
const MAX_HISTORY_ANSWER = 1_500

export function buildUserPrompt(input: ContextualTutorInput): string {
  const history = (input.history ?? []).slice(-MAX_HISTORY_TURNS)
  return [
    input.topicTitle ? `Topic: ${input.topicTitle}` : '',
    input.sectionHeading ? `Section: ${input.sectionHeading}` : '',
    untrustedContentWrapper('SELECTED PASSAGE', input.selectedText),
    input.surroundingContext
      ? untrustedContentWrapper('NEARBY CONTEXT', input.surroundingContext)
      : '',
    history.length > 0
      ? untrustedContentWrapper(
          'EARLIER IN THIS CONVERSATION',
          history
            .map((turn, index) => `Q${index + 1}: ${turn.question}\nA${index + 1}: ${turn.answer.slice(0, MAX_HISTORY_ANSWER)}`)
            .join('\n\n'),
        )
      : '',
    untrustedContentWrapper('LEARNER QUESTION', input.question),
  ].filter(Boolean).join('\n')
}
