/**
 * Tutor "introduce a concept" prompt.
 * Output is plain text, NOT JSON. Keep it short and grounded in source.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface IntroduceConceptInput {
  topicName: string
  topicDescription: string
  /** A short summary of the user-friendly explanation. */
  context: string
  /** Bullet-style relevant content from the source documents. */
  sourceSnippets: string[]
  language: 'zh' | 'en' | 'mixed'
}

export function buildSystemPrompt(): string {
  return [
    'You are a patient tutor guiding a university STEM student.',
    'When you explain a concept, you must:',
    '  1. Open with a short (≤ 3 sentence) intuition.',
    '  2. Provide a concise definition.',
    '  3. Walk through one worked example in plain language.',
    '  4. Cite the source document(s) you drew from. If you add information beyond the sources, mark it explicitly with the prefix "Supplementary:".',
    'Be concise — explanations should fit in one screen.',
    'End by inviting the student to try a question.',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: IntroduceConceptInput): string {
  const lang =
    input.language === 'zh'
      ? 'Simplified Chinese.'
      : input.language === 'en'
        ? 'English.'
        : 'Bilingual: primarily English, with key Chinese terms in parentheses.'
  return [
    `Topic: ${input.topicName}.`,
    `Description: ${input.topicDescription}.`,
    `Context: ${input.context}.`,
    '',
    untrustedContentWrapper(
      'SOURCE SNIPPETS',
      input.sourceSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
    ),
    '',
    `Respond in: ${lang}.`,
  ].join('\n')
}
