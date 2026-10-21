import { EXAM_SCOPE_KINDS, type ExamScope, type ExamScopeKind, type ExamTopic } from './types'
import type { SyllabusChunk } from './parse'
import { scopeKindOf } from './parse'

/**
 * Support for the AI exam-topic extraction (`syllabus-topics/v1`): the text
 * sent, and the validation of what comes back. A topic is kept only when its
 * text occurs in the document (whitespace normalised) — invented, reworded or
 * translated topics are dropped. The chunk and page are found locally.
 */

/** Characters of syllabus text sent in one request. */
export const SYLLABUS_PROMPT_CHARS = 60_000

const KEYWORD =
  /\b(?:topics?|exams?|examinations?|midterms?|semi-?finals?|finals?|questions|theses|tételek|themen|prüfung)\b|题目|考点|考试|复习|期中|期末/i
/** Chunks kept after a keyword chunk when the document is too long to send whole. */
const FOLLOWING_CHUNKS = 40

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The document text for the prompt, with page markers. A long document is cut
 * to the parts around exam / topic wording (topic lists often come last).
 */
export function syllabusPromptText(chunks: SyllabusChunk[], limit = SYLLABUS_PROMPT_CHARS): string {
  let selected = chunks
  const total = chunks.reduce((sum, chunk) => sum + chunk.text.length + 1, 0)
  if (total > limit) {
    const keep = new Set<number>()
    chunks.forEach((chunk, index) => {
      if (!KEYWORD.test(chunk.text)) return
      for (let i = index; i < Math.min(chunks.length, index + FOLLOWING_CHUNKS); i++) keep.add(i)
    })
    selected = keep.size > 0 ? chunks.filter((_, index) => keep.has(index)) : chunks
  }
  const lines: string[] = []
  let page: number | undefined
  let used = 0
  for (const chunk of selected) {
    if (chunk.pageNumber !== undefined && chunk.pageNumber !== page) {
      page = chunk.pageNumber
      lines.push(`--- page ${page} ---`)
    }
    if (used + chunk.text.length > limit) break
    used += chunk.text.length
    lines.push(chunk.text)
  }
  return lines.join('\n')
}

/** Whitespace-normalised document text with the chunk each character came from. */
function locate(chunks: SyllabusChunk[]): {
  text: string
  starts: Array<{ at: number; chunk: SyllabusChunk }>
} {
  let text = ''
  const starts: Array<{ at: number; chunk: SyllabusChunk }> = []
  for (const chunk of chunks) {
    const piece = collapse(chunk.text)
    if (!piece) continue
    if (text) text += ' '
    starts.push({ at: text.length, chunk })
    text += piece
  }
  return { text, starts }
}

function chunkAt(starts: Array<{ at: number; chunk: SyllabusChunk }>, offset: number) {
  let found = starts[0]?.chunk
  for (const entry of starts) {
    if (entry.at > offset) break
    found = entry.chunk
  }
  return found
}

/**
 * Validate the model's scopes against the document. Returns only topics that
 * occur verbatim (whitespace normalised); scopes left empty are dropped.
 */
export function readAiSyllabus(
  output: unknown,
  chunks: SyllabusChunk[],
  newId: () => string = () => crypto.randomUUID(),
): { scopes: ExamScope[]; dropped: number } {
  const { text, starts } = locate(chunks)
  const list =
    output && typeof output === 'object' ? (output as { scopes?: unknown }).scopes : undefined
  const scopes: ExamScope[] = []
  let dropped = 0
  if (!Array.isArray(list)) return { scopes, dropped }
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const { label, kind, topics } = raw as { label?: unknown; kind?: unknown; topics?: unknown }
    if (!Array.isArray(topics)) continue
    const name = typeof label === 'string' ? collapse(label).slice(0, 120) : ''
    const seen = new Set<string>()
    const kept: ExamTopic[] = []
    for (const item of topics) {
      if (typeof item !== 'string') {
        dropped++
        continue
      }
      const topic = collapse(item)
      const at = topic.length >= 2 ? text.indexOf(topic) : -1
      if (at < 0) {
        dropped++
        continue
      }
      if (seen.has(topic)) continue
      seen.add(topic)
      const chunk = chunkAt(starts, at)
      kept.push({
        id: newId(),
        text: topic,
        order: kept.length,
        ...(chunk ? { sourceChunkId: chunk.id } : {}),
        ...(chunk?.pageNumber !== undefined ? { page: chunk.pageNumber } : {}),
        source: 'ai',
      })
    }
    if (kept.length === 0) continue
    const resolvedKind: ExamScopeKind = EXAM_SCOPE_KINDS.includes(kind as ExamScopeKind)
      ? (kind as ExamScopeKind)
      : scopeKindOf(name)
    scopes.push({ id: newId(), label: name, kind: resolvedKind, topics: kept })
  }
  return { scopes, dropped }
}
