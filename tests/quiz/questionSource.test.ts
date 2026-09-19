import { describe, expect, it } from 'vitest'
import { resolveSourceReferences } from '@/services/quizService'
import type { SourceSnippet } from '@/services/sourceContext'

/**
 * The model only ever supplies a chunk id and a quote. Every other citation
 * field must come from local storage, and an unverifiable quote must never be
 * presented as course text.
 */

const CHUNK_TEXT =
  'The derivative of a function represents the instantaneous rate of change of the function with respect to its independent variable.'

const SNIPPET: SourceSnippet = {
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  documentName: 'Calculus Lecture 03.pdf',
  pageNumber: 12,
  section: 'Derivatives',
  text: CHUNK_TEXT,
}

function index(entries: SourceSnippet[]): Map<string, SourceSnippet> {
  return new Map(entries.map((entry) => [entry.chunkId, entry]))
}

const only = index([SNIPPET])

describe('resolveSourceReferences', () => {
  it('builds a citation entirely from local chunk data', () => {
    const refs = resolveSourceReferences('chunk-1', CHUNK_TEXT, only)

    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      documentId: 'doc-1',
      documentName: 'Calculus Lecture 03.pdf',
      page: 12,
      section: 'Derivatives',
      chunkId: 'chunk-1',
    })
    expect(refs[0]!.quote).toBe(CHUNK_TEXT)
  })

  it('discards a chunk id that was never offered to the model', () => {
    // A fabricated id must not produce a citation, even with a real-looking quote.
    expect(resolveSourceReferences('chunk-999', CHUNK_TEXT, only)).toEqual([])
  })

  it('returns nothing when the model cites no source', () => {
    expect(resolveSourceReferences(null, null, only)).toEqual([])
    expect(resolveSourceReferences(undefined, undefined, only)).toEqual([])
    expect(resolveSourceReferences('', '', only)).toEqual([])
    expect(resolveSourceReferences('   ', '   ', only)).toEqual([])
  })

  it('rejects a summary and falls back to real course text', () => {
    const refs = resolveSourceReferences(
      'chunk-1',
      'This question is based on the concept of derivatives.',
      only,
    )
    expect(refs[0]!.quote).not.toMatch(/this question is based/i)
    expect(CHUNK_TEXT).toContain(refs[0]!.quote!.replace(/…$/, ''))
  })

  it('rejects a paraphrase that is not in the chunk', () => {
    const refs = resolveSourceReferences('chunk-1', 'Derivatives measure how fast things change.', only)
    // Not found verbatim -> the chunk's own wording is shown instead.
    expect(refs[0]!.quote).toBe(CHUNK_TEXT)
  })

  it('keeps a verbatim quote that differs only in whitespace', () => {
    const spaced = CHUNK_TEXT.replace(/ /g, '  ')
    const refs = resolveSourceReferences('chunk-1', spaced, only)
    // Accepted as the same text, and preserved rather than replaced.
    expect(refs[0]!.quote!.replace(/\s+/g, ' ')).toBe(CHUNK_TEXT)
  })

  it('caps a very long excerpt', () => {
    const huge: SourceSnippet = { ...SNIPPET, text: 'lorem ipsum '.repeat(400) }
    const refs = resolveSourceReferences('chunk-1', 'not present in the chunk', index([huge]))
    expect(refs[0]!.quote!.length).toBeLessThan(400)
    expect(refs[0]!.quote!.endsWith('…')).toBe(true)
  })

  it('never invents page or section when the chunk has none', () => {
    const bare: SourceSnippet = {
      chunkId: 'c1',
      documentId: 'd1',
      documentName: 'notes.pdf',
      text: CHUNK_TEXT,
    }
    const refs = resolveSourceReferences('c1', CHUNK_TEXT, index([bare]))
    expect(refs[0]!.page).toBeUndefined()
    expect(refs[0]!.section).toBeUndefined()
    expect(refs[0]!.documentName).toBe('notes.pdf')
  })

  it('handles special content without altering it', () => {
    const text = 'Euler: $e^{i\\pi} + 1 = 0$\n\n- item one\n- item two\n\nShe said "hello".'
    const snippet: SourceSnippet = {
      chunkId: 'c2',
      documentId: 'd2',
      documentName: 'math.pdf',
      text,
    }
    const refs = resolveSourceReferences('c2', text, index([snippet]))
    expect(refs[0]!.quote).toBe(text)
  })

  it('resolves each question against its own snippet', () => {
    const a: SourceSnippet = { ...SNIPPET, chunkId: 'a', pageNumber: 3 }
    const b: SourceSnippet = { ...SNIPPET, chunkId: 'b', documentName: 'Lecture 04.pdf', pageNumber: 9 }
    const both = index([a, b])

    expect(resolveSourceReferences('a', CHUNK_TEXT, both)[0]).toMatchObject({
      page: 3,
      documentName: 'Calculus Lecture 03.pdf',
    })
    expect(resolveSourceReferences('b', CHUNK_TEXT, both)[0]).toMatchObject({
      page: 9,
      documentName: 'Lecture 04.pdf',
    })
  })
})
