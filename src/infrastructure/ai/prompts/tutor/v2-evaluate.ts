/**
 * Tutor "evaluate an answer" prompt v2 — v1's rules with the user prompt
 * reordered for providers' automatic prefix caches: the topic, language and
 * source material (the same for every answer of a session) come first, the
 * question, expected answer and the student's answer last. The system prompt
 * is v1's. v1 is kept unchanged.
 */

import * as V1 from './v1-evaluate'
import { untrustedContentWrapper } from '../security'
import { examLanguageInstruction, examLanguageOf } from '../exam-language/v1'

export const VERSION = 'v2' as const

export type EvaluateAnswerInput = V1.EvaluateAnswerInput

export const buildSystemPrompt = V1.buildSystemPrompt

export function buildUserPrompt(input: EvaluateAnswerInput): string {
  return [
    `Topic: ${input.topicName}.`,
    `Respond in: ${examLanguageOf(input.language) ? examLanguageInstruction(examLanguageOf(input.language)!) : input.language === 'zh' ? 'Simplified Chinese' : 'English'}.`,
    untrustedContentWrapper(
      'SOURCE MATERIAL',
      input.sourceSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
    ),
    '',
    `Question: ${input.question}`,
    `Expected answer: ${input.expectedAnswer}`,
    // The student's answer is free text typed by the user and is untrusted.
    untrustedContentWrapper('STUDENT ANSWER', input.studentAnswer),
  ].join('\n')
}

export type { TutorEvaluation } from './v1-evaluate'
