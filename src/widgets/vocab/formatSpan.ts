import type { useTranslation } from '@/i18n'

type T = ReturnType<typeof useTranslation>['t']

/** "10 分钟", "3 天", "2 个月" — how far a rating pushes a word out. */
export function formatSpan(ms: number, t: T): string {
  if (ms < 60 * 60000)
    return t('vocab.span.minutes', { count: Math.max(1, Math.round(ms / 60000)) })
  const hours = Math.round(ms / (60 * 60000))
  if (hours < 24) return t('vocab.span.hours', { count: hours })
  const days = Math.max(1, Math.round(ms / 86400000))
  if (days < 31) return t('vocab.span.days', { count: days })
  if (days < 365) return t('vocab.span.months', { count: Math.round(days / 30) })
  return t('vocab.span.years', { count: Math.round((days / 365) * 10) / 10 })
}

/**
 * When a word comes back: "现在" when due, "10 分钟后" / "3 天后" within a
 * month, else the date ("2026-12-03").
 */
export function formatNextReview(due: number, t: T, now = Date.now()): string {
  const ms = due - now
  if (ms <= 0) return t('vocab.next.now')
  if (ms < 31 * 86400000) return t('vocab.next.in', { span: formatSpan(ms, t) })
  const date = new Date(due)
  const pad = (n: number) => String(n).padStart(2, '0')
  return t('vocab.next.on', {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
  })
}
