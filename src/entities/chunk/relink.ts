import type { DocumentChunk } from './types'
import {
  computeDocumentContentFingerprint,
  type SourceChunkFingerprint,
} from '../courseContent/sourceHash'

/**
 * Re-pointing a stored chunk reference at the chunk that replaced it.
 *
 * Re-processing a document regenerates **every** chunk id, so an id being
 * absent says nothing about whether the passage changed. Every entity that
 * stores a `chunkId` (topic dependencies, note links, lecture links, professor
 * practice questions) records a content fingerprint next to it, and relinks by
 * matching that fingerprint against the chunks that exist now.
 *
 * Pure: no storage, no AI. The caller decides when (and whether) to persist.
 */

/** A chunk as it contributes to a content fingerprint. */
export function toSourceChunkFingerprint(chunk: DocumentChunk): SourceChunkFingerprint {
  return {
    order: chunk.order,
    text: chunk.text,
    ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
    ...(chunk.chapterId ? { chapterId: chunk.chapterId } : {}),
    ...(chunk.sectionId ? { sectionId: chunk.sectionId } : {}),
  }
}

/** Fingerprint of one chunk's content. */
export function chunkContentFingerprint(chunk: DocumentChunk): string {
  return computeDocumentContentFingerprint([toSourceChunkFingerprint(chunk)])
}

/** A stored reference to a chunk, plus the fingerprint recorded with it. */
export interface ChunkReference {
  chunkId?: string
  fingerprint?: string
}

export interface RelinkedChunkReference {
  /** Resolved chunk id — unchanged, re-pointed, or the original when lost. */
  chunkId: string
  /** Fingerprint to persist alongside the resolved id. */
  fingerprint?: string
  /** True when the id was re-pointed at a replacement chunk. */
  relinked: boolean
  /** The id this reference used before relinking (traceability). */
  previousChunkId?: string
  /** True when no replacement could be found; the old reference is kept. */
  needsRelink: boolean
  /** Machine-readable reason, only set when `needsRelink`. */
  relinkReason?: string
}

export interface ChunkRelinkIndex {
  live: Map<string, DocumentChunk>
  byFingerprint: Map<string, DocumentChunk[]>
}

/** Build the lookup tables once, then relink as many references as needed. */
export function buildChunkRelinkIndex(chunks: readonly DocumentChunk[]): ChunkRelinkIndex {
  const live = new Map<string, DocumentChunk>()
  const byFingerprint = new Map<string, DocumentChunk[]>()
  for (const chunk of chunks) {
    live.set(chunk.id, chunk)
    const key = chunkContentFingerprint(chunk)
    const list = byFingerprint.get(key) ?? []
    list.push(chunk)
    byFingerprint.set(key, list)
  }
  return { live, byFingerprint }
}

/**
 * Resolve one reference.
 *
 * Returns `undefined` when the reference has no chunk id at all (nothing to
 * relink, and nothing to flag).
 */
export function relinkChunkReference(
  reference: ChunkReference,
  index: ChunkRelinkIndex,
): RelinkedChunkReference | undefined {
  const chunkId = reference.chunkId
  if (!chunkId) return undefined

  const liveChunk = index.live.get(chunkId)
  if (liveChunk) {
    return {
      chunkId,
      fingerprint: chunkContentFingerprint(liveChunk),
      relinked: false,
      needsRelink: false,
    }
  }

  const candidates = reference.fingerprint
    ? index.byFingerprint.get(reference.fingerprint)
    : undefined
  const replacement = candidates?.shift()
  if (replacement) {
    return {
      chunkId: replacement.id,
      fingerprint: reference.fingerprint,
      relinked: true,
      previousChunkId: chunkId,
      needsRelink: false,
    }
  }

  // Keep the original reference; a human can review it. Never silently drop it.
  return {
    chunkId,
    ...(reference.fingerprint ? { fingerprint: reference.fingerprint } : {}),
    relinked: false,
    needsRelink: true,
    relinkReason: reference.fingerprint
      ? 'source-chunk-replaced-without-match'
      : 'source-chunk-missing',
  }
}
