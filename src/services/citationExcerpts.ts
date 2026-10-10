import type { SourceReference } from '@/entities/courseAnalysis/types'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'

/** A citation as shown, with where its excerpt came from. */
export type DisplayedCitation = SourceReference & {
  /** The excerpt is the cited page's text, not the located sentence. */
  pageExcerpt?: boolean
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Give citations without an excerpt the course text they point at, read from
 * local chunks: the cited chunk itself, or else the cited page. Citations that
 * already carry an excerpt, or that point at nothing that still exists, are
 * returned unchanged. Nothing is written back.
 */
export async function fillMissingExcerpts(
  refs: SourceReference[],
  db: AppDatabase = getDb(),
): Promise<DisplayedCitation[]> {
  if (refs.every((ref) => (ref.quote ?? '').trim() || ref.quotePending)) return refs
  const chunks = new ChunkRepository(db)
  const byDocument = new Map<string, Promise<DocumentChunk[]>>()
  const documentChunks = (id: string) => {
    if (!byDocument.has(id)) byDocument.set(id, chunks.listByDocument(id).catch(() => []))
    return byDocument.get(id)!
  }

  return Promise.all(
    refs.map(async (ref): Promise<DisplayedCitation> => {
      if ((ref.quote ?? '').trim() || ref.quotePending) return ref
      if (ref.chunkId) {
        const chunk = await chunks.get(ref.chunkId).catch(() => undefined)
        if (chunk && collapse(chunk.text)) return { ...ref, quote: collapse(chunk.text) }
      }
      if (ref.documentId && ref.page !== undefined) {
        const onPage = (await documentChunks(ref.documentId)).filter((chunk) => chunk.pageNumber === ref.page)
        const text = collapse(onPage.map((chunk) => chunk.text).join(' '))
        if (text) return { ...ref, quote: text, pageExcerpt: true }
      }
      return ref
    }),
  )
}
