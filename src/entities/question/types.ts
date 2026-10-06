import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { TranslationKey } from '@/i18n/types'
import type { Subject } from '@/entities/project/types'

export type QuestionType =
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

export const QUESTION_TYPES: QuestionType[] = [
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
]

export const QUESTION_TYPE_LABEL_KEYS: Record<QuestionType, TranslationKey> = {
  multiple_choice: 'questionType.multipleChoice',
  true_false: 'questionType.trueFalse',
  numeric: 'questionType.numeric',
  math_expr: 'questionType.expression',
  code_output: 'questionType.codeOutput',
  short_answer: 'questionType.shortAnswer',
  chem_equation: 'questionType.chemEquation',
  ordering: 'questionType.ordering',
  multiple_select: 'questionType.multipleSelect',
  matching: 'questionType.matching',
  fill_blank: 'questionType.fillBlank',
}

/** One scoring point of a short-answer question. */
export interface RubricPoint {
  /** Stable within the question: `p1`, `p2`, … */
  id: string
  /** One idea the answer must contain, stated in a single sentence. */
  text: string
}

export interface QuestionOption {
  id: string
  label: string
  isCorrect: boolean
}

export interface Question {
  id: string
  projectId: string
  topicId?: string
  knowledgePoint: string
  type: QuestionType
  difficulty: DifficultyLevel
  prompt: string
  /** Present for multiple_choice. True/false is modelled as two options too. */
  options?: QuestionOption[]
  /** Canonical answer string (option id for MC/TF, value otherwise). */
  correctAnswer: string
  /**
   * Numeric only: the unit the value is expressed in (mathjs syntax, e.g.
   * `m/s^2`). When present the student must answer with a unit; any unit of
   * the same dimension is converted before grading.
   */
  unit?: string
  /**
   * Short answer only: the scoring points. The score is the share of points
   * the answer covers (3 of 5 points → 3/5), checked by AI point by point
   * with verbatim evidence verified locally.
   */
  rubric?: RubricPoint[]
  /**
   * Ordering only: the items in the CORRECT order. `correctAnswer` is the same
   * items joined by newlines; the field shows them shuffled.
   */
  orderItems?: string[]
  /**
   * Matching (B-type) only: the stems that share `options`. `correctAnswer`
   * holds the matched option labels in stem order, joined by " | ".
   */
  matchItems?: string[]
  /**
   * Fill-blank only: per blank (written ____ in the prompt), the accepted
   * answers — the standard term first, then exact synonyms / abbreviations.
   */
  blanks?: string[][]
  solution?: string
  hints: string[]
  sourceRefs: SourceReference[]
  /** Prompt version that produced this question. */
  promptVersion: string
  createdAt: number
}

export interface NewQuestionInput {
  projectId: string
  topicId?: string
  knowledgePoint: string
  type: QuestionType
  difficulty: DifficultyLevel
  prompt: string
  options?: Array<{ label: string; isCorrect: boolean }>
  correctAnswer: string
  unit?: string
  rubric?: RubricPoint[]
  orderItems?: string[]
  matchItems?: string[]
  blanks?: string[][]
  solution?: string
  hints?: string[]
  sourceRefs?: SourceReference[]
  promptVersion?: string
}

export function normalizeQuestionOptions(
  options: Array<{ label: string; isCorrect: boolean }> | undefined,
): QuestionOption[] | undefined {
  if (!options || options.length === 0) return undefined
  return options.map((o, idx) => ({
    id: `opt-${idx + 1}`,
    label: o.label,
    isCorrect: o.isCorrect,
  }))
}
/** The canonical answer as shown to the student, with its unit when it has one. */
export function expectedAnswerText(
  question: Pick<Question, 'correctAnswer' | 'unit' | 'type'> & Partial<Pick<Question, 'options' | 'matchItems' | 'blanks'>>,
): string {
  if (question.type === 'ordering') return question.correctAnswer.split('\n').join(' → ')
  if (question.type === 'multiple_select' && question.options) {
    return question.options
      .map((option, i) => (option.isCorrect ? `${optionLetter(i)}. ${option.label}` : ''))
      .filter(Boolean)
      .join('；')
  }
  if (question.type === 'matching' && question.matchItems) {
    const labels = question.correctAnswer.split(' | ')
    return question.matchItems
      .map((item, i) => {
        const index = question.options?.findIndex((option) => option.label === labels[i]) ?? -1
        return `${i + 1}. ${item} → ${index >= 0 ? optionLetter(index) : labels[i] ?? ''}`
      })
      .join('；')
  }
  if (question.type === 'fill_blank' && question.blanks) {
    return question.blanks.map((answers, i) => `(${i + 1}) ${answers[0] ?? ''}`).join('  ')
  }
  return question.unit ? `${question.correctAnswer} ${question.unit}` : question.correctAnswer
}

/** A, B, C … for option positions. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

/**
 * A stored answer as the student should read it: option ids become letters
 * and labels ("A. …"), matching answers "1→B", blanks "(1) … (2) …".
 */
export function displayAnswer(
  question: Pick<Question, 'type'> & Partial<Pick<Question, 'options' | 'matchItems'>>,
  userAnswer: string,
): string {
  const options = question.options ?? []
  const describe = (id: string) => {
    const index = options.findIndex((o) => o.id === id.trim())
    return index >= 0 ? `${optionLetter(index)}. ${options[index]!.label}` : id
  }
  if (!userAnswer.trim()) return ''
  if (question.type === 'multiple_choice') return describe(userAnswer)
  if (question.type === 'multiple_select') return userAnswer.split(',').filter(Boolean).map(describe).join('；')
  if (question.type === 'matching') {
    return userAnswer
      .split(',')
      .map((id, i) => {
        const index = options.findIndex((o) => o.id === id.trim())
        return `${i + 1}→${index >= 0 ? optionLetter(index) : '—'}`
      })
      .join('  ')
  }
  if (question.type === 'fill_blank') return userAnswer.split('\n').map((answer, i) => `(${i + 1}) ${answer || '—'}`).join('  ')
  return userAnswer
}

/**
 * Question types a course offers. "What does this program print?" only makes
 * sense in a computer-science course; every other type is offered everywhere.
 */
export function questionTypesForSubject(subject: Subject | undefined): QuestionType[] {
  return QUESTION_TYPES.filter(
    (type) =>
      (type !== 'code_output' || subject === 'cs') &&
      (type !== 'chem_equation' || subject === 'chemistry'),
  )
}
