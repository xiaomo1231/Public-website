import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { QuestionType } from '@/entities/question/types'
import type { TranslationKey } from '@/i18n/types'
import type { QuestionLanguage } from '../user/types'

export type QuizDifficulty = 'adaptive' | DifficultyLevel

export interface QuizConfig {
  topicId?: string
  topicName?: string
  /**
   *  topic      — a single topic
   *  mixed      — everything in the project
   *  weakness   — aggregated weak knowledge points
   *  review     — a review session built from recent mistakes
   *  oral       — oral-exam rehearsal: `count` topics (1–5) drawn at random
   *               from the exam scope / the topic / the course, each one main
   *               question with follow-ups (see `OralQuestionInfo`)
   */
  mode: 'topic' | 'mixed' | 'weakness' | 'review' | 'oral'
  count: number
  /** Oral mode only: the answer countdown per drawn topic. */
  oral?: OralExamSettings
  difficulty: QuizDifficulty
  types: QuestionType[]
  /** Restrict retrieval to a textbook chapter/section (course structure). */
  chapterId?: string
  sectionId?: string
  /** Explicit knowledge points to focus on (review sessions, practice-this-mistake). */
  focusKnowledgePoints?: string[]
  /** When set, the session was launched from a specific mistake. */
  sourceMistakeId?: string
  /** Language of the questions; absent uses the student's saved preference. */
  questionLanguage?: QuestionLanguage
  /**
   * A quiz over an exam scope of the course syllabus, or one exam topic of it.
   * Exam topics matched to course topics are quizzed from those topics'
   * sources; unmatched ones only with `includeUnmatched`, and their questions
   * have no course source (labelled as AI-generated).
   */
  examScope?: ExamScopeSelection
}

export interface OralExamSettings {
  /** Seconds for the main answer; absent = no countdown. */
  timerSeconds?: number
}

/** Topics drawn per oral rehearsal, and the default countdown. */
export const ORAL_MAX_TOPICS = 5
export const ORAL_DEFAULT_TIMER_SECONDS = 180

export interface ExamScopeSelection {
  /** The syllabus document. */
  documentId: string
  scopeId: string
  /** One exam topic of the scope; absent = the whole scope. */
  examTopicId?: string
  includeUnmatched: boolean
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
  /**
   * Graded credit: one per correct answer plus partial credit for short
   * answers (3 of 5 points → 0.6). Absent on scores saved before short answers.
   */
  points?: number
  /** Share of graded credit over graded questions, as a percentage. */
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
