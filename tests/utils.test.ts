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

  it('formats dates', () => {
    const ts = Date.UTC(2026, 0, 5, 13, 4)
    expect(formatDate(ts)).toMatch(/2026-01-05/)
    expect(formatDateTime(ts)).toMatch(/2026-01-05 \d{2}:04/)
  })

  it('produces relative time strings', () => {
    const now = 1_700_000_000_000
    expect(relativeTime(now - 10_000, now)).toBe('刚刚')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 天前')
  })
})