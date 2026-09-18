/**
 * Tutor question generation prompt — asks the model for a JSON `TutorQuestion`.
 *
 * Question types match `entities/question/types.ts` so a tutor question can be
 * recorded in the mistake book exactly like a quiz question.
 */

import type { DifficultyLevel } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface QuestionGeneratorInput {
  topicName: string
  topicDescription: string
  difficulty: DifficultyLevel
  language: 'zh' | 'en' | 'mixed'
  /** Up to 3 prior questions to avoid repeating. */
  avoidRepeating?: string[]
  /** Source snippets for grounding. */
  sourceSnippets: string[]
  /** Optional conversation context (previous student answer etc.). */
  recentContext?: string
}

export function buildSystemPrompt(): string {
  return [
    'You are a tutor generating the next practice question for a student.',
    'Output strictly valid JSON. No prose. The question must be grounded in the source material provided.',
    'Set `type` to exactly one of: "multiple_choice", "true_false", "numeric", "math_expr".',
    'For "multiple_choice", `options` must list 4 distinct, non-empty answer strings and `expectedAnswer` must repeat the correct one verbatim.',
    'For "true_false", `expectedAnswer` must be "true" or "false".',
    'For "numeric", `expectedAnswer` must be a bare number. For "math_expr", a mathjs-parseable expression.',
    'Include 2-3 progressive hints that the tutor can release one at a time.',
    'Keep prompts crisp; numeric / math expression answers must be evaluable by a deterministic grader later.',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: QuestionGeneratorInput): string {
  const avoid = input.avoidRepeating?.length
    ? `\nAvoid repeating these previous prompts:\n${input.avoidRepeating.map((p) => `- ${p}`).join('\n')}\n`
    : ''
  const ctx = input.recentContext ? `\nRecent context: ${input.recentContext}\n` : ''
  return [
    `Topic: ${input.topicName}.`,
    `Description: ${input.topicDescription}.`,
    `Difficulty: ${input.difficulty}.`,
    `Respond in: ${input.language === 'zh' ? 'Simplified Chinese' : input.language === 'en' ? 'English' : 'English with key Chinese terms in parentheses'}.`,
    avoid + ctx,
    untrustedContentWrapper(
      'SOURCE MATERIAL',
      input.sourceSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
    ),
    '',
    'Produce the JSON for the next question.',
  ].join('\n')
}

export type { GeneratedQuestion } from '../types'