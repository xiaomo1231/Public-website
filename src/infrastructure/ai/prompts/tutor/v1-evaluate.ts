/**
 * Tutor "evaluate an answer" prompt — returns a JSON TutorEvaluation with
 * source-grounded explanation and an isSupplementary flag.
 */

import type { SourceReference, TutorEvaluation } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface EvaluateAnswerInput {
  topicName: string
  question: string
  expectedAnswer: string
  studentAnswer: string
  language: 'zh' | 'en' | 'mixed'
  sourceSnippets: string[]
  sourceRefs: SourceReference[]
}

export function buildSystemPrompt(): string {
  return [
    'You are a fair tutor evaluating a student answer.',
    'Be precise but encouraging. Accept mathematically equivalent forms.',
    'Output strictly valid JSON matching the schema below — no prose, no fences.',
    'Set `isSupplementary = true` if your feedback introduces knowledge not present in the source material.',
    '`groundedExplanation` should walk the student through the correct reasoning and cite the source where possible.',
    '',
    'Schema:',
    JSON.stringify(
      {
        isCorrect: 'boolean',
        partialCredit: 'string | null',
        feedback: 'string (short, encouraging)',
        breakdown: ['array of strings, one per step'],
        nextSteps: 'string (1-2 sentences)',
        groundedExplanation: 'string (longer walkthrough)',
        isSupplementary: 'boolean',
      },
      null,
      2,
    ),
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: EvaluateAnswerInput): string {
  return [
    `Topic: ${input.topicName}.`,
    `Question: ${input.question}`,
    `Expected answer: ${input.expectedAnswer}`,
    `Respond in: ${input.language === 'zh' ? 'Simplified Chinese' : 'English'}.`,
    '',
    // The student's answer is free text typed by the user and is untrusted.
    untrustedContentWrapper('STUDENT ANSWER', input.studentAnswer),
    untrustedContentWrapper(
      'SOURCE MATERIAL',
      input.sourceSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
    ),
  ].join('\n')
}

export type { TutorEvaluation }