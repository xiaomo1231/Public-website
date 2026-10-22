import { create } from 'zustand'
import {
  DEFAULT_POMODORO,
  advanceTimer,
  applySettings,
  elapsedAt,
  initialTimer,
  pauseTimer,
  readStoredTimer,
  startTimer,
  tickTimer,
  type PhaseEnd,
  type PomodoroSettings,
  type PomodoroTimer,
} from '@/entities/focus/pomodoro'
import type { FocusKind } from '@/entities/focus/types'
import { FocusService } from '@/services/focusService'
import { logger } from '@/infrastructure/logger/logger'

/**
 * The running timer is per-tab UI state kept in **sessionStorage**: it
 * survives route changes and reloads of this tab (time is recomputed from the
 * wall clock), but a second tab starts its own timer and closing the tab
 * forgets it. What was studied is never only here: every focus phase is
 * written to IndexedDB (`focusSessions`) when it starts and checkpointed while
 * it runs. Settings live on the UserProfile.
 */
export const POMODORO_SESSION_KEY = 'ai-learning:pomodoro'

/** While a focus phase runs, its record is checkpointed this often. */
export const CHECKPOINT_MS = 60_000

export interface FocusContext {
  projectId?: string
  kind: FocusKind
  route: string
}

export interface PomodoroAlert {
  ended: PhaseEnd
  next: PomodoroTimer
}

interface PomodoroState {
  timer: PomodoroTimer
  settings: PomodoroSettings
  /** Last wall clock seen by the ticker (drives the countdown display). */
  now: number
  context: FocusContext
  examActive: boolean
  start: (now?: number) => void
  pause: (now?: number) => void
  skip: (now?: number) => void
  reset: (now?: number) => void
  tick: (now?: number) => void
  setSettings: (settings: PomodoroSettings) => void
  setContext: (context: FocusContext) => void
  setExamActive: (active: boolean, now?: number) => void
}

type AlertListener = (alert: PomodoroAlert) => void
const alertListeners = new Set<AlertListener>()

/** Called when a phase reaches zero (never while an exam is on screen). */
export function onPomodoroAlert(listener: AlertListener): () => void {
  alertListeners.add(listener)
  return () => alertListeners.delete(listener)
}

let focusService: FocusService | null = null
function service(): FocusService {
  focusService ??= new FocusService()
  return focusService
}
export function setFocusServiceForTesting(next: FocusService | null): void {
  focusService = next
}

function record(action: string, work: (svc: FocusService) => Promise<unknown>): void {
  let svc: FocusService
  try {
    svc = service()
  } catch (err) {
    logger.warn('Focus record unavailable', { action, error: String(err) })
    return
  }
  void work(svc).catch((err: unknown) => {
    logger.warn('Saving a focus record failed', { action, error: String(err) })
  })
}

