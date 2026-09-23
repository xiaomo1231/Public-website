/**
 * Stable Topic identity.
 *
 * A full re-analysis regenerates the whole analysis. Historically that handed
 * out a brand-new UUID for every topic, which silently orphaned everything that
 * references a topic by id:
 *
 *   TutorLesson.topicId · TutorSession.topicId · PracticeQuestion.topicId
 *   Question.topicId · Quiz.config.topicId · CourseContext.lectureLinks[].topicId
 *
 * This module decides which *new* topic is the same teaching topic as a stored
 * one, so the stored id can be reused. It is a pure function: no storage, no AI.
 *
 * ## Rules (conservative, one-to-one)
 *
 * 1. same `sectionId` + normalised name
 * 2. same `chapterId` + normalised name
 * 3. both sides have **trusted** `sourceChunkIds` → source-chunk overlap
 * 4. same name but position and dependencies both unclear → `ambiguous`:
 *    do **not** reuse the id; create a new topic and leave the old one alone
 * 5. an old id may be consumed by at most one new topic
 *
 * The topic name is only ever a *matching key*, never an identity. Every
 * decision carries a machine-readable `reason` so the behaviour is testable.
 */

export type TopicMatchReason =
  | 'section-name'
  | 'chapter-name'
  | 'source-overlap'
  | 'ambiguous'
  | 'new'

export interface TopicIdentityCandidate {
  name: string
  chapterId?: string
  sectionId?: string
  /**
   * Locally validated chunk dependencies. `undefined` / empty means the
   * dependency is *not trusted* and must not be used for matching.
   */
  sourceChunkIds?: string[]
}

export interface PreviousTopicIdentity extends TopicIdentityCandidate {
  id: string
}

export interface TopicMatchDiagnostic {
  /** Index into the `next` array. */
  index: number
  name: string
  reason: TopicMatchReason
  matchedTopicId?: string
  detail?: string
}

export interface TopicMatchResult {
  /** Parallel to `next`. `undefined` means "allocate a new id". */
  ids: Array<string | undefined>
  diagnostics: TopicMatchDiagnostic[]
}

/**
 * Normalise a topic name for *matching only*: NFKC, lowercase, punctuation and
 * symbol runs collapsed to single spaces. Two names are "the same" when this
 * produces the same string.
 */
export function normalizeTopicName(name: string): string {
  return (name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim()
}

/** Overlap relative to the smaller set — 1 means one set contains the other. */
export function sourceOverlapRatio(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let shared = 0
  for (const id of setA) if (setB.has(id)) shared++
  return shared / Math.min(setA.size, setB.size)
}

/** Minimum source overlap before we trust it as an identity signal. */
export const MIN_SOURCE_OVERLAP = 0.5

function trustedChunks(candidate: TopicIdentityCandidate): string[] | undefined {
  const ids = candidate.sourceChunkIds
  return ids && ids.length > 0 ? ids : undefined
}

export function matchTopicIdentities(
  previous: readonly PreviousTopicIdentity[],
  next: readonly TopicIdentityCandidate[],
): TopicMatchResult {
  const consumed = new Set<string>()
  const ids: Array<string | undefined> = new Array(next.length).fill(undefined)
  const diagnostics: TopicMatchDiagnostic[] = []

  const takeFirst = (
    predicate: (prev: PreviousTopicIdentity) => boolean,
  ): PreviousTopicIdentity | undefined => {
    for (const candidate of previous) {
      if (consumed.has(candidate.id)) continue
      if (predicate(candidate)) return candidate
    }
    return undefined
  }

  // Pass 1 — same section + same normalised name.
  next.forEach((topic, index) => {
    if (!topic.sectionId) return
    const name = normalizeTopicName(topic.name)
    if (!name) return
    const match = takeFirst(
      (prev) =>
        prev.sectionId === topic.sectionId && normalizeTopicName(prev.name) === name,
    )
    if (!match) return
    consumed.add(match.id)
    ids[index] = match.id
    diagnostics.push({
      index,
      name: topic.name,
      reason: 'section-name',
      matchedTopicId: match.id,
    })
  })

  // Pass 2 — same chapter + same normalised name.
  next.forEach((topic, index) => {
    if (ids[index] !== undefined || !topic.chapterId) return
    const name = normalizeTopicName(topic.name)
    if (!name) return
    const match = takeFirst(
      (prev) =>
        prev.chapterId === topic.chapterId && normalizeTopicName(prev.name) === name,
    )
    if (!match) return
    consumed.add(match.id)
    ids[index] = match.id
    diagnostics.push({
      index,
      name: topic.name,
      reason: 'chapter-name',
      matchedTopicId: match.id,
    })
  })

  // Pass 3 — source-chunk overlap, but only when BOTH sides have trusted
  // dependencies. This is what recognises a topic whose chapter/section id was
  // re-issued by the structure reconciliation.
  next.forEach((topic, index) => {
    if (ids[index] !== undefined) return
    const nextChunks = trustedChunks(topic)
    if (!nextChunks) return
    let best: { prev: PreviousTopicIdentity; ratio: number } | undefined
    for (const candidate of previous) {
      if (consumed.has(candidate.id)) continue
      const prevChunks = trustedChunks(candidate)
      if (!prevChunks) continue
      const ratio = sourceOverlapRatio(nextChunks, prevChunks)
      if (ratio < MIN_SOURCE_OVERLAP) continue
      if (!best || ratio > best.ratio) best = { prev: candidate, ratio }
    }
    if (!best) return
    consumed.add(best.prev.id)
    ids[index] = best.prev.id
    diagnostics.push({
      index,
      name: topic.name,
      reason: 'source-overlap',
      matchedTopicId: best.prev.id,
      detail: `overlap=${best.ratio.toFixed(3)}`,
    })
  })

  // Pass 4 — anything left over is either an honest new topic, or an ambiguous
  // same-name match we refuse to guess about.
  next.forEach((topic, index) => {
    if (ids[index] !== undefined) return
    const name = normalizeTopicName(topic.name)
    const sameName = name
      ? previous.find((prev) => normalizeTopicName(prev.name) === name)
      : undefined
    if (sameName) {
      diagnostics.push({
        index,
        name: topic.name,
        reason: 'ambiguous',
        detail: `same name as topic ${sameName.id} but position and dependencies are unclear`,
      })
      return
    }
    diagnostics.push({ index, name: topic.name, reason: 'new' })
  })

  return { ids, diagnostics }
}
