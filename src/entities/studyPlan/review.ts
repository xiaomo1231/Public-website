import { matchTokens } from '@/entities/syllabus/match'

/**
 * 复习提纲 — a review sheet for one planned exam: the topics in its scope
 * (most marks × weakest first), each with a short summary, key formulas and
 * definitions, typical question types and the student's common mistakes.
 *
 * Every claim cites the course chunks it rests on. The model only sees short
 * per-request aliases (`c1`, `m1`); a claim whose aliases are not among the
 * chunks sent is dropped, the same rule as the other source-grounded features.
 * Generation is one request per topic (see `examReviewService.ts`); each
 * topic is stored as soon as it is done. Pure types and helpers here.
 */

export type ReviewSectionStatus = 'pending' | 'generating' | 'done' | 'failed'

export type ReviewStatus = 'draft' | 'generating' | 'paused' | 'partial' | 'ready'

export interface ReviewCitation {
  chunkId: string
  documentId: string
  documentName: string
  page?: number
}

/** One sentence or item of the sheet and the chunks it rests on (at least one). */
export interface ReviewClaim {
  text: string
  sources: string[]
}

export type ReviewPointKind = 'formula' | 'definition' | 'fact'

export interface ReviewKeyPoint extends ReviewClaim {
  kind: ReviewPointKind
}

/** A common mistake, grounded in the student's own mistake records. */
export interface ReviewMistakeNote {
  text: string
  mistakeIds: string[]
}

export interface ReviewSection {
  id: string
  /** Course topic id, or `exam:<id>` for an exam topic no course topic covers. */
  topicId?: string
  title: string
  order: number
  /** Marks share × weakness (the order of the sheet). */
  priority: number
  /** Mastery estimate when planned (0–1), null without practice. */
  mastery: number | null
  status: ReviewSectionStatus
  error?: string
  summary?: ReviewClaim[]
  keyPoints?: ReviewKeyPoint[]
  questionTypes?: ReviewClaim[]
  mistakes?: ReviewMistakeNote[]
  /** The cited chunks (id → where it is), for the 出处 links. */
  citations?: Record<string, ReviewCitation>
  /** Claims dropped because no citation could be verified. */
  dropped?: number
  generatedAt?: number
}

export interface ExamReview {
  status: ReviewStatus
  /** The language key the sheet is written in (`zh_terms`, `en`, `exam:de`…). */
  language: string
  promptVersion: string
  createdAt: number
  updatedAt: number
  sections: ReviewSection[]
}

/** Topics on one sheet. */
export const REVIEW_MAX_TOPICS = 15
/** Chunks sent per topic, and characters per chunk. */
export const REVIEW_CHUNKS_PER_TOPIC = 8
export const REVIEW_CHUNK_CHARS = 1500
/** Open mistakes sent per topic. */
export const REVIEW_MISTAKES_PER_TOPIC = 5
/** Reading time of one topic of the sheet (the plan task). */
export const REVIEW_SHEET_MINUTES = 10
/** Rough sizes for the estimate shown before generating. */
const SYSTEM_TOKENS = 900
const OUTPUT_TOKENS_PER_TOPIC = 1200

export function reviewStatus(sections: readonly ReviewSection[]): ReviewStatus {
  if (sections.length === 0) return 'draft'
  if (sections.some((s) => s.status === 'generating')) return 'generating'
  if (sections.every((s) => s.status === 'done')) return 'ready'
  if (sections.every((s) => s.status === 'pending')) return 'draft'
  if (sections.some((s) => s.status === 'pending')) return 'paused'
  return 'partial'
}

export interface ReviewTopicInput {
  id: string
  name: string
  mastery: number | null
  /** Share of past-paper marks (0–1), when known. */
  marksShare?: number
  openMistakes: number
}

/**
 * The sheet's topics: marks share × weakness first (the scheduler's measure),
 * at most `REVIEW_MAX_TOPICS`.
 */
