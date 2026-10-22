import type { TranslationKey, TranslationParams } from '@/i18n'

/** Days shown in 学习时长. */
export const FOCUS_STATS_DAYS = 14

/** "25 min" / "1 h 5 min" (or the Chinese forms), from a focus total. */
export function formatFocusDuration(
  ms: number,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return t('focusStats.minutes', { minutes })
  return t('focusStats.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
}
