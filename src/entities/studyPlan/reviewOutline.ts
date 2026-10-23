import { resolveMaterialType, type LearningMaterialType } from '@/entities/document/types'
import { resolveEvalRole } from '@/entities/evaluation/evalRole'
import { analyzePastExams } from '@/entities/exam/analysis'
import { matchScore } from '@/entities/syllabus/match'
import {
  REVIEW_MAX_TOPICS,
  type ReviewOverview,
  type ReviewQuestionRef,
  type ReviewSection,
} from './review'

/**
 * 复习提纲综合课件与考题: the sheet is laid out by knowledge point across the
 * chosen files (slides / textbook + past papers + answers + homework), not one
 * section per file. Pure helpers: which files may be chosen and which are
 * chosen by default, the outline sent to `exam-review-outline/v1`, the local
 * check of its reply, the local fallback (merged chapters / files) and the
 * 考试概览 statistics.
 */

// ── 用哪些资料 ─────────────────────────────────────────────────────────────

/** Groups of the source picker, in display order. */
export type ReviewSourceGroup =
  'lecture' | 'past' | 'answers' | 'homework' | 'practice' | 'notes' | 'reading' | 'syllabus'

export const REVIEW_SOURCE_GROUPS: readonly ReviewSourceGroup[] = [
  'lecture',
  'past',
  'answers',
  'homework',
  'practice',
  'notes',
  'reading',
  'syllabus',
]

/** The picker group of a role (`null`: never a review source, e.g. an imported walkthrough). */
export function reviewSourceGroupOf(type: LearningMaterialType): ReviewSourceGroup | null {
  switch (type) {
    case 'textbook':
      return 'lecture'
    case 'past_exam':
      return 'past'
    case 'homework_answer':
      return 'answers'
    case 'homework':
      return 'homework'
    case 'professor_practice':
      return 'practice'
    case 'user_notes':
    case 'lecture_transcript':
      return 'notes'
    case 'reading':
      return 'reading'
    case 'syllabus':
      return 'syllabus'
    default:
      return null
  }
}

/** Roles checked by default: slides / textbook, notes, past papers, answers, homework, practice. */
export const DEFAULT_REVIEW_SOURCE_TYPES: ReadonlySet<LearningMaterialType> = new Set([
  'textbook',
  'user_notes',
  'lecture_transcript',
  'past_exam',
  'homework_answer',
  'homework',
  'professor_practice',
])

/** Roles whose own text teaches the course (outline lines / chunks of a point). */
export const LECTURE_SOURCE_TYPES: ReadonlySet<LearningMaterialType> = new Set([
  'textbook',
  'user_notes',
  'lecture_transcript',
])

export interface ReviewSourceDoc {
  id: string
  name: string
  materialType?: LearningMaterialType
  status: string
  evalRole?: unknown
  folderPath?: string
}

/** Files that may be chosen: processed, not held out, of a role with a picker group. */
export function reviewSourceOptions<T extends ReviewSourceDoc>(documents: readonly T[]): T[] {
  return documents.filter(
    (doc) =>
      doc.status === 'ready' &&
      resolveEvalRole(doc.evalRole) !== 'independent' &&
      reviewSourceGroupOf(resolveMaterialType(doc.materialType)) !== null,
  )
}

/**
 * The files checked by default: of the default roles, within the exam's
 * picked materials when it has any (a file picked for the exam is checked
 * whatever its role, except reading / syllabus), else the whole course.
 */
export function defaultReviewSources(
  documents: readonly ReviewSourceDoc[],
  pickedIds: ReadonlySet<string> = new Set(),
): string[] {
  const options = reviewSourceOptions(documents)
  const inExam = pickedIds.size > 0 ? options.filter((doc) => pickedIds.has(doc.id)) : options
  // The exam's picks without any lecture file: the course's lectures still teach it.
  const pool =
    pickedIds.size > 0 &&
    !inExam.some((doc) => LECTURE_SOURCE_TYPES.has(resolveMaterialType(doc.materialType)))
      ? [
          ...inExam,
          ...options.filter(
            (doc) =>
              !pickedIds.has(doc.id) &&
              LECTURE_SOURCE_TYPES.has(resolveMaterialType(doc.materialType)),
          ),
        ]
      : inExam
  return pool
    .filter((doc) => DEFAULT_REVIEW_SOURCE_TYPES.has(resolveMaterialType(doc.materialType)))
    .map((doc) => doc.id)
}

