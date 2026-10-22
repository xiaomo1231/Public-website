import type { AnswerVerdict } from '@/entities/homework/answerCheck'

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
}

export interface ExamSetInfo {
  /** Duration the student chose (minutes). */
  durationMinutes?: number
  /** Total time read from the paper ("Time allowed: 2 hours"), when found. */
  detectedMinutes?: number
  /** The attempt being written or checked. */
  current?: MockExamAttempt
  /** Finished attempts, newest first (capped). */
  attempts?: MockExamAttempt[]
}

export const MAX_EXAM_ATTEMPTS = 10
/** Used when the paper states no time and the student set none. */
export const DEFAULT_EXAM_MINUTES = 60
