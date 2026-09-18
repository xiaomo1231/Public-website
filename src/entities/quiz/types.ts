import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { QuestionType } from '@/entities/question/types'
import type { TranslationKey } from '@/i18n/types'

export type QuizDifficulty = 'adaptive' | DifficultyLevel

export interface QuizConfig {
  topicId?: string
  topicName?: string
  /**
   *  topic      — a single topic
   *  mixed      — everything in the project
   *  weakness   — aggregated weak knowledge points
   *  review     — a review session built from recent mistakes
   */
  mode: 'topic' | 'mixed' | 'weakness' | 'review'
  count: number
  difficulty: QuizDifficulty
  types: QuestionType[]
  /** Explicit knowledge points to focus on (review sessions, practice-this-mistake). */
  focusKnowledgePoints?: string[]
  /** When set, the session was launched from a specific mistake. */
  sourceMistakeId?: string
}

export type QuizStatus = 'generating' | 'ready' | 'in_progress' | 'completed' | 'failed'

export const QUIZ_STATUS_LABEL_KEYS: Record<QuizStatus, TranslationKey> = {
  generating: 'quizStatus.generating',
  ready: 'quizStatus.ready',
  in_progress: 'quizStatus.in_progress',
  completed: 'quizStatus.completed',
  failed: 'quizStatus.failed',
}

export interface QuizDifficultyStat {
  correct: number
  wrong: number
  unverified: number
  total: number
}

export interface QuizKnowledgeStat {
  knowledgePoint: string
  correct: number
  wrong: number
  unverified: number
  total: number
}

export interface QuizScore {
  correct: number
  wrong: number
  unverified: number
  total: number
  /** Percentage of automatically-graded questions that were correct. */
  percentage: number
  byDifficulty: Record<string, QuizDifficultyStat>
  byKnowledgePoint: QuizKnowledgeStat[]
  weakKnowledgePoints: string[]
}

export interface Quiz {
  id: string
  projectId: string
  title: string
  config: QuizConfig
  questionIds: string[]
  status: QuizStatus
  /** Per-question adaptive difficulty actually used, in order. */
  difficultyPlan: DifficultyLevel[]
  errorMessage?: string
  score?: QuizScore
  startedAt: number
  finishedAt?: number
  /** Prompt version that generated the questions. */
  promptVersion: string
}