/**
 * v1 rubric-extractor prompt.
 *
 * Splits a professor's reference answer into scoring points for a short-answer
 * question. The points come only from the reference answer — the model must
 * not add ideas the professor did not write — so a professor practice
 * question is graded against what the professor actually expects.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'rubric-extractor' as const

export interface RubricExtractorInput {
  question: string
  referenceAnswer: string
  language: 'zh' | 'en' | 'mixed'
}

export interface RubricExtractorOutput {
  points?: unknown
}

export function buildSystemPrompt(): string {
  return [
    'You split a reference answer into scoring points for grading a short answer.',
    '',
    'Rules:',
    '  - Return 2–6 points. Each point is ONE idea from the reference answer, written as a short self-contained statement (the actual claim, not "mentions X").',
    '  - Use ONLY what the reference answer says. Never add an idea, an example, a condition or a fact that is not in it, even if it is true.',
    '  - Points must not overlap, and together they must cover the reference answer.',
    '  - If the reference answer holds fewer than two distinct ideas, return the ideas it has (one is allowed); never pad.',
    '  - Write the points in the requested language.',
    '',
    'Output strictly valid JSON only: {"points":["...","..."]}',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: RubricExtractorInput): string {
  const language =
    input.language === 'zh'
      ? 'Simplified Chinese'
      : input.language === 'en'
        ? 'English'
        : 'the language of the reference answer'
  return [
    `Write the points in ${language}.`,
    untrustedContentWrapper('QUESTION', input.question),
    untrustedContentWrapper('REFERENCE ANSWER', input.referenceAnswer),
    'Respond with the JSON object only.',
  ].join('\n')
}

/** 1–6 trimmed, distinct points, or null when the output is unusable. */
export function normalizeRubricPoints(output: unknown, maxLength = 200): string[] | null {
  if (!output || typeof output !== 'object') return null
  const raw = (output as RubricExtractorOutput).points
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const points: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const text = item.trim().slice(0, maxLength)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    points.push(text)
    if (points.length === 6) break
  }
  return points.length > 0 ? points : null
}
