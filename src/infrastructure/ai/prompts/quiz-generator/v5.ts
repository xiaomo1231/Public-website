/**
 * v5 quiz-generator prompt: adds medical exam formats — `multiple_select`
 * (X-type: several correct options, partial credit), `matching` (B-type:
 * shared options for several stems) and `fill_blank` (blanks with accepted
 * synonyms). v4 is kept unchanged.
 *
 * v4 notes: extends v3 with `chem_equation` (write the balanced equation for a described
 * reaction; graded locally by species, balance and proportional coefficients)
 * and `ordering` (arrange steps; partial credit for the longest run in the
 * right order). v1–v3 are kept unchanged.
 *
 * v3:
 * Extends v2 with `short_answer` questions: a reference answer plus 2–6
 * scoring points. The score is the share of points an answer covers, checked
 * point by point (`short-answer-check`) with the student's words verified
 * locally. v1 and v2 are kept unchanged.
 *
 * v2 extended v1 with:
 *   - an optional `unit` on numeric questions (physical quantities), graded
 *     locally by unit conversion — the value stays a bare number;
 *   - `code_output` questions: a short program in a fenced code block whose
 *     exact printed output is the answer, graded locally by exact match.
 * v1 is kept unchanged.
 */

import type { DifficultyLevel } from '../types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v5' as const
export const PROMPT_KIND = 'quiz-generator' as const

export type QuizQuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'numeric'
  | 'math_expr'
  | 'code_output'
  | 'short_answer'
  | 'chem_equation'
  | 'ordering'
  | 'multiple_select'
  | 'matching'
  | 'fill_blank'

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
  /**
   * Evidence-based description of how the professor writes questions. It
   * shapes *how* questions are written, never *what* is tested.
   */
  professorStyleContext?: string
}

export interface GeneratedQuizQuestion {
  prompt: string
  type: QuizQuestionType
  options?: Array<{ label: string; isCorrect: boolean }>
  correctAnswer: string
  /** Numeric only: unit of `correctAnswer` in mathjs syntax, or null. */
  unit?: string | null
  /** Short answer only: the scoring points, one idea each. */
  rubric?: string[] | null
  /** Ordering only: the items in the correct order. */
  orderItems?: string[] | null
  /** Matching only: the stems that share the options. */
  matchItems?: string[] | null
  /** Matching only: for each stem, the 0-based index of its option. */
  matchAnswers?: number[] | null
  /** Fill-blank only: per blank, the accepted answers (standard term first). */
  blanks?: string[][] | null
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
    '     - When the answer is a physical quantity, also set `unit` to its unit in plain ASCII mathjs syntax: `m/s^2`, `kJ/mol`, `N*m`, `mol/L`, `degC`, `uF`, `kPa`. `correctAnswer` is the value in exactly that unit.',
    '     - The question must ask for the answer WITH its unit, without naming the unit (choosing the unit is part of the task). The student may use any equivalent unit; the app converts it.',
    '     - For a dimensionless answer (a count, a ratio, a probability, a pure number) set `unit` to null.',
    '  7. For `math_expr`, `correctAnswer` must be a mathjs-parseable expression (use `^` for powers, `*` for multiplication).',
    '  8. For `code_output`, `prompt` contains a short, self-contained program in a fenced code block with a language tag (the language the course material uses), and asks what it prints.',
    '     - The output must be fully deterministic: no randomness, time, user input, file or network access, and no iteration over unordered collections (hash sets / dict order) whose order is not guaranteed.',
    '     - `correctAnswer` is EXACTLY what the program prints to standard output, one output line per line (newline characters, escaped as \\n in the JSON string), with no explanation, quotes or code fence.',
    '     - Keep programs short (at most ~20 lines) and the output small (at most ~10 lines).',
    '  9. For `short_answer`, ask a question answered in a few sentences (an explanation, a comparison, a justification, an interpretation), never one with a single word or number as its answer.',
    '     - `rubric` lists 2–6 scoring points. Each point is ONE idea the answer must contain, written as a short self-contained statement (not "mentions X" but the actual claim about X). Points must not overlap.',
    '     - Every point must be supported by the source material.',
    '     - `correctAnswer` is a model answer of at most about 150 words (or 250 Chinese characters) that covers every point.',
    '     - The answer is scored by the share of points it covers, so the question must make clear what is being asked for, without listing the points.',
    '  10. For `chem_equation`, `prompt` describes a reaction in words (reactants, products, conditions) and asks for the balanced equation; it must not contain the equation itself.',
    '     - `correctAnswer` is the balanced equation in plain mhchem syntax WITHOUT \\ce{}: `2H2 + O2 -> 2H2O`, `N2 + 3H2 <=> 2NH3`; charges with a caret (`Fe^3+`, `SO4^2-`, `e-`); states optional (`NaCl(aq)`). Use the smallest whole-number coefficients.',
    '  11. For `ordering`, `orderItems` lists 3–8 short, distinct, single-line items in the CORRECT order (steps of a process, stages, a procedure); `prompt` asks the student to put them in order and must not reveal it. `correctAnswer` repeats the items joined by newlines.',
    '  12. For `multiple_select` (X-type, one or more correct options): give 4–5 `options` with at least TWO marked `isCorrect: true`; the prompt must not say how many are correct. `correctAnswer` repeats the labels of every correct option joined by " | ".',
    '  13. For `matching` (B-type, shared options): `options` are 4–5 shared answer choices (all `isCorrect: false`), `matchItems` lists 2–5 short stems, and `matchAnswers` gives, for each stem in order, the 0-based index of its option (an option may fit several stems or none). The prompt introduces the shared options (e.g. "下列各题共用备选答案"). `correctAnswer` repeats the matched option labels joined by " | ". Option labels never contain "|".',
    '  14. For `fill_blank`: write each blank in the prompt as ____ (four underscores), 1–4 blanks. `blanks` lists, for each blank in order, the accepted answers: the standard term first, then exact synonyms, abbreviations or the English term (e.g. ["乙酰胆碱", "ACh", "acetylcholine"]); never a vaguer or broader term. `correctAnswer` repeats the first accepted answer of each blank joined by " | ".',
    '  15. In a medical course a `multiple_choice` question may be an A2 item: a short clinical vignette (2–3 sentences) followed by one question about the underlying basic science. Never ask for a diagnosis or treatment of a real person.',
    '  16. Each question needs 1–3 progressive hints that do not reveal the answer.',
    '  17. `solution` is the full worked answer shown after grading.',
    '  18. Every question must cite the snippet it came from:',
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
            type: 'multiple_choice | true_false | numeric | math_expr | code_output | short_answer | chem_equation | ordering | multiple_select | matching | fill_blank',
            options: [{ label: 'string', isCorrect: 'boolean' }],
            correctAnswer: 'string',
            unit: 'string | null (numeric only)',
            rubric: ['string (short_answer only: one scoring point each)'],
            orderItems: ['string (ordering only: items in the correct order)'],
            matchItems: ['string (matching only: the stems)'],
            matchAnswers: ['number (matching only: option index per stem)'],
            blanks: [['string (fill_blank only: accepted answers for this blank)']],
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
    input.professorStyleContext
      ? [
          'PROFESSOR QUESTION STYLE CONTEXT (how the instructor writes questions):',
          input.professorStyleContext,
          'Generate NEW questions. Do not copy or lightly reword any uploaded question.',
          'Match the observed assessment style and difficulty pattern only where the evidence supports it.',
          'The learner’s explicit request always wins over the style context.',
          '',
        ].join('\n')
      : '',
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