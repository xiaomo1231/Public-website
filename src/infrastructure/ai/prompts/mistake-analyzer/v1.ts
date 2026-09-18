/**
 * v1 mistake analyzer. Phase 3 only registers the prompt module — the
 * mistake-driven adaptive loop is wired in Phase 9.
 */

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'mistake-analyzer' as const

export interface MistakeAnalyzerInput {
  question: string
  expectedAnswer: string
  studentAnswer: string
  knowledgePoint?: string
  context?: string
}

export interface MistakeAnalyzerOutput {
  mistakeType: 'conceptual' | 'calculation' | 'formula' | 'sign' | 'unit' | 'misreading' | 'incomplete_reasoning' | 'careless' | 'unknown'
  analysis: string
  /** Phrased as a *possible* cause — never declaring the student "careless". */
  framing: string
  /** Recommended next action: same topic, similar question, weakness training, or none. */
  recommendedFollowUp: 'same_topic' | 'similar' | 'weakness' | 'none'
}

export function buildSystemPrompt(): string {
  return [
    'You classify student mistakes in a STEM course.',
    'Always use neutral, encouraging framing — never label the student "careless".',
    'Possible mistake types: conceptual, calculation, formula, sign, unit, misreading, incomplete_reasoning, careless, unknown.',
    'Output strictly valid JSON matching the schema below — no prose, no fences.',
    '',
    'Schema:',
    JSON.stringify(
      {
        mistakeType: 'string',
        analysis: 'string (1-2 sentences)',
        framing: 'string (1 sentence, e.g. "You may have mixed up the sign convention")',
        recommendedFollowUp: 'same_topic | similar | weakness | none',
      },
      null,
      2,
    ),
  ].join('\n')
}

export function buildUserPrompt(input: MistakeAnalyzerInput): string {
  return [
    `Question: ${input.question}`,
    `Expected answer: ${input.expectedAnswer}`,
    `Student answer: ${input.studentAnswer}`,
    input.knowledgePoint ? `Knowledge point: ${input.knowledgePoint}` : '',
    input.context ? `Context: ${input.context}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}