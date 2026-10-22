/**
 * v3 of the document-analyzer prompt.
 *
 * Same contract as v2 (each topic declares the chunks it was built from, chosen
 * from a closed candidate set), but every passage is labelled with a **short
 * alias** valid for this request only (`[c12 · Ch 3 · 3.1 · p12]`) instead of
 * the 36-character chunk UUID, and each document heading carries its name
 * rather than its id. The model echoes the aliases in `sourceChunkIds`; the
 * caller maps them back to real chunk ids (`resolveChunkAliases`) before
 * validation, so an unknown alias is discarded exactly like an unknown id.
 *
 * Bumping the version re-analyses every course once (freshness reports
 * `prompt-changed`). v1 / v2 are kept alongside.
 */

import type { DocumentAnalysisOutput } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v3' as const
export const PROMPT_KIND = 'document-analyzer' as const

export interface DocumentAnalyzerInput {
  documentName: string
  documentText: string
  language: 'zh' | 'en' | 'mixed'
  /** Optional context about the course subject (e.g. "calculus"). */
  subject?: string
  /** Set when the course is analysed in several parts (1-based index). */
  part?: { index: number; total: number; label: string }
}

const JSON_SHAPE_HINT = `
{
  "language": "zh" | "en" | "mixed",
  "topics": [
    { "name": "string", "description": "string",
      "sourceChunkIds": ["c12"],
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
    'TOPIC SOURCES — this is critical:',
    '  - Every passage of the document content begins with a bracketed label whose first part is a short chunk id, e.g. `[c12 · Ch 3 · 3.1 · p12]` has the id `c12`.',
    '  - For each topic you must set `sourceChunkIds` to the ids of **every** chunk the topic is actually built from.',
    '  - A topic MAY span more than one chapter or section. If it does, list the chunks from all of them.',
    '  - Use the ids **exactly as printed**. Never invent an id, never modify one, and never use an id that does not appear in the document content.',
    '  - If a topic is genuinely not grounded in any single passage, still list the closest chunks it summarises. Only leave `sourceChunkIds` empty if you truly cannot attribute the topic to any passage.',
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
    input.part
      ? `This is part ${input.part.index} of ${input.part.total} of the course material (${input.part.label}). ` +
        'Analyze only this part: record the topics, concepts, formulas, symbols, examples, exercises and prerequisites it contains. ' +
        'The other parts are analyzed separately and merged afterwards, so do not summarize the whole course and do not add topics that are not in this part.'
      : '',
    '',
    'Document content (each passage is prefixed with its short chunk id):',
    untrustedContentWrapper('DOCUMENT', input.documentText),
    '',
    'Respond with JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

export const EXPECTED_OUTPUT_TYPE = 'DocumentAnalysisOutput' as const

export type { DocumentAnalysisOutput }
