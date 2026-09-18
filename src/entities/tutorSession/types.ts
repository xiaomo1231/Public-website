import type { ChatMessage } from '@/infrastructure/ai/types'
import type { DifficultyLevel, SourceReference, TutorEvaluation } from '@/infrastructure/ai/prompts/types'

export type { DifficultyLevel, SourceReference, TutorEvaluation }

export type SourceRef = SourceReference

export interface TutorQuestion {
  id: string
  prompt: string
  type: 'short_answer' | 'multiple_choice' | 'true_false' | 'numeric' | 'math_expr'
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
  kind: 'introduction' | 'question' | 'answer' | 'feedback' | 'hint' | 'note'
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
  status: 'active' | 'completed' | 'abandoned'
  startedAt: number
  updatedAt: number
}