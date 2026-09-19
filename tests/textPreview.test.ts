import { describe, expect, it } from 'vitest'
import { collapseText } from '@/shared/lib/textPreview'

describe('collapseText', () => {
  it('returns short text unchanged', () => {
    expect(collapseText('short text', 100)).toEqual({ shown: 'short text', truncated: false })
  })

  it('returns text that exactly fits unchanged', () => {
    const text = 'a'.repeat(50)
    expect(collapseText(text, 50)).toEqual({ shown: text, truncated: false })
  })

  it('cuts long text and reports truncation', () => {
    const result = collapseText('a'.repeat(500), 100)
    expect(result.truncated).toBe(true)
    expect(result.shown.length).toBeLessThanOrEqual(100)
  })

  it('prefers to stop at an English sentence boundary', () => {
    const text = 'First sentence is here. Second sentence is here. Third sentence is here.'
    const result = collapseText(text, 40)
    expect(result.truncated).toBe(true)
    expect(result.shown.endsWith('.')).toBe(true)
    expect(result.shown.startsWith('First sentence')).toBe(true)
  })

  it('prefers to stop at a Chinese full stop', () => {
    const text = '这是第一句话。这是第二句话。这是第三句话。这是第四句话。'
    const result = collapseText(text, 20)
    expect(result.truncated).toBe(true)
    expect(result.shown.endsWith('。')).toBe(true)
  })

  it('falls back to a hard cut when there is no boundary', () => {
    const text = 'A'.repeat(500)
    const result = collapseText(text, 100)
    expect(result.truncated).toBe(true)
    expect(result.shown).toBe('A'.repeat(100))
  })

  it('does not cut at a boundary that would discard most of the budget', () => {
    // The only boundary sits at the very start, so a hard cut is used instead.
    const text = 'Hi. ' + 'x'.repeat(400)
    const result = collapseText(text, 100)
    expect(result.shown.length).toBeGreaterThan(50)
  })

  it('never returns more than the budget', () => {
    const text = 'word '.repeat(200)
    for (const limit of [20, 50, 120, 320]) {
      expect(collapseText(text, limit).shown.length).toBeLessThanOrEqual(limit)
    }
  })

  it('handles empty input', () => {
    expect(collapseText('', 100)).toEqual({ shown: '', truncated: false })
  })

  it('handles a non-positive budget', () => {
    expect(collapseText('abc', 0)).toEqual({ shown: 'abc', truncated: false })
  })

  it('preserves math symbols when cutting', () => {
    const text = 'The union A ∪ B and the intersection A ∩ B are both defined. ' + 'More text here. '.repeat(20)
    const result = collapseText(text, 60)
    expect(result.shown).toContain('∪')
    expect(result.shown).toContain('∩')
  })
})
