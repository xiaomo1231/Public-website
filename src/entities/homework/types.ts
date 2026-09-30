import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { TranslationKey } from '@/i18n/types'

/**
 * A student-uploaded homework assignment that the AI has turned into questions.
 *
 * This is a *separate* small domain from Professor Practice: Practice grades
 * against a professor answer key, while homework has no key — the AI provides
 * progressive hints and a worked solution the student reveals on demand. Both
 * reuse the same uploader, chunk model, source-reference grounding and AI
 * provider; neither duplicates the other.
 */
export interface HomeworkSet {
  id: string
  projectId: string
  documentId: string
  documentName: string
  title: string
  status: HomeworkStatus
  language: 'zh' | 'en' | 'mixed'
  questionCount: number
  /** Actionable reason when the whole set could not be analysed. */
  errorMessage?: string
  /**
   * Set when a re-analysis produced usable questions but could not read every
   * range (a batch failed or the document exceeded the batch cap). Lets the UI
   * say "recognized X, Y ranges unfinished" instead of a silent success.
   */
  analysisNote?: string
  /** document-analyzer-family prompt version that produced the questions. */
  promptVersion: string
  /**
   * The professor's answer document linked to this assignment, when one was
   * uploaded. Points at a real `Document` (`materialType: 'homework_answer'`)
   * in the same project — the association never copies the file. Optional, so
   * assignments created before answer keys existed stay valid.
   */
  answerDocumentId?: string
  /**
   * Live progress while the set is `analyzing`, so a card can show which stage
   * is running and how far it has got. Cleared when the run reaches a terminal
   * state (`ready` / `failed`). Optional, so rows written before it stay valid.
   */
  progress?: HomeworkProgress
  createdAt: number
  updatedAt: number
}

/**
 * Progress of an in-flight homework run.
 *
 * `completed` counts real finished work units (batches while identifying,
 * questions while generating); `total` is their known planned count, or
 * `undefined` when it is not yet known (the UI then shows an indeterminate
 * bar). Percentages are only ever computed from these counters — never from a
 * timer.
 */
export interface HomeworkProgress {
  stage: 'identifying' | 'generating'
  completed: number
  total?: number
  updatedAt: number
}

/**
 * `analyzing` — the upload finished and the AI run is in progress.
 * `ready`     — at least one question was extracted (per-question content may
 *               still have its own status).
 * `failed`    — nothing usable was extracted; `errorMessage` explains why.
 */
export type HomeworkStatus = 'analyzing' | 'ready' | 'failed'

export const HOMEWORK_STATUS_LABEL_KEYS: Record<HomeworkStatus, TranslationKey> = {
  analyzing: 'homework.status.analyzing',
  ready: 'homework.status.ready',
  failed: 'homework.status.failed',
}

/**
 * Per-question generation state for the hints + solution. `ready` means both
 * are present and validated; `failed` keeps the question visible with a retry.
 */
export type HomeworkQuestionStatus = 'pending' | 'ready' | 'failed'

/**
 * How a homework question relates to the linked professor answer.
 * `needs_review` answers are shown for checking but never used to generate.
 */
export type HomeworkQuestionAnswerStatus = 'matched' | 'needs_review'

/** One turn of the per-question help conversation. */
export interface HomeworkMessage {
  id: string
  role: 'student' | 'assistant'
  content: string
  createdAt: number
}

export interface HomeworkQuestion {
  id: string
  projectId: string
  setId: string
  documentId: string
  documentName: string
  order: number
  /** Printed number from the assignment, when one was recognised. */
  number?: string
  prompt: string
  /** Grounded in real document chunks only — never invented by the model. */
  sourceRefs: SourceReference[]
  /** Progressive hints, shown one at a time. Never reveal the final answer. */
  hints: string[]
  /** Complete worked solution, revealed only when the student asks for it. */
  solution?: string
  generationStatus: HomeworkQuestionStatus
  /** Actionable reason when this question's hints/solution failed. */
  generationError?: string
  /** Prompt version that produced the hints + solution. */
  promptVersion: string
  /** Fingerprint of the prompt + grounding, used to match across a re-analysis. */
  contentFingerprint?: string
  /**
   * True when a re-analysis no longer found this question. The row — and the
   * student's draft, hints and conversation — is kept so it can be viewed,
   * restored or explicitly deleted. Never silently removed.
   */
  retired?: boolean
  retiredAt?: number
  /**
   * The professor's answer assigned to THIS question, verbatim from the linked
   * answer document. Absent when no answer is linked. Never taken from the
   * model, and only ever set after a one-to-one confirmation.
   */
  answerText?: string
  /** The printed answer number it was matched from. */
  answerNumber?: string
  /** Real chunks of the answer document this answer text came from. */
  answerChunkIds?: string[]
  /**
   * `matched` — a single, unambiguous answer was confirmed for this question.
   * `needs_review` — an answer number was seen but the mapping is ambiguous or
   *   was not confirmed; the answer is NOT used for generation.
   * Absent means no answer is linked to this question.
   */
  answerStatus?: HomeworkQuestionAnswerStatus
  /**
   * True when the current hints + solution were generated from the professor
   * answer. Absent/false means they are the ordinary AI walkthrough.
   */
  answerBased?: boolean
  /**
   * The previous AI solution, kept only when it was replaced by an
   * answer-based solution, so the student can still compare instead of having
   * it silently overwritten. Never corrected or relabelled as the professor's.
   */
  previousSolution?: string
  /** Student's saved working. Restored on reload. */
  draftText: string
  /** How many hints the student has revealed (0..hints.length). */
  revealedHints: number
  /** Whether the student has revealed the solution. */
  solutionRevealed: boolean
  messages: HomeworkMessage[]
  createdAt: number
  updatedAt: number
}

/**
 * What changed during a re-analysis. `matched` questions kept their AI content;
 * `regenerated` questions were matched but had their content updated (records
 * preserved); `added` are new; `restored` are previously retired questions that
 * matched again and were brought back with their records; `retired` are old
 * questions kept aside because they no longer matched; `failed` could not
 * generate content.
 */
export interface ReanalysisSummary {
  matched: number
  regenerated: number
  added: number
  restored: number
  retired: number
  failed: number
}

export const EMPTY_REANALYSIS_SUMMARY: ReanalysisSummary = {
  matched: 0,
  regenerated: 0,
  added: 0,
  restored: 0,
  retired: 0,
  failed: 0,
}

/** Cap on stored chat turns per question (keeps the row bounded). */
export const HOMEWORK_MESSAGE_LIMIT = 40

/** Cap on hints returned/accepted per question. */
export const HOMEWORK_MAX_HINTS = 4

export const HOMEWORK_ANALYZER_PROMPT_VERSION = 'v2'
export const HOMEWORK_QUESTION_PROMPT_VERSION = 'v3'
export const HOMEWORK_QA_PROMPT_VERSION = 'v1'
