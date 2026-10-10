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

export interface QuizSnippetOptions {
  documentIds: string[]
  chunks: ChunkRepository
  documents?: DocumentRepository
  /** Chunks the questions should come from first (a topic's validated sources). */
  preferChunkIds?: string[]
  /** Each one draws a passage that mentions it, so the questions cover them all. */
  keywords?: string[]
  /** Only passages from this chapter / section. */
  chapterId?: string
  sectionId?: string
  limit: number
  maxChunkChars?: number
}

/**
 * Source passages for a quiz, drawn from the whole course rather than its
 * opening pages: a topic's own source chunks first, then one passage per
 * knowledge point, then passages spaced evenly through the material.
 */
export async function collectQuizSnippets(options: QuizSnippetOptions): Promise<SourceSnippet[]> {
  const { documentIds, chunks, documents, limit, maxChunkChars = 1000 } = options
  const candidates: SourceSnippet[] = []
  for (const documentId of documentIds) {
    let name = ''
    if (documents) {
      try {
        name = (await documents.get(documentId)).name
      } catch {
        // Deleted document: keep its chunks, without a name.
      }
    }
    for (const chunk of await chunks.listByDocument(documentId)) {
      if (chunk.text.length > maxChunkChars || chunk.text.trim().length < 20) continue
      if (options.chapterId && chunk.chapterId !== options.chapterId) continue
      if (options.sectionId && chunk.sectionId !== options.sectionId) continue
      candidates.push({
        chunkId: chunk.id,
        documentId,
        documentName: name,
        ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
        ...(chunk.section ? { section: chunk.section } : {}),
        ...(chunk.chapterId ? { chapterId: chunk.chapterId } : {}),
        ...(chunk.sectionId ? { sectionId: chunk.sectionId } : {}),
        text: chunk.text,
      })
    }
  }

  const picked = new Set<number>()
  const take = (index: number) => {
    if (picked.size < limit && index >= 0) picked.add(index)
  }
  const byId = new Map(candidates.map((snippet, index) => [snippet.chunkId, index]))
  for (const id of options.preferChunkIds ?? []) take(byId.get(id) ?? -1)
  for (const keyword of options.keywords ?? []) {
    const needle = keyword.trim().toLowerCase()
    if (!needle) continue
    take(candidates.findIndex((snippet, index) => !picked.has(index) && snippet.text.toLowerCase().includes(needle)))
  }
  // Fill the rest evenly across the material, not from its first pages.
  const free = candidates.map((_, index) => index).filter((index) => !picked.has(index))
  const room = limit - picked.size
  for (let i = 0; i < room && i < free.length; i++) take(free[Math.floor((i * free.length) / room)]!)
  return [...picked].sort((a, b) => a - b).map((index) => candidates[index]!)
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
