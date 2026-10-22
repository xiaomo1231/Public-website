import { MAX_DAY_MINUTES, type DayType, type StudyCalendar } from './types'

/** Local `YYYY-MM-DD` of a time. */
export function dayKey(time: number | Date): string {
  const date = typeof time === 'number' ? new Date(time) : time
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Local midnight of a `YYYY-MM-DD` key. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

export function addDays(key: string, days: number): string {
  const date = parseDayKey(key)
  date.setDate(date.getDate() + days)
  return dayKey(date)
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseDayKey(from)
  const b = parseDayKey(to)
  // Rounded: a daylight-saving change makes a day 23 or 25 hours long.
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** Monday of the week containing `key`. */
export function weekStart(key: string): string {
  const day = parseDayKey(key).getDay()
  return addDays(key, -((day + 6) % 7))
}

export function dayTypeOf(calendar: StudyCalendar, key: string): DayType {
  return calendar.overrides[key]?.type ?? calendar.weekly[parseDayKey(key).getDay()] ?? 'class'
}

/** Minutes available on a day (0 for an `off` day). */
export function minutesOn(calendar: StudyCalendar, key: string): number {
  const override = calendar.overrides[key]
  const type = override?.type ?? dayTypeOf(calendar, key)
  if (type === 'off') return 0
  const minutes = override?.minutes ?? calendar.minutes[type] ?? 0
  return clampMinutes(minutes)
}

export function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_DAY_MINUTES, Math.round(value)))
}

/** A calendar with every number in range and a full week (bad stored data never breaks planning). */
export function normalizeCalendar(calendar: StudyCalendar): StudyCalendar {
  const weekly = Array.from({ length: 7 }, (_, i) => calendar.weekly[i] ?? 'class')
  return {
    minutes: {
      class: clampMinutes(calendar.minutes.class),
      weekend: clampMinutes(calendar.minutes.weekend),
      holiday: clampMinutes(calendar.minutes.holiday),
      off: 0,
    },
    weekly,
    overrides: Object.fromEntries(
      Object.entries(calendar.overrides).map(([key, value]) => [
        key,
        {
          type: value.type,
          ...(value.minutes !== undefined ? { minutes: clampMinutes(value.minutes) } : {}),
        },
      ]),
    ),
  }
}
