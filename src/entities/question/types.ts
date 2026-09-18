import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'

export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer'
  | 'numeric'
  | 'math_expr'

export const QUESTION_TYPES: QuestionType[] = [
  'multiple_choice',
  'true_false',
  'short_answer',
  'numeric',
  'math_expr',
]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple choice',
  true_false: 'True / False',
  short_answer: 'Short answer',
  numeric: 'Numeric answer',
  math_expr: 'Mathematical expression',
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