import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { TranslationKey } from '@/i18n/types'

export type QuestionType = 'multiple_choice' | 'true_false' | 'numeric' | 'math_expr'

export const QUESTION_TYPES: QuestionType[] = [
  'multiple_choice',
  'true_false',
  'numeric',
  'math_expr',
]

export const QUESTION_TYPE_LABEL_KEYS: Record<QuestionType, TranslationKey> = {
  multiple_choice: 'questionType.multipleChoice',
  true_false: 'questionType.trueFalse',
  numeric: 'questionType.numeric',
  math_expr: 'questionType.expression',
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