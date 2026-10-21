import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Date helpers are locale-aware and live in `@/i18n`. They are re-exported here
 * so existing imports keep working.
 */
export { formatDate, formatDateTime, formatRelativeTime as relativeTime } from '@/i18n'
