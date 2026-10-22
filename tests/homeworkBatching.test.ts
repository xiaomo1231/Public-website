import { describe, expect, it } from 'vitest'
import {
  countCandidateQuestions,
  dedupeByKey,
  planAnalyzerBatches,
} from '@/entities/homework/analyzerBatching'
import type { DocumentChunk } from '@/entities/chunk/types'

function chunk(id: string, order: number, text: string): DocumentChunk {
  return {
    id,
    documentId: 'd1',
    projectId: 'p1',
    materialType: 'homework',
    pageNumber: order + 1,
    contentType: 'paragraph',
    text,
    sourceReference: `hw.pdf · Page ${order + 1}`,
    order,
    createdAt: 0,
  }
}

describe('planAnalyzerBatches', () => {
  it('keeps a small document in a single batch', () => {
    const plan = planAnalyzerBatches([chunk('a', 0, 'short'), chunk('b', 1, 'also short')])
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0]!.map((c) => c.id)).toEqual(['a', 'b'])
    expect(plan.droppedChunks).toBe(0)
  })

  it('splits a long document into ordered, contiguous batches', () => {
    const chunks = Array.from({ length: 12 }, (_, i) => chunk(`c${i}`, i, 'x'.repeat(600)))
    const plan = planAnalyzerBatches(chunks, 2000)
    expect(plan.batches.length).toBeGreaterThan(1)
    // Every chunk appears exactly once, in document order.
    const flat = plan.batches.flat().map((c) => c.id)
    expect(flat).toEqual(chunks.map((c) => c.id))
    expect(plan.droppedChunks).toBe(0)
    for (const batch of plan.batches) {
      const chars = batch.reduce((n, c) => n + c.text.length + 40, 0)
      expect(chars).toBeLessThanOrEqual(2000 + 640) // one oversized chunk may exceed
    }
  })

  it('never sends more than the batch cap, reporting the rest as dropped', () => {
    const chunks = Array.from({ length: 10 }, (_, i) => chunk(`c${i}`, i, 'x'.repeat(600)))
    const plan = planAnalyzerBatches(chunks, 700, 3)
    expect(plan.batches).toHaveLength(3)
    expect(plan.droppedChunks).toBe(7)
    expect(plan.batches.flat()).toHaveLength(3)
  })

  it('gives a single oversized chunk its own batch instead of dropping it', () => {
    const plan = planAnalyzerBatches([chunk('big', 0, 'x'.repeat(5000))], 1000)
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0]![0]!.id).toBe('big')
    expect(plan.droppedChunks).toBe(0)
  })
})

describe('dedupeByKey', () => {
  it('removes later duplicates and keeps first-seen order', () => {
    const items = [{ k: 'a' }, { k: 'b' }, { k: 'a' }, { k: 'c' }]
    expect(dedupeByKey(items, (i) => i.k).map((i) => i.k)).toEqual(['a', 'b', 'c'])
  })
})

describe('countCandidateQuestions', () => {
  it('counts a documented `{ questions: [...] }` payload', () => {
    expect(countCandidateQuestions({ questions: [{ prompt: 'a' }] })).toBe(1)
  })

  it('counts a bare array payload', () => {
    expect(countCandidateQuestions([{ prompt: 'a' }, { prompt: 'b' }])).toBe(2)
  })

  it('returns zero for a non-array shape', () => {
    expect(countCandidateQuestions({ questions: 'nope' })).toBe(0)
    expect(countCandidateQuestions(null)).toBe(0)
  })
})
