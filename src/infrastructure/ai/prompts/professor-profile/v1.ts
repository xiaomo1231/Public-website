/**
 * Professor teaching-profile prompt.
 *
 * Describes HOW the professor teaches (style, analogies, sequence), never
 * impersonates them and never restates course facts. Output is JSON.
 */

import type { ProfessorTeachingProfile } from '@/entities/courseContext/types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface ProfessorProfileInput {
  topicNames: string[]
  transcriptExcerpts: string[]
}

export function buildSystemPrompt(): string {
  return [
    'You are analysing a university lecture transcript to describe HOW the professor teaches.',
    'Describe observable teaching patterns only.',
    'Do NOT impersonate the professor. Do NOT write "the professor would say".',
    'Do NOT restate or redefine course facts — the textbook is the source of facts.',
    'Return strictly valid JSON matching this schema:',
    JSON.stringify(
      {
        explanationStyle: 'string',
        terminologyPreferences: ['string'],
        commonAnalogies: ['string'],
        recurringExamples: ['string'],
        emphasisPatterns: ['string'],
        teachingSequence: ['string'],
      },
      null,
      2,
    ),
    'Use an empty array for anything the transcript does not show. Keep every value short.',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: ProfessorProfileInput): string {
  return [
    `Course topics: ${input.topicNames.join(', ') || '(none)'}`,
    '',
    untrustedContentWrapper(
      'LECTURE TRANSCRIPT EXCERPTS',
      input.transcriptExcerpts.join('\n\n'),
    ),
  ].join('\n')
}

export type { ProfessorTeachingProfile }
