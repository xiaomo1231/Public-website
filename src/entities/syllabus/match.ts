import type { ExamTopic } from './types'

/**
 * Matching exam topics to course topics.
 *
 * Local matching is deterministic token overlap: text is folded (case,
 * accents), split into words (CJK into character pairs), common and
 * boiler-plate words are dropped and the rest are reduced to rough stems so
 * Latin / English variants meet ("vertebra", "vertebrae", "vertebral";
 * "thorax", "thoracic"). The score rewards both an exam topic largely found in
 * a course topic's name and a name largely found in the exam topic; the
 * description adds a smaller share.
 */

export interface MatchableTopic {
  id: string
  name: string
  description?: string
}

/** A course topic is matched at or above this score. */
export const MATCH_THRESHOLD = 0.45
/** Course topics kept per exam topic. */
export const MAX_MATCHES = 3
/** Runner-ups within this share of the best score are kept too. */
const RUNNER_UP_SHARE = 0.8

const STOPWORDS = new Set(
  [
    // English function words
    'a an and or of the to in on at by for with without from into upon its it their them they this that these those',
    'is are be as via vs together including include includes concerned acting act over under between within',
    // Boiler-plate of topic lists
    'general gross anatomy structure structures component components classification overview introduction basic basics',
    'principle principles part parts topic topics chapter section lecture relevance relevence relevant other further',
    // Latin / German / Hungarian particles
    'et de der die das und von mit im és az a egy',
  ]
    .join(' ')
    .split(/\s+/),
)

/** Lower-case, strip accents. */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

const SUFFIXES = [
  'ations',
  'ation',
  'itis',
  'ities',
  'ity',
  'ial',
  'ies',
  'ium',
  'ous',
  'ic',
  'ae',
  'al',
  'ar',
  'es',
  'is',
  'us',
  'um',
  'a',
  'e',
  's',
  'y',
]

/** A rough stem: enough to meet singular / plural and noun / adjective forms. */
export function stem(word: string): string {
  let w = word
  // thorax → thorac (thoracic), cortex → cortic (cortical), helix → helic.
  if (/[aei]x$/.test(w) && w.length > 4)
    w = `${w.slice(0, -2)}${w.at(-2) === 'e' ? 'i' : w.at(-2)}c`
  for (const suffix of SUFFIXES) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length)
      break
    }
  }
  return w
}

/** Content tokens of a text, stemmed. CJK runs become character pairs. */
export function matchTokens(text: string): string[] {
  const out: string[] = []
  for (const piece of fold(text).match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(piece)) {
      const chars = [...piece]
      if (chars.length === 1) out.push(piece)
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!)
      continue
    }
    if (piece.length < 3 || /^\d+$/.test(piece) || STOPWORDS.has(piece)) continue
    out.push(stem(piece))
  }
  return [...new Set(out)]
}

function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true
  // A shared stem of at least five letters ("osteofibr…", "intercost…").
  const shorter = a.length <= b.length ? a : b
  const longer = shorter === a ? b : a
  return shorter.length >= 5 && longer.startsWith(shorter)
}

function share(from: string[], into: string[]): number {
  if (from.length === 0) return 0
  return (
    from.filter((token) => into.some((other) => tokenMatches(token, other))).length / from.length
  )
}

/** 0–1 similarity of an exam topic to a course topic. */
export function matchScore(examText: string, topic: MatchableTopic): number {
  const exam = matchTokens(examText)
  const name = matchTokens(topic.name)
  if (exam.length === 0 || name.length === 0) return 0
  const nameScore = (share(exam, name) + share(name, exam)) / 2
  const description = topic.description ? matchTokens(topic.description) : []
  const descriptionScore = description.length > 0 ? share(exam, description) : 0
  return Math.min(1, Math.max(nameScore, 0.75 * nameScore + 0.25 * descriptionScore))
}

/** The course topics that cover an exam topic, best first (may be empty). */
export function matchExamTopic(examText: string, topics: MatchableTopic[]): string[] {
  const scored = topics
    .map((topic) => ({ id: topic.id, score: matchScore(examText, topic) }))
    .filter((entry) => entry.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
  const best = scored[0]?.score ?? 0
  return scored
    .filter((entry) => entry.score >= best * RUNNER_UP_SHARE)
    .slice(0, MAX_MATCHES)
    .map((entry) => entry.id)
}

/**
 * Re-match a list locally. An AI match whose course topics all still exist is
 * kept; everything else is matched again from the text.
 */
export function rematchLocally(examTopics: ExamTopic[], topics: MatchableTopic[]): ExamTopic[] {
  const known = new Set(topics.map((topic) => topic.id))
  return examTopics.map((item) => {
    if (
      item.matchedBy === 'ai' &&
      item.topicIds?.length &&
      item.topicIds.every((id) => known.has(id))
    )
      return item
    const ids = matchExamTopic(item.text, topics)
    const rest: ExamTopic = { ...item }
    delete rest.topicIds
    delete rest.matchedBy
    return ids.length > 0 ? { ...rest, topicIds: ids, matchedBy: 'local' as const } : rest
  })
}

/**
 * Validate a closed-set AI match: only exam topics that were asked about and
 * only course topic ids from the list offered are kept (at most
 * `MAX_MATCHES`, no duplicates). Anything else is dropped.
 */
export function readAiMatches(
  output: unknown,
  askedExamIds: string[],
  topicIds: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const asked = new Set(askedExamIds)
  const allowed = new Set(topicIds)
  const list =
    output && typeof output === 'object' ? (output as { matches?: unknown }).matches : undefined
  if (!Array.isArray(list)) return result
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const { examTopicId, topicIds: ids } = item as { examTopicId?: unknown; topicIds?: unknown }
    if (typeof examTopicId !== 'string' || !asked.has(examTopicId) || result.has(examTopicId))
      continue
    if (!Array.isArray(ids)) continue
    const valid = [
      ...new Set(ids.filter((id): id is string => typeof id === 'string' && allowed.has(id))),
    ]
    result.set(examTopicId, valid.slice(0, MAX_MATCHES))
  }
  return result
}

/** Fingerprint of the course topics a match was computed against. */
export function topicsFingerprint(topics: MatchableTopic[]): string {
  return topics
    .map((topic) => `${topic.id}:${topic.name}`)
    .sort()
    .join('|')
}
