/**
 * v1 translation prompt — context-aware translation that considers the
 * student's course topic. Returns JSON.
 */

import type { TranslationOutput } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface TranslateInput {
  selectedText: string
  /** Surrounding paragraph the user is reading. */
  surroundingContext: string
  /** Current topic / chapter name. */
  topic?: string
  sourceLanguage: 'zh' | 'en'
  targetLanguage: 'zh' | 'en'
}

export function buildSystemPrompt(): string {
  return [
    'You are a bilingual tutor translating a single word or short phrase from a STEM course.',
    'Pick the translation that best fits the course context — the same word can mean different things in math vs physics vs chemistry vs everyday English.',
    'Provide:',
    '  • translation: the chosen translation in the target language',
    '  • contextNote: one short sentence explaining the meaning in this specific course context',
    '  • alternatives: 0-3 alternative renderings the student might encounter elsewhere',
    'Output strictly valid JSON matching the schema below.',
    '',
    'Schema:',
    JSON.stringify(
      {
        translation: 'string',
        contextNote: 'string',
        alternatives: ['string'],
      },
      null,
      2,
    ),
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: TranslateInput): string {
  return [
    `Source language: ${input.sourceLanguage}.`,
    `Target language: ${input.targetLanguage}.`,
    input.topic ? `Current topic: ${input.topic}.` : '',
    // Both the selection and its surrounding paragraph come from the user's
    // course material and must be treated as data, not instructions.
    untrustedContentWrapper('SELECTED TEXT', input.selectedText),
    untrustedContentWrapper('SURROUNDING TEXT', input.surroundingContext),
  ]
    .filter(Boolean)
    .join('\n')
}

export type { TranslationOutput }