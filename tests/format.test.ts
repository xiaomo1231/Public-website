import { describe, expect, it } from 'vitest'
import { formatBytes } from '@/shared/lib/format'

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })
  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
  })
  it('formats megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('formats gigabytes', () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB')
  })
})