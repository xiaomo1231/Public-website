import type { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentRepository } from '@/entities/document/repository'

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
  /**
   * When supplied, snippets carry the real document name (and `chunkId` can be
   * resolved back to a document later). Without it, names are left blank.
   */
  documents?: DocumentRepository
}

/**
 * A real chunk plus the metadata needed to cite it.
 *
 * Every field comes from local storage — nothing here is taken from a model's
 * output, so a citation built from a snippet can never be fabricated.
 */
export interface SourceSnippet {
  chunkId: string
  documentId: string
  documentName: string
  pageNumber?: number
  section?: string
  /** Textbook structure, so retrieval can be scoped to a chapter/section. */
  chapterId?: string
  sectionId?: string
  text: string
}

/** Keep only snippets inside the requested chapter/section. */
export function scopeSnippetsByStructure(
  snippets: SourceSnippet[],
  scope: { chapterId?: string; sectionId?: string },
): SourceSnippet[] {
  if (!scope.chapterId && !scope.sectionId) return snippets
  return snippets.filter((snippet) => {
    if (scope.chapterId && snippet.chapterId !== scope.chapterId) return false
    if (scope.sectionId && snippet.sectionId !== scope.sectionId) return false
    return true
  })
}

/**
 * Shared helper used by the tutor and quiz services to pull a bounded set of
 * source snippets from a project's chunks.
 *
 * Retrieval is deliberately simple (document order with an optional keyword
 * preference) so it stays predictable and cheap.
 */
export async function collectSourceSnippetsDetailed(
  options: CollectSourceOptions,
): Promise<SourceSnippet[]> {
  const { documentIds, chunks, limit = 6, maxChunkChars = 1000, preferKeyword, documents } = options

  const names = new Map<string, string>()
  if (documents) {
    for (const documentId of documentIds) {
      try {
        names.set(documentId, (await documents.get(documentId)).name)
      } catch {
        // The document may have been deleted; keep the chunk but leave the
        // name blank rather than dropping usable material.
      }
    }
  }

  const preferred: SourceSnippet[] = []
  const deferred: SourceSnippet[] = []

  for (const documentId of documentIds) {
    const list = await chunks.listByDocument(documentId)
    for (const chunk of list) {
      if (chunk.text.length > maxChunkChars || chunk.text.trim().length < 20) continue
      const snippet: SourceSnippet = {
        chunkId: chunk.id,
        documentId,
        documentName: names.get(documentId) ?? '',
        ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
        ...(chunk.section ? { section: chunk.section } : {}),
        ...(chunk.chapterId ? { chapterId: chunk.chapterId } : {}),
        ...(chunk.sectionId ? { sectionId: chunk.sectionId } : {}),
        text: chunk.text,
      }
      if (preferKeyword && chunk.text.toLowerCase().includes(preferKeyword.toLowerCase())) {
        preferred.push(snippet)
      } else {
        deferred.push(snippet)
      }
    }
  }

  return [...preferred, ...deferred].slice(0, limit)
}

/**
 * Plain-text snippets for prompts that only need prose (tutor, mistake
 * analysis). The output format is unchanged from earlier versions.
 */
export async function collectSourceSnippets(options: CollectSourceOptions): Promise<string[]> {
  const { topicName } = options
  const snippets = await collectSourceSnippetsDetailed(options)
  return snippets.map((snippet) => {
    const prefix = topicName
      ? `[${topicName}${snippet.pageNumber ? ` · p${snippet.pageNumber}` : ''}${snippet.section ? ` · ${snippet.section}` : ''}] `
      : `[${snippet.pageNumber ? `p${snippet.pageNumber}` : 'source'}${snippet.section ? ` · ${snippet.section}` : ''}] `
    return prefix + snippet.text
  })
}

/**
 * Render a snippet for the quiz prompt.
 *
 * The chunk id is included so the model can cite the exact snippet it used;
 * the app then resolves that id against local storage to build the citation.
 */
export function formatSnippetForPrompt(snippet: SourceSnippet): string {
  const where = [
    snippet.documentName,
    snippet.pageNumber !== undefined ? `p${snippet.pageNumber}` : '',
    snippet.section ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
  return `[chunk:${snippet.chunkId}${where ? ` · ${where}` : ''}]\n${snippet.text}`
}
