import { describe, expect, it } from 'vitest'
import { ThinkStreamFilter, stripThinkBlocks } from '@/infrastructure/ai/responseText'

describe('stripThinkBlocks', () => {
  it('Test 1 — removes an inline block', () => {
    expect(stripThinkBlocks('<think>reasoning</think>Hello')).toBe('Hello')
  })

  it('Test 2 — removes a block on its own lines', () => {
    expect(stripThinkBlocks('<think>\nreasoning\n</think>\n\nHello')).toBe('Hello')
  })

  it('Test 3 — removes a block between two paragraphs', () => {
    const input = 'Hello\n\n<think>\nreasoning\n</think>\n\nWorld'
    expect(stripThinkBlocks(input)).toBe('Hello\n\nWorld')
  })

  it('Test 4 — removes every block', () => {
    const input = '<think>A</think>\nHello\n<think>B</think>\nWorld'
    const out = stripThinkBlocks(input)
    expect(out).not.toContain('think')
    expect(out).toContain('Hello')
    expect(out).toContain('World')
  })

  it('Test 5 — leaves content without a think block untouched', () => {
    const markdown = '## Explanation\n\nHello\n\n\\[\nA \\cap B\n\\]'
    expect(stripThinkBlocks(markdown)).toBe(markdown)
  })

  it('Test 7 — hides an unterminated block entirely', () => {
    expect(stripThinkBlocks('<think>\nreasoning')).toBe('')
    expect(stripThinkBlocks('Hello\n<think>\nreasoning')).toBe('Hello')
  })

  it('Test 8 — keeps Markdown and LaTeX after removing the block', () => {
    const input = '<think>reasoning</think>\n\n## Result\n\n\\[\nA \\cap B\n\\]'
    expect(stripThinkBlocks(input)).toBe('## Result\n\n\\[\nA \\cap B\n\\]')
  })

  it('handles <thinking> and attributes', () => {
    expect(stripThinkBlocks('<thinking>r</thinking>Answer')).toBe('Answer')
    expect(stripThinkBlocks('<think reason="x">r</think>Answer')).toBe('Answer')
  })

  it('does not touch ordinary angle brackets', () => {
    const text = 'Compare a < b and c > d.'
    expect(stripThinkBlocks(text)).toBe(text)
  })
})

describe('ThinkStreamFilter', () => {
  function collect(): { out: string[]; filter: ThinkStreamFilter } {
    const out: string[] = []
    return { out, filter: new ThinkStreamFilter((text) => out.push(text)) }
  }

  it('Test 6 — handles a think block split across chunks', () => {
    const { out, filter } = collect()
    filter.push('<thi')
    filter.push('nk>reasoning</thi')
    filter.push('nk>Answer')
    filter.flush()
    expect(out.join('')).toBe('Answer')
  })

  it('Test 7 — never emits unterminated reasoning', () => {
    const { out, filter } = collect()
    filter.push('<think>')
    filter.push('\nreasoning')
    filter.flush()
    expect(out.join('')).toBe('')
  })

  it('never flashes a partial opening tag', () => {
    const { out, filter } = collect()
    filter.push('Visible ')
    filter.push('<')
    filter.push('th')
    expect(out.join('')).toBe('Visible ')
    filter.push('ink>hidden</think>Shown')
    filter.flush()
    expect(out.join('')).toBe('Visible Shown')
  })

  it('passes through a response with no think block', () => {
    const { out, filter } = collect()
    filter.push('## Explanation\n\n')
    filter.push('The result is:')
    filter.flush()
    expect(out.join('')).toBe('## Explanation\n\nThe result is:')
  })

  it('keeps ordinary angle brackets', () => {
    const { out, filter } = collect()
    filter.push('a < b > c')
    filter.flush()
    expect(out.join('')).toBe('a < b > c')
  })

  it('handles multiple blocks in a stream', () => {
    const { out, filter } = collect()
    filter.push('<think>A</think>Hello ')
    filter.push('<think>B</think>World')
    filter.flush()
    expect(out.join('')).toBe('Hello World')
  })
})
