import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { FocusSessionRepository } from '@/entities/focus/repository'
import type {
  FocusCourseTotal,
  FocusDayTotal,
  FocusKind,
  FocusRange,
  FocusSession,
} from '@/entities/focus/types'

/** Rows shorter than this when closed early are dropped (an accidental start). */
const MIN_KEPT_MS = 1000

/** `YYYY-MM-DD` of a timestamp in local time. */
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Start of the local day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The last `days` local days ending with the day of `now`, as a range. */
export function lastDaysRange(days: number, now: number = Date.now()): FocusRange {
  const today = startOfLocalDay(now)
  const from = new Date(today)
  from.setDate(from.getDate() - (Math.max(1, days) - 1))
  const to = new Date(today)
  to.setDate(to.getDate() + 1)
  return { from: from.getTime(), to: to.getTime() }
}

export interface StartFocusInput {
  id?: string
  startedAt: number
  plannedMs: number
  projectId?: string
  kind: FocusKind
  route: string
}

/**
 * Focus records of the pomodoro timer, and the totals other features read
 * (study plan: today's studied time; settings: 学习时长).
 *
 * A session is counted on the local day (and in the range) its phase
 * **started** in; a phase that crosses midnight stays on its start day.
 */
export class FocusService {
  private repo: FocusSessionRepository

  constructor(db?: AppDatabase) {
    this.repo = new FocusSessionRepository(db ?? getDb())
  }

  /** Open a record for a focus phase that just started. */
  async start(input: StartFocusInput): Promise<FocusSession> {
    const row: FocusSession = {
      id: input.id ?? crypto.randomUUID(),
      startedAt: input.startedAt,
      endedAt: input.startedAt,
      plannedMs: input.plannedMs,
      focusedMs: 0,
      kind: input.kind,
      route: input.route,
      completed: false,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    }
    return this.repo.put(row)
  }

  /** Save the time counted so far (while running, and on pause). */
  async checkpoint(id: string, focusedMs: number, at: number): Promise<void> {
    const row = await this.repo.get(id)
    if (!row) return
    await this.repo.put({
      ...row,
      focusedMs: Math.max(row.focusedMs, Math.round(focusedMs)),
      endedAt: Math.max(row.endedAt, at),
    })
  }

  /**
   * Close a record. A phase closed early (skip / reset) with almost no time
   * counted is removed instead of kept as a zero-length row.
   */
  async finish(
    id: string,
    result: { focusedMs: number; endedAt: number; completed: boolean },
  ): Promise<void> {
    const row = await this.repo.get(id)
    if (!row) return
    if (!result.completed && result.focusedMs < MIN_KEPT_MS) {
      await this.repo.delete(id)
      return
    }
    await this.repo.put({
      ...row,
      focusedMs: Math.round(result.focusedMs),
      endedAt: result.endedAt,
      completed: result.completed,
    })
  }

  /** Every record that started in `range`, oldest first. */
  async list(range: FocusRange): Promise<FocusSession[]> {
    return this.repo.listStartedIn(range)
  }

  /** One entry per local day of `range` (days without focus included, as 0). */
  async listByDay(range: FocusRange): Promise<FocusDayTotal[]> {
    const rows = await this.repo.listStartedIn(range)
    const byDay = new Map<string, { focusedMs: number; sessions: number }>()
    for (const row of rows) {
      const key = localDayKey(row.startedAt)
      const entry = byDay.get(key) ?? { focusedMs: 0, sessions: 0 }
      entry.focusedMs += row.focusedMs
      if (row.focusedMs > 0) entry.sessions += 1
      byDay.set(key, entry)
    }
    const days: FocusDayTotal[] = []
    for (
      let cursor = new Date(startOfLocalDay(range.from));
      cursor.getTime() < range.to;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const start = cursor.getTime()
      const key = localDayKey(start)
      const entry = byDay.get(key)
      days.push({
        day: key,
        start,
        focusedMs: entry?.focusedMs ?? 0,
        sessions: entry?.sessions ?? 0,
      })
    }
    return days
  }

  /** Focus time per course in `range`, largest first; `projectId: null` is time outside a course. */
  async totalsByCourse(range: FocusRange): Promise<FocusCourseTotal[]> {
    const rows = await this.repo.listStartedIn(range)
    const byCourse = new Map<string | null, FocusCourseTotal>()
    for (const row of rows) {
      if (row.focusedMs <= 0) continue
      const key = row.projectId ?? null
      const entry = byCourse.get(key) ?? { projectId: key, focusedMs: 0, sessions: 0 }
      entry.focusedMs += row.focusedMs
      entry.sessions += 1
      byCourse.set(key, entry)
    }
    return [...byCourse.values()].sort((a, b) => b.focusedMs - a.focusedMs)
  }

  /** Total focus time in `range` (all courses and global). */
  async totalMs(range: FocusRange): Promise<number> {
    const rows = await this.repo.listStartedIn(range)
    return rows.reduce((sum, row) => sum + row.focusedMs, 0)
  }
}
