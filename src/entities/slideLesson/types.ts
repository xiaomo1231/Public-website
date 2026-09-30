import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { TutorSymbol, TutorVisual } from '@/entities/tutorLesson/types'

/**
 * Per-slide study material for a PPT/PPTX presentation.
 *
 * "Learn by knowledge point" (the Topic page + its cached `TutorLesson`) and
 * "learn by slide" are two different activities, so they get two different
 * records:
 *
 *  - A `TutorLesson` is keyed by a course-analysis `topicId` and is invalidated
 *    by topic / structure changes. A slide has no topic and no course structure.
 *  - A `TutorSession` is the *adaptive quiz* loop (pending question, difficulty,
 *    mastery) keyed by `(projectId, topicId)`. Studying a slide is explanation +
 *    free-form questions, with no difficulty engine.
 *
 * Reusing either would overload its identity or force unrelated semantics onto
 * an existing system, so a dedicated `SlideLesson` holds the whole state of one
 * slide: the cached explanation, the one guiding question, and the Q&A
 * conversation. It is created lazily — only when the student generates the
 * explanation — so browsing slides costs no storage.
 */
export type SlideLessonStatus = 'ready' | 'failed'

/** One turn of a slide's helper conversation. */
export interface SlideMessage {
  id: string
  role: 'student' | 'assistant'
  content: string
  createdAt: number
}

export interface SlideLesson {
  id: string
  projectId: string
  documentId: string
  documentName: string
  /** 1-based slide number. */
  slideNumber: number
  /** Total slides in the document at generation time (for "n / N"). */
  slideTotal: number
  /** Teaching language — independent of the UI language. */
  language: 'zh' | 'en' | 'mixed'

  status: SlideLessonStatus
  /** Explanation body (Markdown + LaTeX). Present when `ready`. */
  content?: string
  /** One short guiding question for this slide. Present when `ready`. */
  question?: string
  /** LaTeX symbols discovered in `content`; never generated separately. */
  symbols: TutorSymbol[]
  /** Preserved slide images / figures. */
  visuals?: TutorVisual[]
  /** Real chunk ids on this slide, validated against stored chunks. */
  sourceChunkIds: string[]
  /** Display citations (document + slide + excerpt + real chunk id). */
  sourceRefs: SourceReference[]
  /** The student's follow-up questions and the tutor's answers. */
  messages: SlideMessage[]

  /** Actionable reason when this slide's explanation could not be generated. */
  errorMessage?: string

  /**
   * Fingerprint of the slide material the explanation was built from.
   * Deliberately content-based (text + content type + order + notes) rather
   * than chunk ids, so re-processing a document with identical content keeps the
   * cache while a real edit invalidates it.
   */
  contentHash: string
  /** Prompt version that produced the explanation. */
  promptVersion: string
  /** Provider model id, for diagnostics only. */
  model?: string

  generatedAt?: number
  createdAt: number
  updatedAt: number
  /** Bumped when the stored shape changes; lets old rows load defensively. */
  version: number
}

/** Current `SlideLesson.version`. */
export const SLIDE_LESSON_VERSION = 1

/** Cap on stored Q&A turns per slide (keeps the row bounded). */
export const SLIDE_MESSAGE_LIMIT = 40

/** Cap on source chunks folded into one slide's lesson. */
export const SLIDE_MAX_SOURCE_CHUNKS = 12

/** Cache key: one slide lesson per project + document + slide + language. */
export interface SlideLessonKey {
  projectId: string
  documentId: string
  slideNumber: number
  language: 'zh' | 'en' | 'mixed'
}

export function slideLessonKeyString(key: SlideLessonKey): string {
  return `${key.projectId}::${key.documentId}::${key.slideNumber}::${key.language}`
}
