import type { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import { resolveMaterialType, type LearningMaterialType } from '@/entities/document/types'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { overlapScore } from './classProgressService'

/**
 * Resolving a topic's grounding material.
 *
 * Shared by the lesson service and the interactive tutor so both read the same
 * chunks — the topic's own citations first, project documents only as a
 * fallback. Nothing is copied out of a chunk; callers keep the `chunkId` and
 * read the real text when they need to quote it.
 */

/** Chunks longer than this are skipped — they would crowd out the whole prompt. */
const MAX_SOURCE_CHARS = 1000
/** Shortest quote worth fuzzy-matching against chunk text. */
const MIN_QUOTE_CHARS = 12

export interface TopicSource {
  chunkId: string
  documentId: string
  /** Which learning material the chunk came from — drives prompt layering. */
  materialType: LearningMaterialType
  pageNumber?: number
  section?: string
  text: string
  /** Human-readable origin, e.g. `Derivatives · p12`. */
  label: string
}

export interface TopicSourceDeps {
  analyses: CourseAnalysisRepository
  chunks: ChunkRepository
}

/**
 * Loose quote↔chunk match. The analyser stores the excerpt it cited, so a
 * prefix comparison finds the chunk it came from even when the model trimmed
 * or reflowed the tail.
 */
export function quoteMatchesChunk(chunkText: string, quote: string): boolean {
  const needle = quote.trim().toLowerCase()
  if (needle.length < MIN_QUOTE_CHARS) return false
  const haystack = chunkText.toLowerCase()
  if (haystack.includes(needle)) return true
  return haystack.includes(needle.slice(0, 60))
}

export async function collectTopicSources(
  deps: TopicSourceDeps,
  projectId: string,
  topicId: string,
  limit: number,
): Promise<TopicSource[]> {
  if (limit <= 0) return []

  const analysis = await deps.analyses.getByProject(projectId)
  if (!analysis) return []
  const topic = await deps.analyses.getTopic(topicId)
  if (!topic) return []

  const out: TopicSource[] = []
  const seen = new Set<string>()
  const add = (chunk: DocumentChunk, label: string): boolean => {
    if (seen.has(chunk.id)) return false
    if (!chunk.text.trim() || chunk.text.length > MAX_SOURCE_CHARS) return false
    seen.add(chunk.id)
    out.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      materialType: resolveMaterialType(chunk.materialType),
      ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
      ...(chunk.section ? { section: chunk.section } : {}),
      text: chunk.text,
      label,
    })
    return out.length >= limit
  }

  // 1. The topic's own citations are authoritative.
  for (const ref of topic.sourceRefs ?? []) {
    const label = [topic.name, ref.section, ref.page !== undefined ? `p${ref.page}` : '']
      .filter(Boolean)
      .join(' · ')

    // An exact chunk id is the strongest signal (quiz citations carry one).
    if (ref.chunkId) {
      const chunk = await deps.chunks.get(ref.chunkId)
      if (chunk && add(chunk, label)) return out
      continue
    }

    if (!ref.documentId) continue
    const docChunks = await deps.chunks.listByDocument(ref.documentId)
    const candidates = ref.quote
      ? docChunks.filter((c) => quoteMatchesChunk(c.text, ref.quote!))
      : ref.page !== undefined
        ? docChunks.filter((c) => c.pageNumber === ref.page)
        : docChunks.slice(0, 2)

    for (const chunk of candidates) {
      if (add(chunk, label)) return out
    }
  }
  if (out.length > 0) return out

  // 2. Fall back to the project's documents so the tutor still has grounding.
  for (const id of analysis.documentIds) {
    const chunks = await deps.chunks.listByDocument(id)
    for (const c of chunks) {
      if (add(c, topic.name)) return out
    }
  }
  return out
}

/**
 * Pick the chunks of a given material type that are most relevant to a topic.
 *
 * Used for notes and transcripts, which are not tied to a topic's citations
 * the way the textbook is. Ranking is token overlap — deterministic and
 * explainable, with no embeddings (there are none in this project yet).
 */
export function rankContextChunks(
  chunks: DocumentChunk[],
  topicName: string,
  topicDescription: string,
  limit: number,
): DocumentChunk[] {
  if (chunks.length === 0 || limit <= 0) return []
  const query = `${topicName} ${topicDescription}`
  return chunks
    .map((chunk) => ({ chunk, score: overlapScore(query, chunk.text) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.chunk)
}

/**
 * Render sources for a prompt: `[label] text`.
 *
 * The snippet text is canonicalised before it reaches the model — Unicode maths
 * becomes LaTeX and Symbol-font Private Use Area code points are recovered —
 * so the model is never handed opaque glyphs it would echo back. The stored
 * chunk is untouched, so quiz/topic quote matching is unaffected.
 */
export function formatTopicSources(sources: TopicSource[]): string[] {
  return sources.map(
    (source) => `[${source.label}] ${normalizeMathNotation(source.text).text}`,
  )
}
