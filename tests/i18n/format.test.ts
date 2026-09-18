import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from '@/i18n/format'

const TS = Date.UTC(2026, 0, 5, 13, 4)

describe('locale-aware formatting', () => {
  it('formats dates per locale', () => {
    expect(formatDate(TS, 'en')).toBe('Jan 5, 2026')
    expect(formatDate(TS, 'zh-CN')).toBe('2026年1月5日')
  })

  it('formats date-times per locale', () => {
    expect(formatDateTime(TS, 'en')).toContain('Jan 5, 2026')
    expect(formatDateTime(TS, 'zh-CN')).toContain('2026年1月5日')
  })

  it('formats numbers per locale', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567')
    expect(formatNumber(1234567, 'zh-CN')).toBe('1,234,567')
  })

  it('formats percentages per locale', () => {
    expect(formatPercent(0.42, 0, 'en')).toBe('42%')
    expect(formatPercent(0.42, 0, 'zh-CN')).toBe('42%')
  })

  it('formats relative time per locale', () => {
    const now = 1_700_000_000_000
    expect(formatRelativeTime(now - 10_000, now, 'en')).toBe('now')
    expect(formatRelativeTime(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago')
    expect(formatRelativeTime(now - 3 * 3_600_000, now, 'en')).toBe('3 hours ago')
    expect(formatRelativeTime(now - 2 * 86_400_000, now, 'en')).toBe('2 days ago')

    expect(formatRelativeTime(now - 10_000, now, 'zh-CN')).toBe('现在')
    expect(formatRelativeTime(now - 5 * 60_000, now, 'zh-CN')).toBe('5分钟前')
    expect(formatRelativeTime(now - 3 * 3_600_000, now, 'zh-CN')).toBe('3小时前')
  })
})