/** The sheet's files: the stored choice (still existing and choosable), else the defaults. */
export function effectiveReviewSources(
  stored: { documentIds: readonly string[] } | undefined,
  documents: readonly ReviewSourceDoc[],
  pickedIds: ReadonlySet<string> = new Set(),
): string[] {
  if (!stored) return defaultReviewSources(documents, pickedIds)
  const allowed = new Set(reviewSourceOptions(documents).map((doc) => doc.id))
  return stored.documentIds.filter((id) => allowed.has(id))
}

/** Two choices are the same set of files. */
export function sameSources(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

// ── the outline sent to the model ─────────────────────────────────────────

export interface OutlineChunk {
  id: string
  documentId: string
  documentName: string
  documentType?: string
  page?: number
  contentType?: string
  text: string
  order: number
}

export interface OutlineEntry {
  alias: string
  chunkId: string
  documentId: string
  documentName: string
  page?: number
  text: string
  /** The chunks this line heads (it and the ones after it, up to the next line). */
  spanChunkIds: string[]
}

/** Outline lines sent in one request, and characters per line. */
export const OUTLINE_MAX_LINES = 320
export const OUTLINE_LINE_CHARS = 120
/** Spans kept per entry (chunks taught under one line). */
const SPAN_MAX_CHUNKS = 12

function firstLine(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((each) => each.trim())
      .find((each) => each.length > 0) ?? ''
  return line.replace(/\s+/g, ' ').slice(0, OUTLINE_LINE_CHARS)
}

/**
 * The lecture files' outline: every heading chunk, and the first line of each
 * page / slide that has none; each line spans the chunks up to the next one.
 * Too many lines are thinned evenly (aliases `c1…` in that order).
 */
export function buildOutlineEntries(chunks: readonly OutlineChunk[]): OutlineEntry[] {
  const byDoc = new Map<string, OutlineChunk[]>()
  for (const chunk of chunks)
    byDoc.set(chunk.documentId, [...(byDoc.get(chunk.documentId) ?? []), chunk])
  const raw: Omit<OutlineEntry, 'alias'>[] = []
  for (const list of byDoc.values()) {
    const sorted = [...list].sort((a, b) => a.order - b.order)
    const pagesWithHeading = new Set(
      sorted.filter((c) => c.contentType === 'heading').map((c) => c.page ?? -1),
    )
    const seenPages = new Set<number>()
    const seenText = new Set<string>()
    let current: Omit<OutlineEntry, 'alias'> | null = null
    for (const chunk of sorted) {
      const page = chunk.page ?? -1
      const startsPage = !seenPages.has(page)
      seenPages.add(page)
      const isHead =
        chunk.contentType === 'heading' ||
        (startsPage && page !== -1 && !pagesWithHeading.has(page))
      const text = firstLine(chunk.text)
      const key = text.toLowerCase()
      if (isHead && text.length >= 2 && !seenText.has(key)) {
        seenText.add(key)
        current = {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentName: chunk.documentName,
          ...(chunk.page !== undefined ? { page: chunk.page } : {}),
          text,
          spanChunkIds: [chunk.id],
        }
        raw.push(current)
      } else if (current && current.spanChunkIds.length < SPAN_MAX_CHUNKS) {
        current.spanChunkIds.push(chunk.id)
      }
    }
    // A file with no page numbers and no headings: its first line heads it all.
    if (!raw.some((entry) => entry.documentId === sorted[0]?.documentId) && sorted[0]) {
      raw.push({
        chunkId: sorted[0].id,
        documentId: sorted[0].documentId,
        documentName: sorted[0].documentName,
        text: firstLine(sorted[0].text) || sorted[0].documentName,
        spanChunkIds: sorted.slice(0, SPAN_MAX_CHUNKS).map((c) => c.id),
      })
    }
  }
  let kept = raw
  if (raw.length > OUTLINE_MAX_LINES) {
    kept = []
    for (let i = 0; i < OUTLINE_MAX_LINES; i++)
      kept.push(raw[Math.floor((i * raw.length) / OUTLINE_MAX_LINES)]!)
  }
  return kept.map((entry, i) => ({ alias: `c${i + 1}`, ...entry }))
}

export interface OutlineQuestion {
  questionId: string
  ref: ReviewQuestionRef
  /** The question text (prompt + options). */
  text: string
}

// ── checking the outline reply ────────────────────────────────────────────

export interface OutlinePoint {
  title: string
  /** Course topic id, when the model matched one. */
  topicId?: string
  /** Outline entries (chunk ids of the lines) cited. */
  chunkIds: string[]
  questionIds: string[]
}

const POINT_TITLE_CHARS = 120

function aliasList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list
    .filter((each): each is string => typeof each === 'string')
    .map((each) => each.trim().replace(/^\[|\]$/g, ''))
}

