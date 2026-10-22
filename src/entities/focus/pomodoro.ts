/**
 * Pomodoro timer: settings and a pure, wall-clock based state machine.
 *
 * Time is never accumulated from ticks. A running phase stores when it was
 * (re)started (`runStartedAt`) plus what had already elapsed before
 * (`elapsedMs`), so the remaining time is always computed from `Date.now()`:
 * a reload, a background tab or a sleeping laptop cannot make it drift.
 */

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak'
export type PomodoroStatus = 'idle' | 'running' | 'paused'

export interface PomodoroSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  /** A long break replaces the short one after every N focus phases. */
  longBreakEvery: number
  /** Short beep at the end of a phase (Web Audio). Off by default. */
  sound: boolean
  /** Dim the page while a break runs. Off by default. */
  dimBreaks: boolean
  /** Show the timer at the left edge. On by default. */
  visible: boolean
}

export const DEFAULT_POMODORO: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  sound: false,
  dimBreaks: false,
  visible: true,
}

/** Allowed ranges for the minute fields and the long-break cycle. */
export const POMODORO_LIMITS = {
  focusMinutes: [1, 180],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 120],
  longBreakEvery: [2, 12],
} as const satisfies Record<string, readonly [number, number]>

function clampInt(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/** Stored (possibly partial or out-of-range) settings → complete, clamped settings. */
export function normalizePomodoroSettings(
  input?: Partial<PomodoroSettings> | null,
): PomodoroSettings {
  const s = input ?? {}
  return {
    focusMinutes: clampInt(s.focusMinutes, POMODORO_LIMITS.focusMinutes, 25),
    shortBreakMinutes: clampInt(s.shortBreakMinutes, POMODORO_LIMITS.shortBreakMinutes, 5),
    longBreakMinutes: clampInt(s.longBreakMinutes, POMODORO_LIMITS.longBreakMinutes, 15),
    longBreakEvery: clampInt(s.longBreakEvery, POMODORO_LIMITS.longBreakEvery, 4),
    sound: s.sound === true,
    dimBreaks: s.dimBreaks === true,
    visible: s.visible !== false,
  }
}

export function phaseDurationMs(phase: PomodoroPhase, settings: PomodoroSettings): number {
  const minutes =
    phase === 'focus'
      ? settings.focusMinutes
      : phase === 'shortBreak'
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes
  return minutes * 60_000
}

export interface PomodoroTimer {
  phase: PomodoroPhase
  status: PomodoroStatus
  /** Length of the current phase. */
  durationMs: number
  /** Time elapsed before the current run segment (pauses excluded). */
  elapsedMs: number
  /** Wall clock of the last start / resume; null unless running. */
  runStartedAt: number | null
  /** Wall clock of the phase's first start; null while idle. */
  phaseStartedAt: number | null
  /** Focus phases finished since the last long break. */
  completedFocus: number
  /** The focus record of the current phase (focus phases only). */
  sessionId: string | null
  /** Paused automatically because an exam page opened. */
  autoPaused: boolean
}

export function initialTimer(settings: PomodoroSettings): PomodoroTimer {
  return {
    phase: 'focus',
    status: 'idle',
    durationMs: phaseDurationMs('focus', settings),
    elapsedMs: 0,
    runStartedAt: null,
    phaseStartedAt: null,
    completedFocus: 0,
    sessionId: null,
    autoPaused: false,
  }
}

export function elapsedAt(timer: PomodoroTimer, now: number): number {
  const running =
    timer.status === 'running' && timer.runStartedAt !== null
      ? Math.max(0, now - timer.runStartedAt)
      : 0
  return Math.min(timer.durationMs, timer.elapsedMs + running)
}

export function remainingAt(timer: PomodoroTimer, now: number): number {
  return Math.max(0, timer.durationMs - elapsedAt(timer, now))
}

/** Start an idle phase or resume a paused one. */
export function startTimer(timer: PomodoroTimer, now: number): PomodoroTimer {
  if (timer.status === 'running') return timer
  return {
    ...timer,
    status: 'running',
    runStartedAt: now,
    phaseStartedAt: timer.phaseStartedAt ?? now,
    autoPaused: false,
  }
}

export function pauseTimer(timer: PomodoroTimer, now: number, auto = false): PomodoroTimer {
  if (timer.status !== 'running') return timer
  return {
    ...timer,
    status: 'paused',
    elapsedMs: elapsedAt(timer, now),
    runStartedAt: null,
    autoPaused: auto,
  }
}

/** The phase that follows `phase`, and the focus count after it. */
export function nextPhase(
  phase: PomodoroPhase,
  completedFocus: number,
  longBreakEvery: number,
): { phase: PomodoroPhase; completedFocus: number } {
  if (phase === 'focus') {
    const done = completedFocus + 1
    return done >= longBreakEvery
      ? { phase: 'longBreak', completedFocus: done }
      : { phase: 'shortBreak', completedFocus: done }
  }
  // A long break closes the cycle.
  return { phase: 'focus', completedFocus: phase === 'longBreak' ? 0 : completedFocus }
}

/** Move to the next phase, idle (the student starts it). */
export function advanceTimer(timer: PomodoroTimer, settings: PomodoroSettings): PomodoroTimer {
  const next = nextPhase(timer.phase, timer.completedFocus, settings.longBreakEvery)
  return {
    phase: next.phase,
    status: 'idle',
    durationMs: phaseDurationMs(next.phase, settings),
    elapsedMs: 0,
    runStartedAt: null,
    phaseStartedAt: null,
    completedFocus: next.completedFocus,
    sessionId: null,
    autoPaused: false,
  }
}

export interface PhaseEnd {
  phase: PomodoroPhase
  /** Wall clock when the phase actually reached zero (may be in the past after a reload). */
  endedAt: number
  /** Time counted in the phase. */
  elapsedMs: number
  sessionId: string | null
  phaseStartedAt: number | null
}

/**
 * Check a running timer against the wall clock. When the phase has run out it
 * returns the next (idle) phase and when the finished one ended.
 */
export function tickTimer(
  timer: PomodoroTimer,
  settings: PomodoroSettings,
  now: number,
): { timer: PomodoroTimer; ended: PhaseEnd } | null {
  if (timer.status !== 'running' || timer.runStartedAt === null) return null
  if (elapsedAt(timer, now) < timer.durationMs) return null
  // A length shortened below what had already elapsed ends at the resume.
  const endedAt = timer.runStartedAt + Math.max(0, timer.durationMs - timer.elapsedMs)
  return {
    timer: advanceTimer(timer, settings),
    ended: {
      phase: timer.phase,
      endedAt,
      elapsedMs: timer.durationMs,
      sessionId: timer.sessionId,
      phaseStartedAt: timer.phaseStartedAt,
    },
  }
}

/**
 * Settings changed: an idle phase takes the new length at once; a running or
 * paused phase also does when its own length changed (the tick then ends it
 * if the new length has already passed).
 */
export function applySettings(
  timer: PomodoroTimer,
  previous: PomodoroSettings,
  settings: PomodoroSettings,
): PomodoroTimer {
  const before = phaseDurationMs(timer.phase, previous)
  const after = phaseDurationMs(timer.phase, settings)
  if (timer.status === 'idle' || before !== after) return { ...timer, durationMs: after }
  return timer
}

/** `mm:ss`, or `h:mm:ss` from an hour up. Rounds up so 0:00 means done. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Restore a stored timer, or null when the value is not a timer. */
export function readStoredTimer(value: unknown): PomodoroTimer | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<PomodoroTimer>
  const phases: PomodoroPhase[] = ['focus', 'shortBreak', 'longBreak']
  const statuses: PomodoroStatus[] = ['idle', 'running', 'paused']
  if (!phases.includes(v.phase as PomodoroPhase)) return null
  if (!statuses.includes(v.status as PomodoroStatus)) return null
  const num = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null
  const durationMs = num(v.durationMs)
  const elapsedMs = num(v.elapsedMs)
  if (durationMs === null || durationMs <= 0 || elapsedMs === null) return null
  const runStartedAt = num(v.runStartedAt)
  if (v.status === 'running' && runStartedAt === null) return null
  return {
    phase: v.phase as PomodoroPhase,
    status: v.status as PomodoroStatus,
    durationMs,
    elapsedMs: Math.min(elapsedMs, durationMs),
    runStartedAt: v.status === 'running' ? runStartedAt : null,
    phaseStartedAt: num(v.phaseStartedAt),
    completedFocus: Math.floor(num(v.completedFocus) ?? 0),
    sessionId: typeof v.sessionId === 'string' ? v.sessionId : null,
    autoPaused: v.autoPaused === true,
  }
}
