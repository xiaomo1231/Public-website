export type EvaluationMethod =
  | 'exact'
  | 'case_insensitive'
  | 'numeric'
  | 'numeric_tolerance'
  | 'math_equivalent'
  | 'option_id'
  | 'ai'
  | 'unverified'

export interface QuestionEvaluation {
  /** null when the answer could not be verified automatically. */
  isCorrect: boolean | null
  method: EvaluationMethod
  /** 0–1 confidence in the verdict. */
  confidence: number
  expected?: string
  normalizedUser?: string
  normalizedExpected?: string
  explanation?: string
  /** Human-readable note, e.g. "Unable to verify automatically". */
  note?: string
}

export interface QuestionAttempt {
  id: string
  projectId: string
  questionId: string
  quizId?: string
  topicId?: string
  knowledgePoint: string
  questionType: string
  difficulty: string
  userAnswer: string
  evaluation: QuestionEvaluation
  durationMs?: number
  hintsUsed: number
  createdAt: number
}