function titleKey(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, ' ')
    .trim()
}

/**
 * Keep the knowledge points the reply can back up: aliases are a closed set
 * (`c…` outline lines, `q…` questions, `t…` course topics); a point citing no
 * valid line or question is dropped; points with the same title are merged;
 * at most `REVIEW_MAX_TOPICS`.
 */
export function validateOutlineReply(
  raw: unknown,
  aliases: {
    chunks: ReadonlyMap<string, string>
    questions: ReadonlyMap<string, string>
    topics: ReadonlyMap<string, string>
  },
): { points: OutlinePoint[]; dropped: number } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const items = Array.isArray(obj.points)
    ? obj.points
    : Array.isArray(obj.knowledgePoints)
      ? obj.knowledgePoints
      : Array.isArray(raw)
        ? raw
        : []
  let dropped = 0
  const out: OutlinePoint[] = []
  const byTitle = new Map<string, OutlinePoint>()
  for (const item of items.slice(0, 40)) {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const title =
      typeof row.title === 'string'
        ? row.title.replace(/\s+/g, ' ').trim().slice(0, POINT_TITLE_CHARS)
        : ''
    const chunkIds = [
      ...new Set(
        aliasList(row.chunks ?? row.chunkRefs ?? row.sources)
          .map((alias) => aliases.chunks.get(alias))
          .filter((id): id is string => !!id),
      ),
    ]
    const questionIds = [
      ...new Set(
        aliasList(row.questions ?? row.questionRefs)
          .map((alias) => aliases.questions.get(alias))
          .filter((id): id is string => !!id),
      ),
    ]
    if (!title || chunkIds.length + questionIds.length === 0) {
      dropped += 1
      continue
    }
    const topicId = aliases.topics.get(aliasList(row.topic)[0] ?? '')
    const key = titleKey(title)
    const same = byTitle.get(key)
    if (same) {
      same.chunkIds = [...new Set([...same.chunkIds, ...chunkIds])]
      same.questionIds = [...new Set([...same.questionIds, ...questionIds])]
      if (!same.topicId && topicId) same.topicId = topicId
      continue
    }
    const point: OutlinePoint = { title, chunkIds, questionIds, ...(topicId ? { topicId } : {}) }
    byTitle.set(key, point)
    out.push(point)
  }
  if (out.length > REVIEW_MAX_TOPICS) dropped += out.length - REVIEW_MAX_TOPICS
  return { points: out.slice(0, REVIEW_MAX_TOPICS), dropped }
}

// ── sections ──────────────────────────────────────────────────────────────

export interface PointWeights {
  /** Mastery of a course topic (0–1), when known. */
  mastery?: (topicId: string) => number | null
  /** Open mistakes on a course topic. */
  openMistakes?: (topicId: string) => number
}

function marksOf(questionIds: readonly string[], refs: ReadonlyMap<string, ReviewQuestionRef>) {
  let marks = 0
  for (const id of questionIds) marks += refs.get(id)?.marks ?? 0
  return marks
}

/**
 * The sheet's sections from its knowledge points: exam weight (marks, else
 * number of questions) × weakness first, like the per-topic sheet. Each
 * section keeps its chunks, questions and their labels.
 */
