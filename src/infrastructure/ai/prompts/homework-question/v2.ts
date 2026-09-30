/** Bounded preparation of hints and a worked solution for one homework question. */
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v2' as const
export const PROMPT_KIND = 'homework-question' as const

export interface HomeworkQuestionInput {
  question: string
  sourceText: string
  language: 'zh' | 'en' | 'mixed'
}

export type HomeworkQuestionMode = 'combined' | 'hints' | 'solution'

export interface HomeworkQuestionOutput {
  hints: string[]
  solution: string
}

export function buildSystemPrompt(mode: HomeworkQuestionMode = 'combined', compact = false): string {
  const task = mode === 'hints'
    ? 'Return strictly valid JSON with one field: {"hints":["string","..."]}. Write 2 to 4 progressive hints. Never state the final answer.'
    : mode === 'solution'
      ? 'Return strictly valid JSON with one field: {"solution":"string"}. Give a complete worked solution with the necessary steps and final answer.'
      : 'Return strictly valid JSON with exactly two fields: {"hints":["string","..."],"solution":"string"}. Write 2 to 4 progressive hints and a complete worked solution.'
  return [
    'You are a patient tutor preparing help for one homework question.',
    task,
    'Hints are shown one at a time. Start with the relevant idea, then guide the next step. Never reveal the final answer in a hint.',
    'Use simple LaTeX only where it helps, wrapped in $...$. Do not invent facts or source citations.',
    compact
      ? 'Keep the JSON compact. Use one sentence per hint. In the solution include each necessary reasoning step and the final answer, but omit repetition and lengthy introductions.'
      : 'Keep the response focused on this question. Explain the necessary reasoning clearly.',
    'No prose outside JSON and no markdown fences.',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: HomeworkQuestionInput): string {
  const langHint = input.language === 'zh'
    ? 'Write in Simplified Chinese.'
    : input.language === 'en'
      ? 'Write in English.'
      : 'Write in the language of the question.'
  return [
    `Prepare help for this question. ${langHint}`,
    untrustedContentWrapper('HOMEWORK QUESTION', input.question),
    input.sourceText.trim()
      ? untrustedContentWrapper('RELEVANT SOURCE PASSAGES', input.sourceText)
      : '',
    'Return JSON only.',
  ].filter(Boolean).join('\n')
}
