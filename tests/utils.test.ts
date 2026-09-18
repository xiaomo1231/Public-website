import { describe, expect, it } from 'vitest'
import { cn, clamp, formatDate, formatDateTime, relativeTime } from '@/shared/lib/utils'

describe('utils', () => {
  it('cn merges tailwind classes with conflicts resolved', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm', 'font-bold')).toBe('text-sm font-bold')
  })

  it('clamp keeps value within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('formats dates for the given locale', () => {
    const ts = Date.UTC(2026, 0, 5, 13, 4)
    expect(formatDate(ts, 'en')).toMatch(/Jan 5, 2026/)
    expect(formatDate(ts, 'zh-CN')).toMatch(/2026年1月5日/)
    expect(formatDateTime(ts, 'en')).toMatch(/Jan 5, 2026/)
    expect(formatDateTime(ts, 'zh-CN')).toMatch(/2026年1月5日/)
  })

  it('produces relative time strings per locale', () => {
    const now = 1_700_000_000_000

    expect(relativeTime(now - 10_000, now, 'en')).toBe('now')
    expect(relativeTime(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago')
    expect(relativeTime(now - 3 * 3_600_000, now, 'en')).toBe('3 hours ago')
    expect(relativeTime(now - 2 * 86_400_000, now, 'en')).toBe('2 days ago')

    expect(relativeTime(now - 10_000, now, 'zh-CN')).toBe('现在')
    expect(relativeTime(now - 5 * 60_000, now, 'zh-CN')).toBe('5分钟前')
    expect(relativeTime(now - 3 * 3_600_000, now, 'zh-CN')).toBe('3小时前')
  })
})