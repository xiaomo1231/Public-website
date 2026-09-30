import { describe, expect, it } from 'vitest'
import {
  locateQuestionExcerpt,
  parseSourceChunkId,
  resolveSourceChunkIds,
} from '@/entities/homework/sourceGrounding'

const ID = '9f3a1c2e-1111-2222-3333-444455556666'
const OTHER = 'aaaa1111-bbbb-2222-cccc-333344445555'
const allowed = new Set([ID])

describe('parseSourceChunkId', () => {
  it('accepts the bare chunk id', () => {
    expect(parseSourceChunkId(ID, allowed)).toBe(ID)
    expect(parseSourceChunkId(`  ${ID}  `, allowed)).toBe(ID)
  })

  it('accepts the c:-prefixed id the model copies from the label', () => {
    expect(parseSourceChunkId(`c:${ID}`, allowed)).toBe(ID)
  })

  it('accepts a full label, bracketed or not', () => {
    expect(parseSourceChunkId(`[c:${ID} · Ch 3 · 3.1 · p12]`, allowed)).toBe(ID)
    expect(parseSourceChunkId(`c:${ID} · Ch 3 · 3.1 · p12`, allowed)).toBe(ID)
    expect(parseSourceChunkId(`[c:${ID}]`, allowed)).toBe(ID)
  })

  it('accepts a label whose id is uppercase (hex is case-insensitive), whole token only', () => {
    expect(parseSourceChunkId(`c:${ID.toUpperCase()}`, allowed)).toBe(ID)
  })

  it('rejects an invented id', () => {
    expect(parseSourceChunkId('c:invented', allowed)).toBeNull()
    expect(parseSourceChunkId('invented', allowed)).toBeNull()
  })

  it('rejects another batch’s id even when the format is identical', () => {
    expect(parseSourceChunkId(OTHER, allowed)).toBeNull()
    expect(parseSourceChunkId(`c:${OTHER}`, allowed)).toBeNull()
    expect(parseSourceChunkId(`[c:${OTHER} · p1]`, allowed)).toBeNull()
  })

  it('never prefix-matches a truncated id (ellipsis)', () => {
    expect(parseSourceChunkId(`c:${ID.slice(0, 8)}…`, allowed)).toBeNull()
    expect(parseSourceChunkId(ID.slice(0, 12), allowed)).toBeNull()
  })

  it('never extracts an id embedded in prose', () => {
    expect(parseSourceChunkId(`the source is c:${ID}`, allowed)).toBeNull()
    expect(parseSourceChunkId(`Problem 5 uses ${ID}.`, allowed)).toBeNull()
  })

  it('rejects a bare number or empty value', () => {
    expect(parseSourceChunkId('5', allowed)).toBeNull()
    expect(parseSourceChunkId('   ', allowed)).toBeNull()
    expect(parseSourceChunkId('', allowed)).toBeNull()
  })
})

describe('resolveSourceChunkIds', () => {
  it('keeps order, de-duplicates and drops invalid values', () => {
    expect(
      resolveSourceChunkIds([`c:${ID}`, ID, 'c:invented', OTHER, `[c:${ID} · p2]`], allowed),
    ).toEqual([ID])
  })
})

describe('locateQuestionExcerpt', () => {
  const chunk =
    'Problem 4. Differentiate 3x^2.\nProblem 5. Find the limit of x^2 as x tends to 3.'

  it('locates the question’s own span inside a chunk holding several questions', () => {
    const excerpt = locateQuestionExcerpt(chunk, 'Problem 5. Find the limit of x^2 as x tends to 3.')
    expect(excerpt).toContain('Problem 5')
    expect(excerpt).not.toContain('Problem 4')
  })

  it('matches across whitespace differences', () => {
    const excerpt = locateQuestionExcerpt(
      'Problem 1.   Evaluate   the integral.\nProblem 2. Solve for x.',
      'Problem 1. Evaluate the integral.',
    )
    expect(excerpt).toContain('Evaluate')
    expect(excerpt).not.toContain('Problem 2')
  })

  it('returns null when the question text is not in this chunk', () => {
    expect(locateQuestionExcerpt(chunk, 'Problem 9. Prove the theorem.')).toBeNull()
  })

  it('works for CJK questions', () => {
    const cjk = '第4题 求导数。\n第5题 求 x² 在 x 趋于 3 时的极限。'
    const excerpt = locateQuestionExcerpt(cjk, '第5题 求 x² 在 x 趋于 3 时的极限。')
    expect(excerpt).toContain('第5题')
    expect(excerpt).not.toContain('第4题')
  })
})
