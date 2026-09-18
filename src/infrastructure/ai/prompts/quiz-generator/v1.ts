/**
 * v1 quiz-generator prompt.
 *
 * Generates a batch of questions with explicit types and difficulties,
 * grounded in the provided source material. Returns JSON.
 */

import type { DifficultyLevel, SourceReference } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'quiz-generator' as const

export type QuizQuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer'
  | 'numeric'
  | 'math_expr'

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
  sourceRefs?: SourceReference[]
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
    '  4. For `multiple_choice`, provide 4 options with exactly one `isCorrect: true` and set `correctAnswer` to the exact label of the correct option.',
    '  5. For `true_false`, set `correctAnswer` to "true" or "false".',
    '  6. For `numeric`, `correctAnswer` must be a bare number (no units, no text).',
    '  7. For `math_expr`, `correctAnswer` must be a mathjs-parseable expression (use `^` for powers, `*` for multiplication).',
    '  8. For `short_answer`, `correctAnswer` should be 1–6 words; use `|` to separate acceptable alternatives.',
    '  9. Each question needs 1–3 progressive hints that do not reveal the answer.',
    '  10. `solution` is the full worked answer shown after grading.',
    '',
    'JSON schema:',
    JSON.stringify(
      {
        questions: [
          {
            prompt: 'string',
            type: 'multiple_choice | true_false | short_answer | numeric | math_expr',
            options: [{ label: 'string', isCorrect: 'boolean' }],
            correctAnswer: 'string',
            solution: 'string',
            knowledgePoint: 'string',
            difficulty: 'beginner | basic | intermediate | advanced | challenge',
            hints: ['string'],
            sourceRefs: [{ documentName: 'string', page: 'number|null', section: 'string|null' }],
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
    untrustedContentWrapper(
      'SOURCE MATERIAL',
      input.sourceSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
    ),
    '',
    'Respond with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n')
}