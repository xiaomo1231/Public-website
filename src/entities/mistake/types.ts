import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { QuestionOption } from '@/entities/question/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { TranslationKey } from '@/i18n/types'

/**
 * Mistake categories. Deliberately excludes a "careless" label — the system
 * never asserts carelessness, only observable patterns.
 */
export type MistakeType =
  | 'conceptual'
  | 'formula'
  | 'calculation'
  | 'sign'
  | 'unit'
  | 'misreading'
  | 'incomplete_reasoning'
  | 'unknown'

export const MISTAKE_TYPES: MistakeType[] = [
  'conceptual',
  'formula',
  'calculation',
  'sign',
  'unit',
  'misreading',
  'incomplete_reasoning',
  'unknown',
]

export const MISTAKE_TYPE_LABEL_KEYS: Record<MistakeType, TranslationKey> = {
  conceptual: 'mistakeCategory.conceptual',
  formula: 'mistakeCategory.formula',
  calculation: 'mistakeCategory.calculation',
  sign: 'mistakeCategory.sign',
  unit: 'mistakeCategory.unit',
  misreading: 'mistakeCategory.misreading',
  incomplete_reasoning: 'mistakeCategory.incomplete',
  unknown: 'mistakeCategory.unknown',
}

export type MistakeStatus = 'active' | 'understood' | 'archived'
export type MistakeSource = 'auto' | 'manual'
export type MistakeAnalysisStatus = 'pending' | 'analyzing' | 'ready' | 'failed'

export interface SimilarExample {
  prompt: string
  answer: string
  explanation?: string
}

/**
 * The result of AI mistake analysis. Every field is phrased as an
 * observation or a *possible* cause — never as a judgement of the student.
 */
export interface MistakeAnalysis {
  /** Where in the working the answer first goes wrong. */
  whereWrong: string
  /** The first concrete error, stated neutrally. */
  firstError: string
  /** Why that step does not hold. */
  whyWrong: string
  /** The correct reasoning path. */
  correctApproach: string
  /** Phrased as a possibility, e.g. "This may indicate …". */
  possibleCause: string
  mistakeType: MistakeType
  /** Knowledge points worth reviewing. */
  reviewKnowledgePoints: string[]
  /** Whether further practice is likely to help. */
  shouldPracticeMore: boolean
  /** A close variant of the original question, with its answer. */
  similarExample?: SimilarExample
  /** A short, friendly invitation to continue. */
  continuePrompt: string
  analyzedAt: number
  promptVersion: string
}

export interface Mistake {
  id: string
  projectId: string
  /** Present when the mistake came from a stored question. */
  questionId?: string
  quizId?: string
  topicId?: string

  knowledgePoint: string
  difficulty: DifficultyLevel
  questionType: string

  /** Snapshot of the question so manually-added mistakes stand alone. */
  question: string
  options?: QuestionOption[]
  studentAnswer: string
  correctAnswer: string
  solution?: string
  /**
   * Snapshot of the question's course citation, so the mistake book can show
   * the original material without re-reading the quiz. Absent for mistakes
   * recorded before this field existed, and for hand-added ones.
   */
  sourceRefs?: SourceReference[]

  mistakeType: MistakeType
  analysis?: MistakeAnalysis
  analysisStatus: MistakeAnalysisStatus
  analysisError?: string

  status: MistakeStatus
  source: MistakeSource

  /** Attempt ids that contributed to this mistake. */
  attemptIds: string[]
  /** How many times this question was answered incorrectly. */
  attemptCount: number

  createdAt: number
  updatedAt: number
  resolvedAt?: number
  archivedAt?: number
}

export interface AddMistakeInput {
  projectId: string
  questionId?: string
  quizId?: string
  topicId?: string
  knowledgePoint: string
  difficulty: DifficultyLevel
  questionType: string
  question: string
  options?: QuestionOption[]
  studentAnswer: string
  correctAnswer: string
  solution?: string
  mistakeType?: MistakeType
  attemptIds?: string[]
}

export interface MistakeFilter {
  status?: MistakeStatus | 'all'
  knowledgePoint?: string
  mistakeType?: MistakeType
  quizId?: string
  query?: string
}

export interface MistakeStats {
  total: number
  active: number
  understood: number
  archived: number
  byType: Record<MistakeType, number>
  byKnowledgePoint: Array<{ knowledgePoint: string; count: number }>
}