function readSession(): PomodoroTimer | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(POMODORO_SESSION_KEY)
    return raw ? readStoredTimer(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeSession(timer: PomodoroTimer): void {
  try {
    globalThis.sessionStorage?.setItem(POMODORO_SESSION_KEY, JSON.stringify(timer))
  } catch {
    // Storage blocked or full: the timer still works for this page view.
  }
}

let lastCheckpointAt = 0

/** Close the record of the current focus phase early (skip / reset). */
function closeEarly(timer: PomodoroTimer, now: number): void {
  if (timer.phase !== 'focus' || !timer.sessionId) return
  const id = timer.sessionId
  const focusedMs = elapsedAt(timer, now)
  record('close', (svc) => svc.finish(id, { focusedMs, endedAt: now, completed: false }))
}

export const usePomodoroStore = create<PomodoroState>((set, get) => {
  const settings = DEFAULT_POMODORO
  const commit = (timer: PomodoroTimer, extra: Partial<PomodoroState> = {}) => {
    writeSession(timer)
    set({ timer, ...extra })
  }
  return {
    timer: readSession() ?? initialTimer(settings),
    settings,
    now: Date.now(),
    context: { kind: 'other', route: '/' },
    examActive: false,

    start(now = Date.now()) {
      const { timer, context, examActive } = get()
      if (examActive || timer.status === 'running') return
      let next = startTimer(timer, now)
      if (next.phase === 'focus' && !next.sessionId) {
        const id = crypto.randomUUID()
        next = { ...next, sessionId: id }
        const plannedMs = next.durationMs
        record('start', (svc) =>
          svc.start({
            id,
            startedAt: now,
            plannedMs,
            kind: context.kind,
            route: context.route,
            ...(context.projectId ? { projectId: context.projectId } : {}),
          }),
        )
      }
      lastCheckpointAt = now
      commit(next, { now })
    },

    pause(now = Date.now()) {
      const { timer } = get()
      if (timer.status !== 'running') return
      const next = pauseTimer(timer, now)
      if (next.phase === 'focus' && next.sessionId) {
        const id = next.sessionId
        const focusedMs = next.elapsedMs
        record('pause', (svc) => svc.checkpoint(id, focusedMs, now))
      }
      commit(next, { now })
    },

    skip(now = Date.now()) {
      const { timer, settings: current } = get()
      closeEarly(timer, now)
      commit(advanceTimer(timer, current), { now })
    },

    reset(now = Date.now()) {
      const { timer, settings: current } = get()
      closeEarly(timer, now)
      commit(initialTimer(current), { now })
    },

    tick(now = Date.now()) {
      const { timer, settings: current, examActive } = get()
      if (timer.status !== 'running') return
      const result = tickTimer(timer, current, now)
      if (!result) {
        if (timer.phase === 'focus' && timer.sessionId && now - lastCheckpointAt >= CHECKPOINT_MS) {
          lastCheckpointAt = now
          const id = timer.sessionId
          const focusedMs = elapsedAt(timer, now)
          record('checkpoint', (svc) => svc.checkpoint(id, focusedMs, now))
        }
        set({ now })
        return
      }
      const { ended } = result
      if (ended.phase === 'focus' && ended.sessionId) {
        const id = ended.sessionId
        record('finish', (svc) =>
          svc.finish(id, { focusedMs: ended.elapsedMs, endedAt: ended.endedAt, completed: true }),
        )
      }
      commit(result.timer, { now })
      if (!examActive) {
        for (const listener of alertListeners) listener({ ended, next: result.timer })
      }
    },

    setSettings(next) {
      const { timer, settings: previous } = get()
      if (JSON.stringify(previous) === JSON.stringify(next)) return
      const updated = applySettings(timer, previous, next)
      if (updated !== timer) writeSession(updated)
      set({ settings: next, timer: updated })
    },

    setContext(context) {
      const current = get().context
      if (
        current.route === context.route &&
        current.kind === context.kind &&
        current.projectId === context.projectId
      ) {
        return
      }
      set({ context })
    },

    setExamActive(active, now = Date.now()) {
      if (get().examActive === active) return
      if (active && get().timer.status === 'running') {
        // Auto-pause: an exam is never timed by the pomodoro, and nothing may
        // pop up over it. The student resumes after leaving the exam.
        const timer = get().timer
        const next = pauseTimer(timer, now, true)
        if (next.phase === 'focus' && next.sessionId) {
          const id = next.sessionId
          const focusedMs = next.elapsedMs
          record('auto-pause', (svc) => svc.checkpoint(id, focusedMs, now))
        }
        commit(next, { now, examActive: true })
        return
      }
      set({ examActive: active })
    },
  }
})

/** Test helper: back to an idle timer with default settings. */
export function resetPomodoroForTesting(): void {
  try {
    globalThis.sessionStorage?.removeItem(POMODORO_SESSION_KEY)
  } catch {
    // ignore
  }
  lastCheckpointAt = 0
  alertListeners.clear()
  usePomodoroStore.setState({
    timer: initialTimer(DEFAULT_POMODORO),
    settings: DEFAULT_POMODORO,
    now: Date.now(),
    context: { kind: 'other', route: '/' },
    examActive: false,
  })
}

/** Test helper: re-read the timer from sessionStorage, as a reload would. */
export function reloadPomodoroFromSessionForTesting(): void {
  usePomodoroStore.setState({ timer: readSession() ?? initialTimer(DEFAULT_POMODORO) })
}
