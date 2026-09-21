/**
 * A cached, self-contained teaching lesson for one topic.
 *
 * This is the Topic page's reading material: generated once, stored locally and
 * reused on every later visit so the same topic never costs tokens twice.
 *
 * It is deliberately separate from `TutorSession`, which holds the *interactive*
 * conversation (questions, answers, hints). Reading and practising are two
 * different activities with two different lifecycles.
 */

import type { VisualSourceType } from '../visualSource/types'

/**
 * A preserved figure referenced by a lesson.
 *
 * It points at a stored `VisualSource`; the image bytes are loaded from
 * IndexedDB on demand by the display component, so the lesson row itself stays
 * small and the figure is never re-rendered on a cache hit.
 */
export interface TutorVisual {
  id: string
  documentId: string
  pageNumber: number
  type: VisualSourceType
  caption: string
  /** False when the page could not be rendered; only provenance is available. */
  hasImage: boolean
}

/** A LaTeX symbol discovered in a lesson's own text. */
export interface TutorSymbol {
  /** The LaTeX command or expression, e.g. `\cap`. Unique within a lesson. */
  latex: string
  /** LaTeX rendered in the panel, e.g. `A \cap B`. Never stored as Unicode. */
  displayLatex: string
  /** Human-readable name, e.g. "Intersection". */
  name?: string
  /** Short explanation of what the symbol means. */
  meaning?: string
}

export interface TutorLesson {
  id: string
  projectId: string
  topicId: string
  /** Teaching language — independent of the UI language. */
  language: 'zh' | 'en' | 'mixed'

  /** The lesson body. Markdown-ish headings plus inline/block LaTeX. */
  content: string
  /** Extracted from `content`; never generated separately by the model. */
  symbols: TutorSymbol[]

  /** Figures/diagrams the lesson references, preserved from the source. */
  visuals?: TutorVisual[]

  /** Course chunks the lesson was grounded in. */
  sourceChunkIds: string[]

  /**
   * Fingerprint of the topic the lesson was generated from. When the course is
   * re-analysed and the topic changes, this no longer matches and the lesson is
   * regenerated instead of silently serving stale material.
   */
  contentHash: string
  /** Prompt version that produced this lesson. */
  promptVersion: string
  /** Provider model id, for diagnostics only. */
  model?: string

  generatedAt: number
  updatedAt: number
  /** Bumped when the stored shape changes; lets old rows load defensively. */
  version: number
}

/**
 * Current `TutorLesson.version`.
 *
 * v2 added preserved visual sources. A stored lesson with an older version is
 * regenerated once so figures appear — after that it is cached as usual.
 */
export const TUTOR_LESSON_VERSION = 2

/**
 * Cache key for a lesson. Two lessons with the same key are interchangeable,
 * which is what makes a cache hit safe.
 */
export interface TutorLessonKey {
  projectId: string
  topicId: string
  language: 'zh' | 'en' | 'mixed'
}

export function tutorLessonKeyString(key: TutorLessonKey): string {
  return `${key.projectId}::${key.topicId}::${key.language}`
}