export function planReviewSections(topics: readonly ReviewTopicInput[]): ReviewSection[] {
  const n = Math.max(1, topics.length)
  const scored = topics.map((topic) => {
    const share = topic.marksShare ?? 1 / n
    const weakness = 1 - (topic.mastery ?? 0.5)
    return { topic, priority: share * n * weakness + 0.1 * Math.min(5, topic.openMistakes) }
  })
  scored.sort((a, b) => b.priority - a.priority || a.topic.name.localeCompare(b.topic.name, 'en'))
  return scored.slice(0, REVIEW_MAX_TOPICS).map(({ topic, priority }, i) => ({
    id: `s${i + 1}`,
    topicId: topic.id,
    title: topic.name,
    order: i,
    priority: Math.round(priority * 1000) / 1000,
    mastery: topic.mastery,
    status: 'pending',
  }))
}

export interface ReviewEstimate {
  requests: number
  inputTokens: number
  outputTokens: number
}

/** Requests and tokens before anything is generated (sections not done yet). */
export function estimateReview(
  sections: readonly Pick<ReviewSection, 'status'>[],
  inputCharsPerTopic = REVIEW_CHUNKS_PER_TOPIC * 900,
): ReviewEstimate {
  const todo = sections.filter((s) => s.status !== 'done').length
  return {
    requests: todo,
    inputTokens: todo * (SYSTEM_TOKENS + Math.round(inputCharsPerTopic / 3)),
    outputTokens: todo * OUTPUT_TOKENS_PER_TOPIC,
  }
}

export interface ChunkCandidate {
  id: string
  documentId: string
  documentName: string
  page?: number
  text: string
  order: number
}

/**
 * The chunks one topic is written from: its own validated source chunks
 * first, then the candidates (the exam's materials, else the course) that
 * share the most words with the topic name and its concepts. Deterministic.
 */
export function selectReviewChunks(
  topic: { name: string; description?: string; concepts?: string[]; sourceChunkIds?: string[] },
  candidates: readonly ChunkCandidate[],
  limit = REVIEW_CHUNKS_PER_TOPIC,
): ChunkCandidate[] {
  const byId = new Map(candidates.map((chunk) => [chunk.id, chunk]))
  const out: ChunkCandidate[] = []
  for (const id of topic.sourceChunkIds ?? []) {
    const chunk = byId.get(id)
    if (chunk && !out.includes(chunk)) out.push(chunk)
    if (out.length >= Math.ceil(limit / 2)) break
  }
  const wanted = new Set(
    matchTokens([topic.name, ...(topic.concepts ?? []).slice(0, 12)].join(' ')),
  )
  if (wanted.size > 0) {
    const scored = candidates
      .filter((chunk) => !out.includes(chunk))
      .map((chunk) => {
        const tokens = matchTokens(chunk.text.slice(0, 4000))
        let hits = 0
        for (const token of tokens) if (wanted.has(token)) hits += 1
        return { chunk, hits }
      })
      .filter((row) => row.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.chunk.order - b.chunk.order)
    for (const row of scored) {
      if (out.length >= limit) break
      out.push(row.chunk)
    }
  }
  return out
}

// ── validating a reply ──────────────────────────────────────────────────

const MAX_ITEMS = 8
const MAX_TEXT = 600

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+\n/g, '\n').slice(0, MAX_TEXT) : ''
}

function aliasesOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list
    .filter((each): each is string => typeof each === 'string')
    .map((each) =>
      each
        .trim()
        .replace(/^\[|\]$/g, '')
        .replace(/^chunk:/i, ''),
    )
}

export interface ValidatedReview {
  summary: ReviewClaim[]
  keyPoints: ReviewKeyPoint[]
  questionTypes: ReviewClaim[]
  mistakes: ReviewMistakeNote[]
  /** Chunk ids actually cited. */
  cited: string[]
  dropped: number
}

/**
 * Keep what the reply can back up: every claim must cite at least one chunk
 * alias that was sent (unknown aliases are dropped; a claim left without one
 * is dropped), every mistake note at least one mistake alias that was sent.
 * Duplicate texts are kept once. Throws nothing: an empty result is the
 * caller's to reject.
 */
