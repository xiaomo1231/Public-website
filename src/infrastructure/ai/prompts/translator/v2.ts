/** Exact selection translation for terms, sentences and homework passages. */
import { securityFooter, untrustedContentWrapper } from '../security'
import type { TranslateInput } from './v1'
import type { TranslationOutput } from '../types'

export const VERSION = 'v2' as const

export function buildSystemPrompt(): string {
  return [
    'You are a STEM translator. Translate the ENTIRE selected text into the requested target language.',
    'Do not summarize, explain, answer, solve, or omit any sentence or subpart.',
    'Preserve question numbers, labels, equations, variables, mathematical meaning and paragraph breaks.',
    'Keep formulas in their original notation or faithful LaTeX; never invent missing symbols.',
    'Use surrounding context only to disambiguate terminology. Do not translate the surrounding context.',
    'Return strictly valid JSON with: translation (the full translated selection), contextNote (optional short terminology note), alternatives (0-3 short term alternatives).',
    'For a sentence or longer passage set contextNote to an empty string and alternatives to an empty array. Translation must carry all substantive content.',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: TranslateInput): string {
  return [
    `Translate from ${input.sourceLanguage} to ${input.targetLanguage}.`,
    input.topic ? `Current topic: ${input.topic}.` : '',
    untrustedContentWrapper('SELECTED TEXT', input.selectedText),
    untrustedContentWrapper('SURROUNDING TEXT', input.surroundingContext),
    'Return JSON only. The translation field must contain a complete translation of SELECTED TEXT, not the surrounding text.',
  ].filter(Boolean).join('\n')
}

export type { TranslateInput, TranslationOutput }
