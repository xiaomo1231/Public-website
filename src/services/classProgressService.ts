import type { ClassProgress, LectureChunkLink } from '@/entities/courseContext/types'

/**
 * Class progress from a lecture transcript.
 *
 * Deliberately deterministic and explainable: a transcript chunk advances
 * progress only when its wording actually overlaps a topic's name/description.
 * There are no embeddings in this project yet, so we do not pretend to have
 * them — and an ambiguous chunk is left `unmatched` rather than guessed at.
 *
 * Progress is measured against *topics the transcript covers*, never against
 * the textbook's length, because a professor may skip, repeat or reorder.
 */

export interface ProgressTopic {
  id: string
  name: string
  description?: string
  chapterId?: string
  sectionId?: string
  chapterNumber?: string
  sectionNumber?: string
  chapterTitle?: string
  sectionTitle?: string
}

export interface ProgressChunk {
  id: string
  documentId: string
  text: string
}

export interface ClassProgressResult {
  links: LectureChunkLink[]
  progress: ClassProgress
}

/** Below this overlap a chunk is treated as unmatched, not as evidence. */
const MIN_CONFIDENCE = 0.34
/** At least this many topic keywords must appear, unless the name appears verbatim. */
const MIN_KEYWORD_HITS = 2

/** Latin words (≥3 chars) plus CJK bigrams — enough for course terminology. */
export function tokenize(text: string): string[] {
  const lower = (text ?? '').toLowerCase()
  const latin = lower.match(/[a-z0-9]{3,}/g) ?? []
  const tokens = new Set<string>(latin)
  for (const run of lower.replace(/[^\u4e00-\u9fff]+/g, ' ').split(/\s+/)) {
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2))
    if (run.length === 1) tokens.add(run)
  }
  return [...tokens]
}

function keywordsFor(topic: ProgressTopic): string[] {
  return [...new Set(tokenize(`${topic.name} ${topic.description ?? ''}`))]
}

/** Token overlap relative to the smaller set, so short notes still match. */
export function overlapScore(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const token of setA) if (setB.has(token)) shared++
  return shared / Math.min(setA.size, setB.size)
}

export interface TopicMatch {
  topicId: string
  confidence: number
}

/** Best topic for one transcript chunk, or null when nothing overlaps enough. */
export function matchChunkToTopic(
  chunkText: string,
  topics: ProgressTopic[],
): TopicMatch | null {
  const lowerChunk = (chunkText ?? '').toLowerCase()
  let best: TopicMatch | null = null

  for (const topic of topics) {
    const keywords = keywordsFor(topic)
    if (keywords.length === 0) continue

    const nameAppears = lowerChunk.includes(topic.name.toLowerCase().trim())
    const hits = keywords.filter((keyword) => lowerChunk.includes(keyword)).length
    if (!nameAppears && hits < MIN_KEYWORD_HITS) continue

    const confidence = nameAppears ? 1 : hits / keywords.length
    if (confidence < MIN_CONFIDENCE) continue
    if (!best || confidence > best.confidence) best = { topicId: topic.id, confidence }
  }

  return best
}

/**
 * Walk the transcript in order, match each chunk to a topic, and derive the
 * class's current position. `topics` must be in course order.
 */
export function computeClassProgress(input: {
  topics: ProgressTopic[]
  transcriptChunks: ProgressChunk[]
  transcriptDocumentIds: string[]
}): ClassProgressResult {
  const { topics, transcriptChunks, transcriptDocumentIds } = input
  const orderOf = new Map(topics.map((topic, index) => [topic.id, index]))

  const links: LectureChunkLink[] = []
  const covered = new Set<string>()
  let currentTopicId: string | undefined
  let lastMatchedTranscriptChunkId: string | undefined
  let currentChapter: ProgressTopic | undefined

  for (const chunk of transcriptChunks) {
    const match = matchChunkToTopic(chunk.text, topics)
    if (!match) continue
    links.push({
      transcriptChunkId: chunk.id,
      textbookChunkId: '',
      topicId: match.topicId,
      confidence: match.confidence,
    })
    covered.add(match.topicId)
    currentTopicId = match.topicId
    currentChapter = topics.find((topic) => topic.id === match.topicId)
    lastMatchedTranscriptChunkId = chunk.id
  }

  const currentIndex = currentTopicId !== undefined ? (orderOf.get(currentTopicId) ?? -1) : -1
  const completedTopicIds =
    currentIndex >= 0
      ? topics.filter((topic, index) => covered.has(topic.id) && index < currentIndex).map((t) => t.id)
      : []

  const progress: ClassProgress = {
    transcriptDocumentIds,
    completedTopicIds,
    updatedAt: Date.now(),
    ...(currentTopicId ? { currentTopicId } : {}),
    ...(currentTopicId
      ? { currentTopicName: topics.find((t) => t.id === currentTopicId)?.name }
      : {}),
    ...(currentChapter?.chapterId ? { currentChapterId: currentChapter.chapterId } : {}),
    ...(currentChapter?.sectionId ? { currentSectionId: currentChapter.sectionId } : {}),
    ...(currentChapter?.chapterNumber
      ? { currentChapterNumber: currentChapter.chapterNumber }
      : {}),
    ...(currentChapter?.sectionNumber
      ? { currentSectionNumber: currentChapter.sectionNumber }
      : {}),
    ...(currentChapter?.chapterTitle ? { currentChapterTitle: currentChapter.chapterTitle } : {}),
    ...(currentChapter?.sectionTitle ? { currentSectionTitle: currentChapter.sectionTitle } : {}),
    ...(lastMatchedTranscriptChunkId ? { lastMatchedTranscriptChunkId } : {}),
    // No confident match means "we cannot say" — not 0%.
    ...(covered.size > 0 && topics.length > 0
      ? { progressPercent: Math.round((covered.size / topics.length) * 100) }
      : {}),
  }

  return { links, progress }
}
