/**
 * v1 of the document-analyzer prompt.
 *
 * One JSON-shaped call extracts: topics, concepts, formulas, symbols,
 * examples, exercises, and prerequisites. Returns a `DocumentAnalysisOutput`.
 *
 * To upgrade, copy this directory to `v2/`, change the VERSION, and adjust
 * the call site in documentAnalysisService.ts to import the newer version.
 */

import type { DocumentAnalysisOutput } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'document-analyzer' as const

export interface DocumentAnalyzerInput {
  documentName: string
  documentText: string
  language: 'zh' | 'en' | 'mixed'
  /** Optional context about the course subject (e.g. "calculus"). */
  subject?: string
}

const JSON_SHAPE_HINT = `
{
  "language": "zh" | "en" | "mixed",
  "topics": [
    { "name": "string", "description": "string",
      "sourceRefs": [{ "documentName": "string", "page": number|null, "section": "string|null", "quote": "string|null" }] }
  ],
  "concepts": [
    { "name": "string", "definition": "string", "explanation": "string|null",
      "topicNames": ["string"], "sourceRefs": [...] }
  ],
  "formulas": [
    { "name": "string", "latex": "string", "description": "string",
      "variables": [{ "symbol": "string", "meaning": "string" }],
      "sourceRefs": [...] }
  ],
  "symbols": [
    { "symbol": "string", "meaning": "string", "context": "string", "unit": "string|null",
      "sourceRefs": [...] }
  ],
  "examples": [
    { "title": "string", "problem": "string", "solution": "string|null",
      "topicNames": ["string"], "sourceRefs": [...] }
  ],
  "exercises": [
    { "prompt": "string", "topicNames": ["string"],
      "difficulty": "beginner|basic|intermediate|advanced|challenge",
      "sourceRefs": [...] }
  ],
  "prerequisites": [
    { "name": "string", "description": "string", "topicNames": ["string"] }
  ]
}
`.trim()

export function buildSystemPrompt(): string {
  return [
    'You are an expert tutor who extracts structured knowledge from course material.',
    'Always cite the exact page / section for any fact you record.',
    'Copy any `quote` verbatim from the document. Never rewrite, translate, reword or "clean up" the source text.',
    'Some documents contain characters that could not be decoded — unassigned symbols, replacement characters or runs of "?". Keep them exactly as they appear and never substitute a guess for them.',
    'When a symbol has different meanings in different contexts, record each meaning under a separate symbol entry with a distinct `context`.',
    'For formulas, prefer LaTeX that renders cleanly with KaTeX (use \\frac, \\sqrt, \\sum, etc.).',
    'Output strictly valid JSON matching the schema below. No prose, no markdown fences.',
    '',
    'JSON schema:',
    JSON_SHAPE_HINT,
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: DocumentAnalyzerInput): string {
  const subject = input.subject ? `Course subject: ${input.subject}.` : ''
  const langHint =
    input.language === 'zh'
      ? 'Respond in Simplified Chinese.'
      : input.language === 'en'
        ? 'Respond in English.'
        : 'Detect the dominant language and respond in it; use bilingual only for short clarifications.'
  return [
    `Analyze the following course document and produce a structured analysis.`,
    subject,
    `Document name: ${input.documentName}.`,
    `Document language preference: ${input.language}. ${langHint}`,
    '',
    'Document content:',
    untrustedContentWrapper('DOCUMENT', input.documentText),
    '',
    'Respond with JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

export const EXPECTED_OUTPUT_TYPE = 'DocumentAnalysisOutput' as const

export type { DocumentAnalysisOutput }