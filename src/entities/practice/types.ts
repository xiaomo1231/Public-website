/**
 * Professor Practice: questions imported from material the professor handed
 * out, plus the learner's attempts and the derived question-style profile.
 *
 * This is an *assessment style* source, never a knowledge source. Facts still
 * come from the textbook.
 */

export type PracticeQuestionType =
  | 'single_choice'
  | 'true_false'
  | 'numeric'
  | 'math_expr'
  | 'short_answer'
  | 'unknown'

export type PracticeQuestionStatus = 'verified' | 'needs_review' | 'failed'

/** Where the expected answer came from — never invented. */
export type PracticeAnswerSource = 'professor' | 'ai' | 'textbook' | 'none'

export interface PracticeQuestionOption {
  id: string
  label: string
  isCorrect: boolean
}

export interface PracticeSet {
  id: string
  projectId: string
  documentId: string
  documentName: string
  name: string
  questionCount: number
  /** Fingerprint of the source chunks this set was parsed from. */
  sourceHash: string
  createdAt: number
  updatedAt: number
}

export interface PracticeQuestion {
  id: string
  projectId: string
  setId: string
  documentId: string
  documentName: string
  pageNumber?: number
  chunkId?: string
  /** Document order, so listing is stable. */
  order: number
  /** The number as printed in the document. */
  number?: string
  type: PracticeQuestionType
  prompt: string
  options: PracticeQuestionOption[]
  expectedAnswer?: string
  answerExplanation?: string
  answerSource: PracticeAnswerSource
  /** Preserved figure the question depends on, when there was one. */
  visualSourceId?: string
  difficulty?: string
  topicId?: string
  /** Textbook structure the question maps to, when matching is confident. */
  chapterId?: string
  sectionId?: string
  /** 0–1 extraction confidence; drives review status, not the UI. */
  confidence: number
  status: PracticeQuestionStatus
  createdAt: number
}

export interface PracticeAttempt {
  id: string
  projectId: string
  setId: string
  questionId: string
  userAnswer: string
  isCorrect?: boolean
  method?: 'exact' | 'numeric' | 'symbolic' | 'manual' | 'none'
  attemptNumber: number
  submittedAt: number
}

export type QuestionStyleConfidence = 'very_limited' | 'preliminary' | 'moderate' | 'stronger'

/**
 * Evidence-based description of how the professor writes questions.
 *
 * Every number comes from actually imported questions, and `sampleSize` gates
 * how strongly the UI may phrase it.
 */
export interface ProfessorQuestionStyleProfile {
  sampleSize: number
  confidence: QuestionStyleConfidence
  questionTypeDistribution: Partial<Record<PracticeQuestionType, number>>
  /** How many options the professor tends to offer, keyed by option count. */
  optionCountDistribution: Record<string, number>
  visualQuestionCount: number
  calculationVsConceptual: { calculation: number; conceptual: number; mixed: number }
  wordingPatterns: string[]
  instructionPatterns: string[]
  answerFormatPatterns: string[]
  topicDistribution: Array<{ topicId?: string; topicName?: string; count: number }>
  generatedAt: number
  promptVersion: string
}

export const PRACTICE_STYLE_PROMPT_VERSION = 'v1'

export function styleConfidenceFor(sampleSize: number): QuestionStyleConfidence {
  if (sampleSize >= 30) return 'stronger'
  if (sampleSize >= 11) return 'moderate'
  if (sampleSize >= 4) return 'preliminary'
  return 'very_limited'
}
