import { getUILanguage } from './store'
import { LOCALE_TAGS, type UILanguage } from './types'

/**
 * Locale-aware formatting helpers.
 *
 * Every helper defaults to the current UI language but accepts an explicit
 * language so it can be unit-tested deterministically.
 */

export function formatDate(timestamp: number, language: UILanguage = getUILanguage()): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[language], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

export function formatDateTime(timestamp: number, language: UILanguage = getUILanguage()): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[language], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function formatNumber(value: number, language: UILanguage = getUILanguage()): string {
  return new Intl.NumberFormat(LOCALE_TAGS[language]).format(value)
}

export function formatPercent(
  value: number,
  fractionDigits = 0,
  language: UILanguage = getUILanguage(),
): string {
  return new Intl.NumberFormat(LOCALE_TAGS[language], {
    style: 'percent',
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

const relativeFormatters = new Map<UILanguage, Intl.RelativeTimeFormat>()

function relativeFormatter(language: UILanguage): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(language)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(LOCALE_TAGS[language], { numeric: 'auto' })
    relativeFormatters.set(language, formatter)
  }
  return formatter
}

/** "now" / "5 minutes ago" / "3 days ago" — localised via `Intl.RelativeTimeFormat`. */
export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
  language: UILanguage = getUILanguage(),
): string {
  const rtf = relativeFormatter(language)
  const seconds = Math.round((timestamp - now) / 1000)
  const abs = Math.abs(seconds)

  if (abs < 45) return rtf.format(0, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(days, 'day')
  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return rtf.format(months, 'month')
  return rtf.format(Math.round(months / 12), 'year')
}
