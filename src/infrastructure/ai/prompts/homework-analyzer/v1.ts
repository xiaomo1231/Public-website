/**
 * Extracts the questions from a student homework assignment.
 *
 * The model only decides *which questions exist* and *which chunks each one
 * came from*; it never solves them here. Source ids are chosen from a closed
 * set printed with each passage and are validated locally afterwards, so an
 * invented id can never reach the database.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'homework-analyzer' as const

export interface HomeworkAnalyzerInput {
  documentName: string
  documentText: string
  language: 'zh' | 'en' | 'mixed'
}

export interface HomeworkAnalyzerOutput {
  questions: Array<{ number?: string | null; prompt: string; sourceChunkIds: string[] }>
}

const JSON_SHAPE_HINT = `
{
  "questions": [
    { "number": "string | null", "prompt": "string", "sourceChunkIds": ["c-id"] }
  ]
}
`.trim()

export function buildSystemPrompt(): string {
  return [
    'You extract the individual questions from a student homework assignment.',
    'Return each distinct question exactly once, in the order it appears in the material.',
    'Reproduce the question text faithfully; you may tidy obvious whitespace only.',
    'Never answer, solve, or explain a question here, and never invent a question that is not in the material.',
    '',
    'QUESTION SOURCES — this is critical:',
    '  - Every passage of the document begins with a bracketed label whose first part is a chunk id, e.g. `[c:9f3a… · Ch 3 · 3.1 · p12]`.',
    '  - For each question set `sourceChunkIds` to the ids of the passages it actually comes from.',
    '  - Use the ids exactly as printed. Never invent an id, and never use one that does not appear in the document content.',
    '  - If a question is not clearly tied to one passage, list the closest passage rather than leaving it empty.',
    '',
    'JSON schema:',
    JSON_SHAPE_HINT,
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: HomeworkAnalyzerInput): string {
  const langHint =
    input.language === 'zh'
      ? 'Write the extracted question text in Simplified Chinese.'
      : input.language === 'en'
        ? 'Write the extracted question text in English.'
        : 'Keep each question in the language it appears in the material.'
  return [
    'Extract the questions from the following homework assignment.',
    `Document name: ${input.documentName}.`,
    `Language preference: ${input.language}. ${langHint}`,
    '',
    'Document content (each passage is prefixed with its chunk id):',
    untrustedContentWrapper('HOMEWORK', input.documentText),
    '',
    'Respond with JSON only.',
  ].join('\n')
}

export const EXPECTED_OUTPUT_TYPE = 'HomeworkAnalyzerOutput' as const
