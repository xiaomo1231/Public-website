import type { DocumentChunk } from '../chunk/types'
import { chunkContentFingerprint, toSourceChunkFingerprint } from '../chunk/relink'
import { fnv1a } from '@/shared/lib/hash'
import { computeDocumentContentFingerprint } from './sourceHash'

/**
 * Topic dependency: the chunks a teaching topic was actually derived from.
 *
 * The dependency is **not** inferred from the topic's chapter/section (a topic
 * may span chapters) and it is **not** taken from the model's word alone: the
 * analyzer puts a candidate set of chunk ids in front of the model, the model
 * picks from it, and everything is validated here against that candidate set.
 *
 * Nothing in this module touches storage or the AI — it is pure so the
 * validation rules are directly testable.
 */

export interface TopicDependency {
  /** Validated, de-duplicated, sorted. Always non-empty. */
  sourceChunkIds: string[]
  /** Derived locally from the chunks, never taken from the model. */
  sourceChapterIds: string[]
  sourceSectionIds: string[]
  /** Fingerprint of the ids plus their content. */
  dependencyHash: string
}

/** Chunk as it contributes to a dependency fingerprint. */
export { toSourceChunkFingerprint }

/**
 * Fingerprint of a topic's dependency.
 *
 * Includes the id list (so a re-pointed dependency differs even if the text is
 * identical) and the chunk content (so an edited passage differs even when the
 * ids survive).
 */
export function computeTopicDependencyHash(chunkIds: readonly string[], chunks: DocumentChunk[]): string {
  const sorted = [...new Set(chunkIds)].sort()
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const present = sorted.filter((id) => byId.has(id))
  const content = computeDocumentContentFingerprint(
    present.map((id) => toSourceChunkFingerprint(byId.get(id)!)),
  )
  return fnv1a(`${sorted.join(',')}|${content}`)
}

/** Build a dependency from an already-trusted id list. */
export function buildTopicDependency(
  chunkIds: readonly string[],
  chunks: DocumentChunk[],
): TopicDependency {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const sourceChunkIds = [...new Set(chunkIds)].filter((id) => byId.has(id)).sort()
  const chapters = new Set<string>()
  const sections = new Set<string>()
  for (const id of sourceChunkIds) {
    const chunk = byId.get(id)!
    if (chunk.chapterId) chapters.add(chunk.chapterId)
    if (chunk.sectionId) sections.add(chunk.sectionId)
  }
  return {
    sourceChunkIds,
    sourceChapterIds: [...chapters].sort(),
    sourceSectionIds: [...sections].sort(),
    dependencyHash: computeTopicDependencyHash(sourceChunkIds, chunks),
  }
}

/**
 * Validate the model's `sourceChunkIds` against the candidate set for this run.
 *
 * Returns `null` when nothing usable remains. The caller must then mark the
 * topic `needsFullReanalysis` — never guess a dependency.
 */
export function validateTopicSourceChunks(
  raw: unknown,
  candidates: DocumentChunk[],
): TopicDependency | null {
  const allowed = new Set(candidates.map((chunk) => chunk.id))
  const accepted = new Set<string>()
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== 'string') continue
      const id = value.trim()
      if (allowed.has(id)) accepted.add(id)
    }
  }
  if (accepted.size === 0) return null
  return buildTopicDependency([...accepted], candidates)
}

/** Fingerprint of one chunk's content, used for relinking. */
export { chunkContentFingerprint }

/** Fingerprint per chunk id, as persisted on a topic. */
export function chunkFingerprintMap(
  chunks: readonly DocumentChunk[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const chunk of chunks) map[chunk.id] = chunkContentFingerprint(chunk)
  return map
}

export interface ChunkRelinkResult {
  /** Declared ids that still resolve (possibly re-pointed at a new chunk). */
  chunkIds: string[]
  /** How many were re-pointed by content. */
  relinked: number
  /** Declared ids that could not be resolved at all. */
  lost: string[]
}

/**
 * Resolve a topic's stored chunk ids against the chunks that exist now.
 *
 * Re-processing a document regenerates every chunk id, so an id being absent
 * does not by itself mean the passage changed. When the stored content
 * fingerprint matches a live chunk, the dependency is re-pointed at that chunk
 * instead of being declared lost — that is what keeps a re-processed textbook
 * from forcing a full re-analysis.
 */
export function relinkDeclaredChunks(
  declared: readonly string[],
  storedFingerprints: Readonly<Record<string, string>> | undefined,
  liveChunks: readonly DocumentChunk[],
): ChunkRelinkResult {
  const liveById = new Map(liveChunks.map((chunk) => [chunk.id, chunk]))
  const available = new Map<string, DocumentChunk[]>()
  for (const chunk of liveChunks) {
    const key = chunkContentFingerprint(chunk)
    const list = available.get(key) ?? []
    list.push(chunk)
    available.set(key, list)
  }

  const chunkIds: string[] = []
  const lost: string[] = []
  let relinked = 0

  for (const id of declared) {
    if (liveById.has(id)) {
      chunkIds.push(id)
      // Claim it so a later duplicate fingerprint cannot reuse the same chunk.
      const key = chunkContentFingerprint(liveById.get(id)!)
      const list = available.get(key)
      if (list) {
        const index = list.findIndex((chunk) => chunk.id === id)
        if (index >= 0) list.splice(index, 1)
      }
      continue
    }

    const fingerprint = storedFingerprints?.[id]
    const candidates = fingerprint ? available.get(fingerprint) : undefined
    const replacement = candidates?.shift()
    if (replacement) {
      chunkIds.push(replacement.id)
      relinked++
      continue
    }
    lost.push(id)
  }

  return { chunkIds, relinked, lost }
}

/** True when a stored topic carries a usable dependency. */
export function hasTrustedDependency(topic: {
  sourceChunkIds?: string[]
  needsFullReanalysis?: boolean
}): boolean {
  return !topic.needsFullReanalysis && Array.isArray(topic.sourceChunkIds) && topic.sourceChunkIds.length > 0
}

/**
 * Prompt label for one candidate chunk.
 *
 * The id is the only machine-readable part; the rest is human context the model
 * uses to decide which chunks a topic belongs to.
 */
export function buildCandidateChunkLabel(chunk: DocumentChunk): string {
  const parts = [
    chunk.chapterNumber ? `Ch ${chunk.chapterNumber}` : chunk.chapterTitle,
    chunk.sectionNumber ?? (chunk.section || undefined),
    chunk.pageNumber !== undefined ? `p${chunk.pageNumber}` : undefined,
  ].filter((part): part is string => Boolean(part))
  return [`c:${chunk.id}`, ...parts].join(' · ')
}
