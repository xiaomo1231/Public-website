import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_POMODORO,
  advanceTimer,
  applySettings,
  elapsedAt,
  formatClock,
  initialTimer,
  nextPhase,
  normalizePomodoroSettings,
  pauseTimer,
  readStoredTimer,
  remainingAt,
  startTimer,
  tickTimer,
  type PomodoroTimer,
} from '@/entities/focus/pomodoro'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { FocusService, lastDaysRange, localDayKey } from '@/services/focusService'
import {
  POMODORO_SESSION_KEY,
  reloadPomodoroFromSessionForTesting,
  resetPomodoroForTesting,
  setFocusServiceForTesting,
  usePomodoroStore,
} from '@/features/focus/pomodoroStore'
import { focusContextOf, focusRouteOf, isExamPath, isFocusPath } from '@/features/focus/focusRoutes'
import { DataManagementService, EXPORTED_TABLES } from '@/services/dataManagementService'
import { ProjectService } from '@/services/projectService'

const MIN = 60_000
const S = DEFAULT_POMODORO

describe('pomodoro timer (pure, wall clock)', () => {
  it('counts from the wall clock, so a reload resumes with the right remaining time', () => {
    let timer = startTimer(initialTimer(S), 1_000)
    expect(remainingAt(timer, 1_000)).toBe(25 * MIN)
    // Stored and read back (as sessionStorage does across a reload)…
    const restored = readStoredTimer(JSON.parse(JSON.stringify(timer))) as PomodoroTimer
    // …10 minutes later the remaining time is 15 minutes, with no ticks in between.
    expect(remainingAt(restored, 1_000 + 10 * MIN)).toBe(15 * MIN)
    timer = pauseTimer(restored, 1_000 + 10 * MIN)
    // Paused time does not count.
    expect(remainingAt(timer, 1_000 + 60 * MIN)).toBe(15 * MIN)
    timer = startTimer(timer, 1_000 + 60 * MIN)
    expect(elapsedAt(timer, 1_000 + 65 * MIN)).toBe(15 * MIN)
  })

  it('ends a phase at the exact wall-clock moment, even when found late after a reload', () => {
    const timer = startTimer(initialTimer(S), 0)
    expect(tickTimer(timer, S, 24 * MIN)).toBeNull()
    const result = tickTimer(timer, S, 40 * MIN)
    expect(result?.ended).toMatchObject({ phase: 'focus', endedAt: 25 * MIN, elapsedMs: 25 * MIN })
    expect(result?.timer).toMatchObject({ phase: 'shortBreak', status: 'idle', completedFocus: 1 })
    expect(result?.timer.durationMs).toBe(5 * MIN)
  })

  it('takes a long break after every 4 focus phases, then starts a new cycle', () => {
    const phases: string[] = []
    let timer = initialTimer(S)
    for (let i = 0; i < 10; i += 1) {
      timer = advanceTimer(timer, S)
      phases.push(timer.phase)
    }
    expect(phases).toEqual([
      'shortBreak',
      'focus',
      'shortBreak',
      'focus',
      'shortBreak',
      'focus',
      'longBreak',
      'focus',
      'shortBreak',
      'focus',
    ])
    expect(nextPhase('focus', 2, 3)).toEqual({ phase: 'longBreak', completedFocus: 3 })
    expect(nextPhase('longBreak', 3, 3)).toEqual({ phase: 'focus', completedFocus: 0 })
  })

  it('normalizes settings and applies new lengths to the current phase', () => {
    expect(normalizePomodoroSettings({ focusMinutes: 0, longBreakEvery: 99 })).toMatchObject({
      focusMinutes: 1,
      longBreakEvery: 12,
      shortBreakMinutes: 5,
      sound: false,
      dimBreaks: false,
      visible: true,
    })
    const running = startTimer(initialTimer(S), 0)
    const longer = applySettings(running, S, { ...S, focusMinutes: 50 })
    expect(longer.durationMs).toBe(50 * MIN)
    // A change to another phase's length leaves a running phase alone.
    expect(applySettings(running, S, { ...S, shortBreakMinutes: 10 })).toBe(running)
    expect(formatClock(25 * MIN)).toBe('25:00')
    expect(formatClock(61 * MIN + 1)).toBe('1:01:01')
  })

  it('rejects stored values that are not a timer', () => {
    expect(readStoredTimer(null)).toBeNull()
    expect(
      readStoredTimer({ phase: 'nap', status: 'idle', durationMs: 1, elapsedMs: 0 }),
    ).toBeNull()
    expect(
      readStoredTimer({ phase: 'focus', status: 'running', durationMs: 1000, elapsedMs: 0 }),
    ).toBeNull()
  })
})

describe('focus routes', () => {
  it('knows the focus pages and the exam pages', () => {
    expect(isFocusPath('/projects/p1/homework/s1')).toBe(true)
    expect(isFocusPath('/projects/p1/homework/exam-analysis')).toBe(false)
    expect(isFocusPath('/projects/p1/homework')).toBe(false)
    expect(isFocusPath('/projects/p1/quiz/q1')).toBe(true)
    expect(isFocusPath('/projects/p1/quiz/q1/result')).toBe(false)
    expect(isFocusPath('/projects/p1/tutor/t1')).toBe(true)
    expect(isFocusPath('/projects/p1/tutor')).toBe(false)
    expect(focusRouteOf('/projects/p1/tutor/t1/interactive')?.kind).toBe('interactive_tutor')
    expect(isFocusPath('/projects/p1/interview/x')).toBe(true)
    expect(isExamPath('/projects/p1/homework/s1/exam')).toBe(true)
    expect(isExamPath('/projects/p1/homework/s1')).toBe(false)
    expect(focusContextOf('/projects/p1/mistakes')).toEqual({
      projectId: 'p1',
      kind: 'course',
      route: '/projects/p1/mistakes',
    })
    expect(focusContextOf('/vocab')).toEqual({ kind: 'other', route: '/vocab' })
  })
})

