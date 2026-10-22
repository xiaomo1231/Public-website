/**
 * Exam countdown (the thin bar at the top of study pages). Pure helpers: the
 * time left, an urgency level for the colour ramp, and which routes hide the
 * bar (anything that is itself an exam: a mock exam, a quiz being taken, an
 * oral rehearsal, a self-test, a patient interview).
 */

export interface CountdownParts {
  days: number
  hours: number
  minutes: number
  /** The exam has started. */
  past: boolean
}

export function countdownParts(now: number, at: number): CountdownParts {
  const diff = at - now
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, past: true }
  const minutesTotal = Math.floor(diff / 60_000)
  return {
    days: Math.floor(minutesTotal / 1440),
    hours: Math.floor((minutesTotal % 1440) / 60),
    minutes: minutesTotal % 60,
    past: false,
  }
}

/** `calm` > 14 days, `soon` 8–14, `near` 4–7, `final` the last 3 days. */
export type CountdownUrgency = 'calm' | 'soon' | 'near' | 'final'

export function countdownUrgency(now: number, at: number): CountdownUrgency {
  const days = (at - now) / 86_400_000
  if (days <= 3) return 'final'
  if (days <= 7) return 'near'
  if (days <= 14) return 'soon'
  return 'calm'
}

/** The next exam that has not started yet. */
export function nearestExam<T extends { at: number }>(exams: readonly T[], now: number): T | null {
  return exams.filter((exam) => exam.at > now).sort((a, b) => a.at - b.at)[0] ?? null
}

/**
 * Routes where the bar is hidden: the student is sitting an exam (or a timed
 * rehearsal of one), or on a page that is not about studying.
 */
export function hidesCountdown(pathname: string, search = ''): boolean {
  const path = pathname.replace(/\/+$/, '')
  if (/\/homework\/[^/]+\/exam$/.test(path)) return true
  // A quiz being taken (its result page shows the bar again).
  if (/\/projects\/[^/]+\/quiz\/[^/]+$/.test(path)) return true
  if (/\/projects\/[^/]+\/interview\/[^/]+$/.test(path)) return true
  const params = new URLSearchParams(search)
  if (/\/projects\/[^/]+\/homework\/[^/]+$/.test(path) && params.get('view') === 'selftest')
    return true
  if (path === '/settings' || path === '/login' || path === '/invite') return true
  return false
}
