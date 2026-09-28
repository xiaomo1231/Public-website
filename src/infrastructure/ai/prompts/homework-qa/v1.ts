/**
 * The per-question help conversation.
 *
 * The reply is plain text (not JSON). By default the tutor guides step by
 * step and does NOT hand over the final answer; the full solution is a
 * separate, student-triggered reveal. This is a local product choice, not a
 * security boundary.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'homework-qa' as const

export interface HomeworkQaHistoryItem {
  role: 'student' | 'assistant'
  content: string
}

export interface HomeworkQaInput {
  question: string
  sourceText: string
  history: HomeworkQaHistoryItem[]
  message: string
  language: 'zh' | 'en' | 'mixed'
}

export function buildSystemPrompt(): string {
  return [
    'You are a patient tutor helping a student with one specific homework question.',
    'Guide step by step: ask small questions, give minimal nudges, and let the student do the work.',
    'Do NOT reveal the final answer or the complete solution in this conversation, even if asked directly — tell the student to use the "Show answer" control when they want the full worked solution.',
    'Keep replies short (a few sentences), concrete, and encouraging. Never judge the student or call them careless.',
    'Stay on the current question. If the source passages do not cover something, say so honestly instead of inventing it.',
    securityFooter(),
  ].join('\n')
}

function renderHistory(history: HomeworkQaHistoryItem[]): string {
  if (history.length === 0) return '(no previous messages)'
  return history
    .map((item) => `${item.role === 'student' ? 'Student' : 'Tutor'}: ${item.content}`)
    .join('\n')
}

export function buildUserPrompt(input: HomeworkQaInput): string {
  const langHint =
    input.language === 'zh'
      ? 'Reply in Simplified Chinese.'
      : input.language === 'en'
        ? 'Reply in English.'
        : 'Reply in the language of the student message.'
  return [
    'Help the student with this question.',
    `Language preference: ${input.language}. ${langHint}`,
    '',
    `Question:\n${input.question}`,
    '',
    'Relevant source passages:',
    untrustedContentWrapper('SOURCE PASSAGES', input.sourceText),
    '',
    'Conversation so far:',
    renderHistory(input.history),
    '',
    `Student: ${input.message}`,
    '',
    'Reply to the student as the tutor. Output plain text only.',
  ].join('\n')
}

export const EXPECTED_OUTPUT_TYPE = 'string' as const
