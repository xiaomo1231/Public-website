import type { ChatMessage } from '@/infrastructure/ai/types'
import type { DifficultyLevel, SourceReference, TutorEvaluation } from '@/infrastructure/ai/prompts/types'
import type { TranslationKey } from '@/i18n/types'

export type { DifficultyLevel, SourceReference, TutorEvaluation }

export type TutorSessionStatus = 'active' | 'completed' | 'abandoned'
export type TutorTurnKind = 'introduction' | 'question' | 'answer' | 'feedback' | 'hint' | 'note'

export const SESSION_STATUS_LABEL_KEYS: Record<TutorSessionStatus, TranslationKey> = {
  active: 'sessionStatus.active',
  completed: 'sessionStatus.completed',
  abandoned: 'sessionStatus.abandoned',
}

export const TURN_KIND_LABEL_KEYS: Record<TutorTurnKind, TranslationKey> = {
  introduction: 'turnKind.introduction',
  question: 'turnKind.question',
  answer: 'turnKind.answer',
  feedback: 'turnKind.feedback',
  hint: 'turnKind.hint',
  note: 'turnKind.note',
}

export type SourceRef = SourceReference

export interface TutorQuestion {
  id: string
  prompt: string
  type: 'multiple_choice' | 'true_false' | 'numeric' | 'math_expr'
  options?: string[]
  expectedAnswer: string
  explanation: string
  knowledgePoint: string
  difficulty: DifficultyLevel
  sourceRefs: SourceRef[]
  hints: string[]
}

export interface TutorTurn {
  role: 'tutor' | 'student' | 'system'
  kind: TutorTurnKind
  content: string
  question?: TutorQuestion
  evaluation?: TutorEvaluation
  /** Index of the source snippet used (if any). */
  sourceIndex?: number
  createdAt: number
}

export interface TutorSession {
  id: string
  projectId: string
  topicId?: string
  topicName: string
  language: 'zh' | 'en' | 'mixed'
  /** Up-to-date conversation context for the AI. */
  messages: ChatMessage[]
  /** Persisted turns for the UI. */
  turns: TutorTurn[]
  /** Last generated question (awaiting answer). */
  pendingQuestion?: TutorQuestion
  /** Number of consecutive correct answers — feeds difficulty engine. */
  streakCorrect: number
  /** Number of consecutive wrong answers. */
  streakWrong: number
  currentDifficulty: DifficultyLevel
  /** True after the student has asked for a hint for the current question. */
  hintsRevealed: number
  /** Cumulative performance metric used by the difficulty adjuster. */
  mastery: number
  status: TutorSessionStatus
  startedAt: number
  updatedAt: number
}