describe('focus records', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    setFocusServiceForTesting(new FocusService(db))
    resetPomodoroForTesting()
  })

  afterEach(() => {
    setFocusServiceForTesting(null)
    resetPomodoroForTesting()
  })

  async function settle(): Promise<void> {
    // Records are written fire-and-forget; let the IndexedDB writes finish.
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0))
  }

  it('saves a completed focus phase with its course, and totals it by day and course', async () => {
    const t0 = new Date(2026, 9, 20, 9, 0).getTime()
    const store = usePomodoroStore.getState()
    store.setContext({ projectId: 'p1', kind: 'homework', route: '/projects/p1/homework/s1' })
    store.start(t0)
    await settle()
    usePomodoroStore.getState().tick(t0 + 26 * MIN)
    await settle()

    const rows = await db.table('focusSessions').toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      projectId: 'p1',
      kind: 'homework',
      completed: true,
      focusedMs: 25 * MIN,
      plannedMs: 25 * MIN,
      startedAt: t0,
      endedAt: t0 + 25 * MIN,
    })
    expect(usePomodoroStore.getState().timer.phase).toBe('shortBreak')

    // A partial, global phase (outside any course), skipped after 10 minutes.
    const t1 = new Date(2026, 9, 21, 20, 0).getTime()
    usePomodoroStore.getState().skip(t1) // skip the break
    usePomodoroStore.getState().setContext({ kind: 'other', route: '/vocab' })
    usePomodoroStore.getState().start(t1)
    await settle()
    usePomodoroStore.getState().skip(t1 + 10 * MIN)
    await settle()

    const service = new FocusService(db)
    const range = lastDaysRange(14, new Date(2026, 9, 21, 23, 0).getTime())
    const days = await service.listByDay(range)
    expect(days).toHaveLength(14)
    expect(days.find((d) => d.day === localDayKey(t0))).toMatchObject({
      focusedMs: 25 * MIN,
      sessions: 1,
    })
    expect(days.find((d) => d.day === localDayKey(t1))?.focusedMs).toBe(10 * MIN)
    expect(await service.totalsByCourse(range)).toEqual([
      { projectId: 'p1', focusedMs: 25 * MIN, sessions: 1 },
      { projectId: null, focusedMs: 10 * MIN, sessions: 1 },
    ])
    const partial = (await db.table('focusSessions').toArray()).find((r) => !r.projectId)
    expect(partial).toMatchObject({ completed: false, kind: 'other' })
  })

  it('checkpoints a running phase and drops one reset within a second', async () => {
    const store = usePomodoroStore.getState()
    store.start(0)
    await settle()
    usePomodoroStore.getState().tick(2 * MIN)
    await settle()
    const [row] = await db.table('focusSessions').toArray()
    expect(row.focusedMs).toBe(2 * MIN)
    expect(row.completed).toBe(false)

    usePomodoroStore.getState().reset(2 * MIN)
    usePomodoroStore.getState().start(3 * MIN)
    await settle()
    usePomodoroStore.getState().reset(3 * MIN + 500)
    await settle()
    // The 2-minute phase stays (closed early); the half-second one is dropped.
    const rows = await db.table('focusSessions').toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].focusedMs).toBe(2 * MIN)
  })

  it('keeps a running timer across a reload through sessionStorage', () => {
    usePomodoroStore.getState().start(Date.now() - 5 * MIN)
    expect(sessionStorage.getItem(POMODORO_SESSION_KEY)).toContain('"running"')
    usePomodoroStore.setState({ timer: initialTimer(S) })
    reloadPomodoroFromSessionForTesting()
    const { timer } = usePomodoroStore.getState()
    expect(timer.status).toBe('running')
    expect(Math.round(remainingAt(timer, Date.now()) / MIN)).toBe(20)
  })

  it('auto-pauses when an exam opens and starts nothing while it is open', () => {
    usePomodoroStore.getState().start(0)
    usePomodoroStore.getState().setExamActive(true, 4 * MIN)
    const paused = usePomodoroStore.getState().timer
    expect(paused).toMatchObject({ status: 'paused', autoPaused: true, elapsedMs: 4 * MIN })
    usePomodoroStore.getState().start(5 * MIN)
    expect(usePomodoroStore.getState().timer.status).toBe('paused')
    usePomodoroStore.getState().setExamActive(false)
    usePomodoroStore.getState().start(30 * MIN)
    expect(usePomodoroStore.getState().timer).toMatchObject({
      status: 'running',
      autoPaused: false,
    })
  })

  it('is exported and deleted with its course; time outside a course is kept', async () => {
    expect(EXPORTED_TABLES).toContain('focusSessions')
    const projects = new ProjectService(db)
    const doomed = await projects.create({ name: 'Doomed', subject: 'cs' })
    const service = new FocusService(db)
    await service.start({
      startedAt: 1,
      plannedMs: MIN,
      projectId: doomed.id,
      kind: 'quiz',
      route: '/',
    })
    const global = await service.start({ startedAt: 2, plannedMs: MIN, kind: 'other', route: '/' })
    await new DataManagementService(db).deleteProject(doomed.id)
    const left = await db.table('focusSessions').toArray()
    expect(left.some((r) => r.projectId === doomed.id)).toBe(false)
    expect(left.map((r) => r.id)).toContain(global.id)
  })
})
