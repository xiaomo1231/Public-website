/**
 * v1 quiz-generator prompt.
 *
 * Generates a batch of questions with explicit types and difficulties,
 * grounded in the provided source material. Returns JSON.
 */

import type { DifficultyLevel } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'quiz-generator' as const

export type QuizQuestionType = 'multiple_choice' | 'true_false' | 'numeric' | 'math_expr'

export interface QuizGenerationInput {
  topicName: string
  topicDescription: string
  knowledgePoints: string[]
  /** One entry per question, in order. */
  plan: Array<{ difficulty: DifficultyLevel; type: QuizQuestionType }>
  language: 'zh' | 'en' | 'mixed'
  sourceSnippets: string[]
  /** Questions to avoid repeating. */
  avoidRepeating?: string[]
}

export interface GeneratedQuizQuestion {
  prompt: string
  type: QuizQuestionType
  options?: Array<{ label: string; isCorrect: boolean }>
  correctAnswer: string
  solution: string
  knowledgePoint: string
  difficulty: DifficultyLevel
  hints: string[]
  /**
   * Id of the snippet the question was derived from, exactly as printed in the
   * prompt's `[chunk:<id>]` tag. The app resolves it against local storage —
   * an id that was not offered in the prompt is discarded.
   */
  sourceChunkId?: string | null
  /** Verbatim excerpt from that snippet. Never a summary or paraphrase. */
  quote?: string | null
}

export interface QuizGenerationOutput {
  questions: GeneratedQuizQuestion[]
}

export function buildSystemPrompt(): string {
  return [
    'You are an assessment designer generating a quiz for a university STEM student.',
    'Rules:',
    '  1. Every question must be answerable from the provided source material.',
    '  2. Output strictly valid JSON — no prose, no markdown fences.',
    '  3. Generate exactly as many questions as requested, in the given order, with the given type and difficulty.',
    '  4. For `multiple_choice`, produce exactly 4 options, each an object `{ "label": "...", "isCorrect": false }.`',
    '     - Every option label must contain the actual answer text. Never emit an empty or blank label.',
    '     - Never use "A", "B", "C" or "D" as the label text — the app adds its own numbering.',
    '     - Exactly one option must have `isCorrect: true`; the other three must be false.',
    '     - Set `correctAnswer` to the exact `label` text of the correct option, character for character.',
    '     - The options must be plausible and relevant to the question, not filler.',
    '  5. For `true_false`, set `correctAnswer` to "true" or "false".',
    '  6. For `numeric`, `correctAnswer` must be a bare number (no units, no text).',
    '  7. For `math_expr`, `correctAnswer` must be a mathjs-parseable expression (use `^` for powers, `*` for multiplication).',
    '  8. Each question needs 1–3 progressive hints that do not reveal the answer.',
    '  9. `solution` is the full worked answer shown after grading.',
    '  10. Every question must cite the snippet it came from:',
    '      - Each source snippet is labelled with a `[chunk:<id>]` tag. Set `sourceChunkId` to that exact id.',
    '      - Set `quote` to 1–3 sentences copied VERBATIM from that snippet. Do not paraphrase, translate or summarise it.',
    '      - Never write a summary such as "this question is based on the concept of …" — the quote must be the original wording.',
    '      - If no snippet supports the question, set both `sourceChunkId` and `quote` to null.',
    '      - Never invent a chunk id, page number, section or file name.',
    '',
    'JSON schema:',
    JSON.stringify(
      {
        questions: [
          {
            prompt: 'string',
            type: 'multiple_choice | true_false | numeric | math_expr',
            options: [{ label: 'string', isCorrect: 'boolean' }],
            correctAnswer: 'string',
            solution: 'string',
            knowledgePoint: 'string',
            difficulty: 'beginner | basic | intermediate | advanced | challenge',
            hints: ['string'],
            sourceChunkId: 'string | null',
            quote: 'string | null',
          },
        ],
      },
      null,
      2,
    ),
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: QuizGenerationInput): string {
  const planText = input.plan
    .map((p, i) => `  ${i + 1}. type=${p.type} difficulty=${p.difficulty}`)
    .join('\n')
  const avoid = input.avoidRepeating?.length
    ? `\nAvoid repeating these previously-asked questions:\n${input.avoidRepeating.map((q) => `- ${q}`).join('\n')}\n`
    : ''
  const kp = input.knowledgePoints.length
    ? `Focus knowledge points: ${input.knowledgePoints.join(', ')}.`
    : ''
  return [
    `Topic: ${input.topicName}.`,
    `Description: ${input.topicDescription}.`,
    kp,
    `Respond in: ${
      input.language === 'zh'
        ? 'Simplified Chinese'
        : input.language === 'en'
          ? 'English'
          : 'English with key Chinese terms in parentheses'
    }.`,
    avoid,
    `Generate exactly ${input.plan.length} question(s) in this exact plan:`,
    planText,
    '',
    // Each snippet is already tagged with its `[chunk:<id>]` so the model can
    // cite the exact one it used.
    untrustedContentWrapper('SOURCE MATERIAL', input.sourceSnippets.join('\n\n')),
    '',
    'Respond with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n')
}