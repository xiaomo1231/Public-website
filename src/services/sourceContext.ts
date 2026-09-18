import type { ChunkRepository } from '@/entities/chunk/repository'

export interface CollectSourceOptions {
  documentIds: string[]
  chunks: ChunkRepository
  topicName?: string
  /** Max snippets returned. */
  limit?: number
  /** Skip chunks longer than this (likely malformed / table dumps). */
  maxChunkChars?: number
  /** Optional filter — e.g. prefer chunks mentioning a keyword. */
  preferKeyword?: string
}

/**
 * Shared helper used by the tutor and quiz services to pull a bounded set of
 * source snippets from a project's chunks.
 *
 * Phase 4 keeps this simple (document order with an optional keyword
 * preference). Phase 5 will replace it with a real retrieval index.
 */
export async function collectSourceSnippets(options: CollectSourceOptions): Promise<string[]> {
  const { documentIds, chunks, topicName, limit = 6, maxChunkChars = 1000, preferKeyword } = options
  const out: string[] = []
  const deferred: string[] = []

  for (const documentId of documentIds) {
    const list = await chunks.listByDocument(documentId)
    for (const chunk of list) {
      if (chunk.text.length > maxChunkChars || chunk.text.trim().length < 20) continue
      const prefix = topicName
        ? `[${topicName}${chunk.pageNumber ? ` · p${chunk.pageNumber}` : ''}${chunk.section ? ` · ${chunk.section}` : ''}] `
        : `[${chunk.pageNumber ? `p${chunk.pageNumber}` : 'source'}${chunk.section ? ` · ${chunk.section}` : ''}] `
      const snippet = prefix + chunk.text
      if (preferKeyword && chunk.text.toLowerCase().includes(preferKeyword.toLowerCase())) {
        out.push(snippet)
      } else {
        deferred.push(snippet)
      }
    }
  }

  const merged = [...out, ...deferred]
  return merged.slice(0, limit)
}