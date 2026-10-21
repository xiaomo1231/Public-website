/**
 * Exam topics read from a course syllabus / handbook (`materialType: 'syllabus'`).
 *
 * Stored on the syllabus `Document` row (`Document.syllabus`). A topic read
 * from the file keeps its exact source text, the chunk it starts in and the
 * page; one the student adds is marked `source: 'manual'`. Topics are never
 * invented: the local parser copies lines, and an AI extraction is kept only
 * where its text really occurs in the document.
 */

export type ExamScopeKind = 'midterm' | 'final' | 'other'

export const EXAM_SCOPE_KINDS: readonly ExamScopeKind[] = ['midterm', 'final', 'other']

/** How a topic entered the list. */
export type ExamTopicSource = 'local' | 'ai' | 'manual'

/** How a topic's course-topic matches were found. */
export type ExamTopicMatchMethod = 'local' | 'ai'

export interface ExamTopic {
  id: string
  /** Exact text from the document (whitespace normalised), or the student's own. */
  text: string
  order: number
  /** Sub-heading inside the scope ("Musculoskeletal Anatomy"); display only. */
  group?: string
  /** Chunk the text starts in; absent for manual topics. */
  sourceChunkId?: string
  page?: number
  source: ExamTopicSource
  /** Course topics (`Topic.id`) that cover this exam topic. */
  topicIds?: string[]
  matchedBy?: ExamTopicMatchMethod
}

export interface ExamScope {
  id: string
  /** Heading text from the document, or the student's rename. */
  label: string
  kind: ExamScopeKind
  topics: ExamTopic[]
}

export interface SyllabusData {
  scopes: ExamScope[]
  extractedAt: number
  method: 'local' | 'ai'
  /** Set once the student edits the list; re-processing then keeps it. */
  editedAt?: number
  /** Fingerprint of the course topics the matches were computed against. */
  matchedAgainst?: string
  matchedAt?: number
}

/** Fewer topics than this from the local parser ⇒ offer an AI extraction. */
export const MIN_LOCAL_TOPICS = 5

export function countExamTopics(data: SyllabusData | undefined | null): number {
  return (data?.scopes ?? []).reduce((sum, scope) => sum + scope.topics.length, 0)
}
