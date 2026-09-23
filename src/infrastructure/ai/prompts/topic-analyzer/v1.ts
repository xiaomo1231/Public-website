/**
 * Topic-scoped analyzer.
 *
 * Used by incremental re-analysis: when a topic's source chunks change, only
 * that topic is regenerated. The prompt is deliberately narrow — it receives
 * one topic plus the candidate chunks it may cite, and returns only that
 * topic's derived knowledge.
 *
 * Same rules as the document analyzer: `sourceChunkIds` must be chosen from the
 * printed candidate ids, and the result is validated locally before it is
 * persisted. The model never invents a chunk id.
 */

import type {
  DocumentConcept,
  DocumentExample,
  DocumentExercise,
  DocumentFormula,
  DocumentPrerequisite,
  DocumentSymbol,
} from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'topic-analyzer' as const

export interface TopicAnalyzerChunk {
  id: string
  /** Human-readable origin, e.g. `Ch 3 · 3.1 · p12`. */
  label: string
  text: string
}

export interface TopicAnalyzerInput {
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
  chapterLabel?: string
  sectionLabel?: string
  chunks: TopicAnalyzerChunk[]
}

export interface TopicAnalysisOutput {
  language: 'zh' | 'en' | 'mixed'
  topic: {
    name: string
    description: string
    sourceChunkIds: string[]
  }
  concepts: DocumentConcept[]
  formulas: DocumentFormula[]
  symbols: DocumentSymbol[]
  examples: DocumentExample[]
  exercises: DocumentExercise[]
  prerequisites: DocumentPrerequisite[]
}

const JSON_SHAPE_HINT = `
{
  "language": "zh" | "en" | "mixed",
  "topic": { "name": "string", "description": "string", "sourceChunkIds": ["c-id"] },
  "concepts": [
    { "name": "string", "definition": "string", "explanation": "string|null",
      "topicNames": ["<the topic name>"], "sourceRefs": [...] }
  ],
  "formulas": [
    { "name": "string", "latex": "string", "description": "string",
      "variables": [{ "symbol": "string", "meaning": "string" }], "sourceRefs": [...] }
  ],
  "symbols": [
    { "symbol": "string", "meaning": "string", "context": "string", "unit": "string|null",
      "sourceRefs": [...] }
  ],
  "examples": [
    { "title": "string", "problem": "string", "solution": "string|null",
      "topicNames": ["<the topic name>"], "sourceRefs": [...] }
  ],
  "exercises": [
    { "prompt": "string", "topicNames": ["<the topic name>"],
      "difficulty": "beginner|basic|intermediate|advanced|challenge", "sourceRefs": [...] }
  ],
  "prerequisites": [
    { "name": "string", "description": "string", "topicNames": ["<the topic name>"] }
  ]
}
`.trim()

export function buildSystemPrompt(): string {
  return [
    'You are an expert tutor updating ONE topic of an existing course analysis.',
    'Only describe the given topic. Do not introduce other topics.',
    'Base every statement on the supplied course material and cite the exact page / section.',
    'Copy any `quote` verbatim from the source. Never rewrite or translate it.',
    'Keep any undecodable characters exactly as they appear; never substitute a guess.',
    'For formulas, prefer LaTeX that renders cleanly with KaTeX.',
    'Output strictly valid JSON matching the schema below. No prose, no markdown fences.',
    '',
    'TOPIC SOURCES — this is critical:',
    '  - Every supplied passage is prefixed with a bracketed label whose first part is a chunk id, e.g. `[c:9f3a… · Ch 3 · 3.1 · p12]`.',
    '  - Set `topic.sourceChunkIds` to the ids of **every** supplied chunk this topic is built from.',
    '  - The topic may span more than one chapter or section; list chunks from all of them.',
    '  - Use the ids **exactly as printed**. Never invent, modify or omit an id that does not appear in the material.',
    '',
    'JSON schema:',
    JSON_SHAPE_HINT,
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: TopicAnalyzerInput): string {
  const language =
    input.language === 'zh'
      ? 'Simplified Chinese'
      : input.language === 'en'
        ? 'English'
        : 'Bilingual: primarily English, with key Chinese terms in parentheses'

  const material = input.chunks
    .map((chunk) => `[c:${chunk.id} · ${chunk.label}]\n${chunk.text}`)
    .join('\n\n')

  return [
    `Regenerate the analysis for this single topic: ${input.topicName}.`,
    input.topicDescription ? `Current topic summary: ${input.topicDescription}.` : '',
    `Write in: ${language}.`,
    '',
    input.chapterLabel || input.sectionLabel
      ? [
          'CURRENT MATERIAL (textbook position — authoritative):',
          input.chapterLabel ? `Chapter: ${input.chapterLabel}` : '',
          input.sectionLabel ? `Section: ${input.sectionLabel}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    '',
    untrustedContentWrapper('TOPIC COURSE MATERIAL', material),
    '',
    'Respond with JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}
