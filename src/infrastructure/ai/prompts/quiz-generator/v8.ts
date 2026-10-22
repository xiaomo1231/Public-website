/**
 * v8 quiz-generator prompt: fewer tokens per batch, same rules.
 *  - System prompt: only the rules and JSON fields of the question types this
 *    quiz plans (`types`), so a multiple-choice quiz no longer carries the
 *    code-output, chemistry, ordering, matching … rules. The prompt is still
 *    identical for every batch, top-up and retry of one quiz (one type set), so
 *    providers' automatic prefix caches keep hitting. Without `types` it is
 *    v7's word for word.
 *  - User prompt: stable parts first — topic, language, professor style and
 *    habits, then the source material — and the per-batch parts last (focus
 *    knowledge points, questions to avoid, the plan). Batches sharing their
 *    passages (a small quiz, a top-up round) now share that whole prefix.
 * v7 is kept unchanged.
 */

import * as V7 from './v7'
import { untrustedContentWrapper } from '../security'
import { examLanguageInstruction, examLanguageOf } from '../exam-language/v1'
import { professorStyleSection } from '../question-style/v1'

export const VERSION = 'v8' as const
export const PROMPT_KIND = 'quiz-generator' as const

export type QuizQuestionType = V7.QuizQuestionType
export type QuizGenerationInput = V7.QuizGenerationInput
export type GeneratedParadigm = V7.GeneratedParadigm
export type GeneratedQuizQuestion = V7.GeneratedQuizQuestion
export type QuizGenerationOutput = V7.QuizGenerationOutput

export interface QuizSystemPromptOptions extends V7.QuizSystemPromptOptions {
  /** The question types this quiz plans. Absent ⇒ every type (v7's prompt). */
  types?: readonly QuizQuestionType[]
}

/** Every type in the order the rules describe them. */
const TYPE_ORDER: readonly QuizQuestionType[] = [
  'multiple_choice',
  'true_false',
  'numeric',
  'math_expr',
  'code_output',
  'short_answer',
  'chem_equation',
  'ordering',
  'multiple_select',
  'matching',
  'fill_blank',
  'article_gender',
  'paradigm_table',
]

/** Which planned types need a rule block (multiple_select refers to rule 4). */
function needsRule(type: string, types: ReadonlySet<string>): boolean {
  if (type === 'a2-vignette') return types.has('multiple_choice')
  if (types.has(type)) return true
  return type === 'multiple_choice' && types.has('multiple_select')
}

/** The rule a block describes, read from its first line; `null` = applies to every type. */
function ruleType(line: string): string | null {
  const own = /^ {2}\d+\. For `(\w+)`/.exec(line)
  if (own) return own[1]!
  // The A2 clinical-vignette rule is about multiple-choice questions.
  if (/^ {2}\d+\. In a medical course a `multiple_choice`/.test(line)) return 'a2-vignette'
  return null
}

function schemaFor(types: readonly QuizQuestionType[]): string {
  const has = (...list: QuizQuestionType[]) => list.some((type) => types.includes(type))
  return JSON.stringify(
    {
      questions: [
        {
          prompt: 'string',
          type: types.join(' | '),
          ...(has('multiple_choice', 'multiple_select', 'matching')
            ? { options: [{ label: 'string', isCorrect: 'boolean' }] }
            : {}),
          correctAnswer: 'string',
          ...(has('numeric') ? { unit: 'string | null (numeric only)' } : {}),
          ...(has('short_answer')
            ? { rubric: ['string (short_answer only: one scoring point each)'] }
            : {}),
          ...(has('ordering')
            ? { orderItems: ['string (ordering only: items in the correct order)'] }
            : {}),
          ...(has('matching')
            ? {
                matchItems: ['string (matching only: the stems)'],
                matchAnswers: ['number (matching only: option index per stem)'],
              }
            : {}),
          ...(has('fill_blank')
            ? { blanks: [['string (fill_blank only: accepted answers for this blank)']] }
            : {}),
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
  )
}

export function buildSystemPrompt(options: QuizSystemPromptOptions = {}): string {
  const { types, ...v7Options } = options
  const full = V7.buildSystemPrompt(v7Options)
  if (!types || types.length === 0) return full
  const planned = new Set<string>(types)
  const ordered = TYPE_ORDER.filter((type) => planned.has(type))

  const lines = full.split('\n')
  const out: string[] = []
  let inRules = false
  let keep = true
  let schemaAt = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line === 'Rules:') inRules = true
    else if (inRules && line === '') inRules = false
    if (inRules && /^ {2}\d+[a-z]?\. /.test(line)) {
      const type = ruleType(line)
      keep = type === null || needsRule(type, planned)
    } else if (!inRules) keep = true
    if (line === 'JSON schema:') {
      // Replace the schema (up to the blank line after it) with the planned types' fields.
      out.push(line, schemaFor(ordered))
      schemaAt = i
      while (i + 1 < lines.length && lines[i + 1] !== '') i++
      continue
    }
    if (keep) out.push(line)
  }
  return schemaAt >= 0 ? out.join('\n') : full
}

const CLOSING = 'Respond with the JSON object only.'

/** v6's language line. */
function languageLine(language: QuizGenerationInput['language']): string {
  // 跟随考试语言 (`exam:<code>`); every other value is v6's line word for word.
  const exam = examLanguageOf(language)
  if (exam) return `Respond in: ${examLanguageInstruction(exam)}.`
  return `Respond in: ${
    language === 'zh_terms'
      ? 'Simplified Chinese. At the first mention of each key technical term, give the English term in parentheses, e.g. 核孔复合体（nuclear pore complex）. Options, hints and the solution follow the same style; `quote` stays verbatim in the source language'
      : language === 'zh'
        ? 'Simplified Chinese'
        : language === 'en'
          ? 'English'
          : 'English with key Chinese terms in parentheses'
  }.`
}

export function buildUserPrompt(input: QuizGenerationInput): string {
  const planText = input.plan
    .map((p, i) => `  ${i + 1}. type=${p.type} difficulty=${p.difficulty}`)
    .join('\n')
  const avoid = input.avoidRepeating?.length
    ? `Avoid repeating these previously-asked questions:\n${input.avoidRepeating.map((q) => `- ${q}`).join('\n')}`
    : ''
  const kp = input.knowledgePoints.length
    ? `Focus knowledge points: ${input.knowledgePoints.join(', ')}.`
    : ''
  return [
    // Stable for the whole quiz.
    `Topic: ${input.topicName}.`,
    `Description: ${input.topicDescription}.`,
    languageLine(input.language),
    input.professorStyleContext
      ? [
          'PROFESSOR QUESTION STYLE CONTEXT (how the instructor writes questions):',
          input.professorStyleContext,
          'Generate NEW questions. Do not copy or lightly reword any uploaded question.',
          'Match the observed assessment style and difficulty pattern only where the evidence supports it.',
          'The learner’s explicit request always wins over the style context.',
        ].join('\n')
      : '',
    input.professorHabits ? professorStyleSection(input.professorHabits) : '',
    // Each snippet is already tagged with its `[chunk:<id>]` so the model can
    // cite the exact one it used.
    `${untrustedContentWrapper('SOURCE MATERIAL', input.sourceSnippets.join('\n\n'))}\n`,
    // This batch.
    kp,
    avoid,
    `Generate exactly ${input.plan.length} question(s) in this exact plan:`,
    `${planText}\n`,
    CLOSING,
  ]
    .filter(Boolean)
    .join('\n')
}
