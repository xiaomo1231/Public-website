/**
 * v2 of the document-analyzer prompt.
 *
 * v2 adds **topic source-chunk dependencies**: every chunk in the document
 * content carries a stable machine-readable id (`c:<chunkId>`), and each topic
 * must declare which of those chunks it was built from.
 *
 * Why this exists: a teaching topic may span several chapters, so the topic's
 * `chapterId`/`sectionId` is only its *display* position. Incremental
 * re-analysis needs the real dependency, and it must come from the model
 * choosing within a closed candidate set — never from inference, and never from
 * the model inventing ids.
 *
 * v1 is kept alongside so old call sites and prompt-version comparisons still
 * work; the registry in `../index.ts` points at v2.
 */

import type { DocumentAnalysisOutput } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v2' as const
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
      "sourceChunkIds": ["c-id"],
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
    '  - Every passage of the document content begins with a bracketed label whose first part is a chunk id, e.g. `[c:9f3a… · Ch 3 · 3.1 · p12]`.',
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
    '',
    'Document content (each passage is prefixed with its chunk id):',
    untrustedContentWrapper('DOCUMENT', input.documentText),
    '',
    'Respond with JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

export const EXPECTED_OUTPUT_TYPE = 'DocumentAnalysisOutput' as const

export type { DocumentAnalysisOutput }
