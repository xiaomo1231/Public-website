/**
 * Tutor question generation prompt v3 — v2's rules with the user prompt
 * reordered for providers' automatic prefix caches: the topic, language and
 * source material (the same for every question of a session) come first, the
 * per-question parts (difficulty, questions to avoid, recent context) last.
 * The system prompt is v2's. v2 is kept unchanged.
 */

import * as V2 from './v2-question'
import { untrustedContentWrapper } from '../security'

export const VERSION = 'v3' as const

export type QuestionGeneratorInput = V2.QuestionGeneratorInput

export const buildSystemPrompt = V2.buildSystemPrompt

export function buildUserPrompt(input: QuestionGeneratorInput): string {
  const avoid = input.avoidRepeating?.length
    ? `Avoid repeating these previous prompts:\n${input.avoidRepeating.map((p) => `- ${p}`).join('\n')}`
    : ''
  const ctx = input.recentContext ? `Recent context: ${input.recentContext}` : ''
  return [
    `Topic: ${input.topicName}.`,
    `Description: ${input.topicDescription}.`,
    `Respond in: ${input.language === 'zh' ? 'Simplified Chinese' : input.language === 'en' ? 'English' : 'English with key Chinese terms in parentheses'}.`,
    untrustedContentWrapper(
      'SOURCE MATERIAL',
      input.sourceSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
    ),
    '',
    `Difficulty: ${input.difficulty}.`,
    ...(avoid ? [avoid] : []),
    ...(ctx ? [ctx] : []),
    '',
    'Produce the JSON for the next question.',
  ].join('\n')
}

export type { GeneratedQuestion } from '../types'
