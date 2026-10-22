/**
 * Where a focus phase was spent: the kind of page the student was on when the
 * phase started. `course` is any other course page, `other` anything outside a
 * course (dashboard, vocabulary, settings…).
 */
export type FocusKind =
  | 'homework'
  | 'mock_exam'
  | 'quiz'
  | 'tutor'
  | 'interactive_tutor'
  | 'interview'
  | 'course'
  | 'other'

/**
 * One focus phase of the pomodoro timer (Dexie v20 `focusSessions`).
 *
 * The row is written when the phase starts (`focusedMs: 0`), checkpointed
 * while it runs (about once a minute and on every pause), and closed when it
 * ends, is skipped or reset. A tab closed mid-phase therefore keeps the time
 * up to the last checkpoint. `projectId` is the course the student was in when
 * the phase started; absent for time spent outside a course (kept when a
 * course is deleted only if it has no `projectId`).
 */
export interface FocusSession {
  id: string
  projectId?: string
  startedAt: number
  /** Last checkpoint, or when the phase ended. */
  endedAt: number
  /** The phase length the timer was set to. */
  plannedMs: number
  /** Time actually counted (pauses excluded). */
  focusedMs: number
  kind: FocusKind
  /** The page path when the phase started (no query string). */
  route: string
  /** True only when the phase ran to its end; skipped / reset / open rows are false. */
  completed: boolean
}

/** A half-open time range `[from, to)` in epoch milliseconds. */
export interface FocusRange {
  from: number
  to: number
}

export interface FocusDayTotal {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  /** Start of that local day (epoch ms). */
  start: number
  focusedMs: number
  sessions: number
}

export interface FocusCourseTotal {
  /** `null` for time spent outside a course. */
  projectId: string | null
  focusedMs: number
  sessions: number
}
