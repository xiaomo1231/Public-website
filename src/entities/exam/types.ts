import type { AnswerVerdict } from '@/entities/homework/answerCheck'
import type { AnswerTranscript } from '@/entities/handwriting/types'
import type { AiMockInfo } from './mockPaper'

/**
 * 往年试卷 / 模拟卷: a past paper is recognised like an assignment and stored as
 * a `HomeworkSet` with `kind: 'exam'` (no new table). `HomeworkSet.exam` holds
 * the mock-exam settings and attempts; the questions are ordinary
 * `HomeworkQuestion` rows in paper order.
 */

/** One question's result in a submitted mock exam. */
export interface MockExamQuestionResult {
  questionId: string
  /**
   * `checked`    — a verdict exists (local or AI).
   * `unanswered` — nothing was written (no marks estimated, counts as 0).
   * `uncertain`  — the check could not decide, or no reference answer exists.
   * `failed`     — the check request failed; 继续检查 retries it.
   */
  status: 'checked' | 'unanswered' | 'uncertain' | 'failed'
  verdict?: AnswerVerdict
  method?: 'local' | 'ai'
  /** Share of the question judged right (1 / partial estimate / 0). */
  fraction?: number
  /** Marks available as printed on the paper (sum of its parts), when stated. */
  marks?: number
  /** Platform-estimated marks earned (`marks × fraction`). Never the teacher's marks. */
  estimatedMarks?: number
  /** Short note: why uncertain / failed, or the check's feedback. */
  note?: string
}

export interface MockExamAttempt {
  id: string
  startedAt: number
  durationMinutes: number
  /** Deadline (`startedAt + durationMinutes`). */
  endsAt: number
  /** Answers by question id, saved while writing. */
  answers: Record<string, string>
  submittedAt?: number
  /** Submitted automatically because the time ran out. */
  timedOut?: boolean
  /** Filled in while / after checking (one per question, paper order). */
  results?: MockExamQuestionResult[]
  /** All questions have a result (checking can be stopped and continued). */
  checkedAt?: number
  /**
   * How the paper is answered, chosen at the start (absent on attempts from
   * before the choice existed = `online`). See `ExamAnswerMode`.
   */
  mode?: ExamAnswerMode
  /**
   * 纸上作答: the student said all page photos are uploaded and assigned
   * (recognition starts then; no more uploads).
   */
  uploadsDoneAt?: number
  /**
   * Transcripts of the handwritten answers, by question id. Made only after
   * submitting; graded only once confirmed by the student.
   */
  transcripts?: Record<string, AnswerTranscript>
  /** The exact text that was graded per question (typed + confirmed transcript). */
  gradedAnswers?: Record<string, string>
}

/**
 * - `online` — 在网站上作答: type the answers (handwritten pages may be added).
 * - `paper`  — 只看题目 / 打印: write on paper, then photograph the pages and
 *              assign each region to its question.
 * - `tablet` — 平板手写: write with a pen in a writing area under each question.
 *
 * Whatever the mode, handwriting is recognised only after submitting, shown
 * next to the original, and graded only as the text the student confirms.
 */
export type ExamAnswerMode = 'online' | 'paper' | 'tablet'
export const EXAM_ANSWER_MODES: readonly ExamAnswerMode[] = ['online', 'paper', 'tablet']

export interface ExamSetInfo {
  /** Duration the student chose (minutes). */
  durationMinutes?: number
  /** Total time read from the paper ("Time allowed: 2 hours"), when found. */
  detectedMinutes?: number
  /** The attempt being written or checked. */
  current?: MockExamAttempt
  /** Finished attempts, newest first (capped). */
  attempts?: MockExamAttempt[]
  /**
   * `ai_mock` — an AI 模拟卷 written by the platform in the style of a past
   * paper (`aiMock` holds how). Absent = an uploaded past paper.
   */
  origin?: 'ai_mock'
  /** AI 模拟卷: settings, per-question build state and the structure report. */
  aiMock?: AiMockInfo
}

export const MAX_EXAM_ATTEMPTS = 10
/** Used when the paper states no time and the student set none. */
export const DEFAULT_EXAM_MINUTES = 60
