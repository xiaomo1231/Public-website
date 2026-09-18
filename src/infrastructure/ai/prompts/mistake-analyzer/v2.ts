/**
 * v2 mistake analyzer — full structured analysis.
 *
 * Key design constraint: the prompt must never assert carelessness. Causes
 * are framed as *possible*. The UI surfaces them with a "Possible cause"
 * label so students never read a verdict.
 */

import type { MistakeType, SimilarExample } from '@/entities/mistake/types'
import { securityFooter, untrustedContentWrapper } from '../security'


export const VERSION = 'v2' as const
export const PROMPT_KIND = 'mistake-analyzer' as const

export interface MistakeAnalyzerInput {
  question: string
  studentAnswer: string
  correctAnswer: string
  solution?: string
  knowledgePoint?: string
  difficulty?: string
  language: 'zh' | 'en' | 'mixed'
  /** Relevant source snippets for grounding. */
  sourceSnippets?: string[]
  /** Prior mistakes on the same knowledge point, to spot patterns. */
  recentMistakes?: string[]
}

export interface MistakeAnalyzerOutput {
  whereWrong: string
  firstError: string
  whyWrong: string
  correctApproach: string
  possibleCause: string
  mistakeType: MistakeType
  reviewKnowledgePoints: string[]
  shouldPracticeMore: boolean
  similarExample: SimilarExample
  continuePrompt: string
}

const SCHEMA = {
  whereWrong: 'string — the first place the working diverges from a correct solution',
  firstError: 'string — the single most important error, stated neutrally',
  whyWrong: 'string — why that step does not hold',
  correctApproach: 'string — the correct reasoning path, step by step but concise',
  possibleCause: 'string — MUST start with "This may indicate" or "A possible cause is"',
  mistakeType: 'conceptual | formula | calculation | sign | unit | misreading | incomplete_reasoning | unknown',
  reviewKnowledgePoints: ['string'],
  shouldPracticeMore: 'boolean',
  similarExample: { prompt: 'string', answer: 'string', explanation: 'string' },
  continuePrompt: 'string — one short friendly question inviting the student to continue',
}

export function buildSystemPrompt(): string {
  return [
    'You are a supportive STEM tutor analysing a student mistake.',
    '',
    'Rules:',
    '  1. NEVER say the student was careless, lazy, or sloppy. Describe the observable error instead.',
    '  2. `possibleCause` MUST be phrased as a possibility, beginning with "This may indicate" or "A possible cause is".',
    '  3. Identify the FIRST key error, not every small issue.',
    '  4. Keep each field short — one to three sentences. The UI reveals them one at a time.',
    '  5. `correctApproach` should be a compact walkthrough, not a lecture.',
    '  6. `similarExample` must be a genuinely close variant of the original question, with its answer.',
    '  7. Output strictly valid JSON matching the schema. No prose, no markdown fences.',
    '',
    'Mistake types:',
    '  conceptual             — the underlying idea is misunderstood',
    '  formula                — the wrong formula or rule was applied',
    '  calculation            — arithmetic or algebraic slip',
    '  sign                   — sign handling',
    '  unit                   — units or dimensional analysis',
    '  misreading             — the question was read incorrectly',
    '  incomplete_reasoning   — the method started correctly but was not finished or justified',
    '  unknown                — cannot be determined from the answer alone',
    '',
    'JSON schema:',
    JSON.stringify(SCHEMA, null, 2),
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: MistakeAnalyzerInput): string {
  const lines = [
    `Question: ${input.question}`,
    `Correct answer: ${input.correctAnswer}`,
    // Free text typed by the student — untrusted.
    untrustedContentWrapper('STUDENT ANSWER', input.studentAnswer || '(blank)'),
  ]
  if (input.solution) lines.push(`Reference solution: ${input.solution}`)
  if (input.knowledgePoint) lines.push(`Knowledge point: ${input.knowledgePoint}`)
  if (input.difficulty) lines.push(`Difficulty: ${input.difficulty}`)
  lines.push(
    `Respond in: ${
      input.language === 'zh'
        ? 'Simplified Chinese'
        : input.language === 'en'
          ? 'English'
          : 'English with key Chinese terms in parentheses'
    }.`,
  )
  if (input.sourceSnippets?.length) {
    lines.push(
      '',
      untrustedContentWrapper(
        'SOURCE MATERIAL',
        input.sourceSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
      ),
    )
  }
  if (input.recentMistakes?.length) {
    lines.push(
      '',
      untrustedContentWrapper(
        'RECENT MISTAKES (for pattern detection)',
        input.recentMistakes.map((m) => `- ${m}`).join('\n'),
      ),
    )
  }
  lines.push('', 'Respond with the JSON object only.')
  return lines.join('\n')
}