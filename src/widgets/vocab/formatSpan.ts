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