export function sectionsFromPoints(
  points: readonly OutlinePoint[],
  questionRefs: ReadonlyMap<string, ReviewQuestionRef>,
  weights: PointWeights = {},
): ReviewSection[] {
  const n = Math.max(1, points.length)
  const totalMarks = points.reduce((sum, p) => sum + marksOf(p.questionIds, questionRefs), 0)
  const totalQuestions = points.reduce((sum, p) => sum + p.questionIds.length, 0)
  const scored = points.map((point, index) => {
    const share =
      totalMarks > 0
        ? marksOf(point.questionIds, questionRefs) / totalMarks
        : totalQuestions > 0
          ? point.questionIds.length / totalQuestions
          : 1 / n
    const mastery = point.topicId ? (weights.mastery?.(point.topicId) ?? null) : null
    const mistakes = point.topicId ? (weights.openMistakes?.(point.topicId) ?? 0) : 0
    const weakness = 1 - (mastery ?? 0.5)
    // A point no question tests still counts a little (the lectures stress it).
    const priority = (share * n + 0.25) * weakness + 0.1 * Math.min(5, mistakes)
    return { point, index, mastery, priority }
  })
  scored.sort((a, b) => b.priority - a.priority || a.index - b.index)
  return scored.map(({ point, mastery, priority }, i) => {
    const refs: Record<string, ReviewQuestionRef> = {}
    for (const id of point.questionIds) {
      const ref = questionRefs.get(id)
      if (ref) refs[id] = ref
    }
    return {
      id: `s${i + 1}`,
      topicId: point.topicId ?? `kp:${i + 1}`,
      title: point.title,
      order: i,
      priority: Math.round(priority * 1000) / 1000,
      mastery,
      status: 'pending',
      chunkIds: point.chunkIds,
      questionIds: point.questionIds,
      ...(Object.keys(refs).length > 0 ? { questionRefs: refs } : {}),
    }
  })
}

/** A score ≥ this between a question and a point title counts as testing it (local fallback). */
export const QUESTION_MATCH_THRESHOLD = 0.34

/**
 * Local fallback without AI: chapters / files with the same title are merged
 * into one point (the same lecture in two files), and each question goes to
 * the best-matching point. Unit ids are kept for the chunks.
 */
export function mergeUnits<U extends { id: string; title: string }>(
  units: readonly U[],
): Array<{ title: string; units: U[] }> {
  const groups = new Map<string, { title: string; units: U[] }>()
  for (const unit of units) {
    const key = titleKey(unit.title.replace(/\.(pdf|pptx?|docx?|txt|md)$/i, ''))
    const group = groups.get(key)
    if (group) group.units.push(unit)
    else groups.set(key, { title: unit.title, units: [unit] })
  }
  return [...groups.values()]
}

/** Each question to the point whose title it matches best (≥ threshold). */
export function assignQuestions(
  points: ReadonlyArray<{ key: string; title: string; description?: string }>,
  questions: readonly OutlineQuestion[],
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const question of questions) {
    let best: { key: string; score: number } | null = null
    for (const point of points) {
      const score = matchScore(question.text, {
        id: point.key,
        name: point.title,
        ...(point.description ? { description: point.description } : {}),
      })
      if (score >= QUESTION_MATCH_THRESHOLD && (!best || score > best.score))
        best = { key: point.key, score }
    }
    if (best) out.set(best.key, [...(out.get(best.key) ?? []), question.questionId])
  }
  return out
}

// ── 考试概览 ───────────────────────────────────────────────────────────────

/**
 * Local statistics: question kinds and marks over the chosen past papers,
 * and the points tested most (marks, then number of questions).
 */
export function buildReviewOverview(
  questions: readonly OutlineQuestion[],
  sections: readonly Pick<ReviewSection, 'id' | 'title' | 'questionIds' | 'questionRefs'>[],
): ReviewOverview {
  const past = questions.filter((q) => q.ref.kind === 'past')
  const papers = new Map<string, OutlineQuestion[]>()
  for (const q of past) {
    const key = q.ref.setId ?? q.ref.documentId
    papers.set(key, [...(papers.get(key) ?? []), q])
  }
  const analysis = analyzePastExams({
    papers: [...papers.entries()].map(([setId, list]) => ({
      setId,
      title: list[0]!.ref.paper,
      questions: list.map((q) => ({ id: q.questionId, setId, prompt: q.text })),
    })),
    topics: [],
  })
  const pastIds = new Set(past.map((q) => q.questionId))
  const topPoints = sections
    .map((section) => {
      const ids = (section.questionIds ?? []).filter((id) => pastIds.has(id))
      const marks = ids.reduce((sum, id) => sum + (section.questionRefs?.[id]?.marks ?? 0), 0)
      return { sectionId: section.id, title: section.title, questions: ids.length, marks }
    })
    .filter((row) => row.questions > 0)
    .sort((a, b) => b.marks - a.marks || b.questions - a.questions)
    .slice(0, 5)
  return {
    papers: analysis.papers,
    questions: analysis.questions,
    questionsWithMarks: analysis.questionsWithMarks,
    totalMarks: analysis.totalMarks,
    byKind: analysis.byKind.map((row) => ({ ...row })),
    topPoints,
  }
}
