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
  /** document-analyzer-family prompt version that produced the questions. */
  promptVersion: string
  createdAt: number
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

export const HOMEWORK_ANALYZER_PROMPT_VERSION = 'v1'
export const HOMEWORK_QUESTION_PROMPT_VERSION = 'v1'
export const HOMEWORK_QA_PROMPT_VERSION = 'v1'