export function validateReviewReply(
  raw: unknown,
  chunkAliases: ReadonlyMap<string, string>,
  mistakeAliases: ReadonlyMap<string, string>,
): ValidatedReview {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  let dropped = 0
  const cited = new Set<string>()
  const seen = new Set<string>()
  const claim = (item: unknown): ReviewClaim | null => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const text = str(row.text ?? row.statement ?? row.point)
    if (!text) return null
    const sources = [
      ...new Set(
        aliasesOf(row.sources ?? row.source ?? row.cite)
          .map((alias) => chunkAliases.get(alias))
          .filter((id): id is string => !!id),
      ),
    ]
    if (sources.length === 0) {
      dropped += 1
      return null
    }
    const key = text.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    for (const id of sources) cited.add(id)
    return { text, sources }
  }
  const list = (value: unknown): unknown[] =>
    Array.isArray(value) ? value.slice(0, MAX_ITEMS) : []

  const summary = list(obj.summary)
    .map(claim)
    .filter((c): c is ReviewClaim => !!c)
  const keyPoints: ReviewKeyPoint[] = []
  for (const item of list(obj.keyPoints ?? obj.key_points)) {
    const base = claim(item)
    if (!base) continue
    const kind = (item as { kind?: unknown }).kind
    keyPoints.push({
      ...base,
      kind: kind === 'formula' || kind === 'definition' ? kind : 'fact',
    })
  }
  const questionTypes = list(obj.questionTypes ?? obj.question_types)
    .map(claim)
    .filter((c): c is ReviewClaim => !!c)
  const mistakes: ReviewMistakeNote[] = []
  for (const item of list(obj.commonMistakes ?? obj.mistakes)) {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const text = str(row.text)
    if (!text) continue
    const ids = [
      ...new Set(
        aliasesOf(row.mistakes ?? row.mistakeIds ?? row.from)
          .map((alias) => mistakeAliases.get(alias))
          .filter((id): id is string => !!id),
      ),
    ]
    if (ids.length === 0) {
      dropped += 1
      continue
    }
    mistakes.push({ text, mistakeIds: ids })
  }
  return { summary, keyPoints, questionTypes, mistakes, cited: [...cited], dropped }
}

/** True when a validated reply has anything to show. */
export function hasReviewContent(reply: ValidatedReview): boolean {
  return reply.summary.length + reply.keyPoints.length + reply.questionTypes.length > 0
}

export interface ReviewMarkdownLabels {
  summary: string
  keyPoints: string
  questionTypes: string
  mistakes: string
  formula: string
  definition: string
  sources: string
}

/** One topic as Markdown (print / PDF), with its sources as "file p. n". */
export function reviewSectionMarkdown(
  section: ReviewSection,
  labels: ReviewMarkdownLabels,
): string {
  const cite = (claim: ReviewClaim): string => {
    const places = claim.sources
      .map((id) => section.citations?.[id])
      .filter((c): c is ReviewCitation => !!c)
      .map((c) => (c.page ? `${c.documentName} p. ${c.page}` : c.documentName))
    return places.length > 0 ? ` _(${[...new Set(places)].join('; ')})_` : ''
  }
  const out: string[] = []
  if (section.summary?.length) {
    out.push(`**${labels.summary}**`, '', section.summary.map((c) => c.text + cite(c)).join(' '))
  }
  if (section.keyPoints?.length) {
    out.push('', `**${labels.keyPoints}**`, '')
    for (const point of section.keyPoints) {
      const tag =
        point.kind === 'formula'
          ? `${labels.formula}: `
          : point.kind === 'definition'
            ? `${labels.definition}: `
            : ''
      out.push(`- ${tag}${point.text}${cite(point)}`)
    }
  }
  if (section.questionTypes?.length) {
    out.push('', `**${labels.questionTypes}**`, '')
    for (const item of section.questionTypes) out.push(`- ${item.text}${cite(item)}`)
  }
  if (section.mistakes?.length) {
    out.push('', `**${labels.mistakes}**`, '')
    for (const item of section.mistakes) out.push(`- ${item.text}`)
  }
  return out.join('\n').trim()
}

/** The plan task id of a sheet topic. */
export function reviewSheetRef(examId: string, sectionId: string): string {
  return `review:${examId}:${sectionId}`
}

/** `{ examId, sectionId }` of a sheet task's `refId`. */
export function parseReviewSheetRef(
  refId: string | undefined,
): { examId: string; sectionId: string } | null {
  const match = /^review:([^:]+):(.+)$/.exec(refId ?? '')
  return match ? { examId: match[1]!, sectionId: match[2]! } : null
}
