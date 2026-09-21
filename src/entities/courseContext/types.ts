import type { ProfessorQuestionStyleProfile } from '@/entities/practice/types'

/**
 * The relationship between the three kinds of learning material, derived once
 * per project.
 *
 * This is deliberately *not* part of the Tutor lesson: class progress and the
 * professor's teaching profile change independently of the teaching content,
 * and must never force a lesson to be regenerated.
 */

/** How the professor teaches — style, not facts. */
export interface ProfessorTeachingProfile {
  explanationStyle?: string
  terminologyPreferences: string[]
  commonAnalogies: string[]
  recurringExamples: string[]
  emphasisPatterns: string[]
  /** The order in which the professor tends to introduce things. */
  teachingSequence: string[]
}

/** How a note relates to the textbook passage it was matched to. */
export type NoteRelation =
  | 'supplement'
  | 'clarification'
  | 'example'
  | 'question'
  | 'emphasis'
  | 'unknown'

export interface NoteLink {
  noteChunkId: string
  textbookChunkId: string
  /** 0-1; how confident the match is. */
  confidence: number
  relation: NoteRelation
  /** Textbook structure the matched passage belongs to. */
  chapterId?: string
  sectionId?: string
}

export interface LectureChunkLink {
  transcriptChunkId: string
  textbookChunkId: string
  topicId?: string
  confidence: number
  chapterId?: string
  sectionId?: string
}

/**
 * Where the professor's class has reached.
 *
 * `progressPercent` is only set when coverage can actually be established from
 * the transcript; otherwise it stays undefined rather than inventing a number.
 */
export interface ClassProgress {
  transcriptDocumentIds: string[]
  currentTopicId?: string
  currentTopicName?: string
  /** Textbook position of the current topic, when it maps to one. */
  currentChapterId?: string
  currentSectionId?: string
  currentChapterNumber?: string
  currentSectionNumber?: string
  currentChapterTitle?: string
  currentSectionTitle?: string
  completedTopicIds: string[]
  progressPercent?: number
  lastMatchedTranscriptChunkId?: string
  updatedAt: number
}

/** One row per project. */
export interface CourseContext {
  id: string
  projectId: string
  /** How the professor *teaches* (from the lecture transcript). */
  professorProfile?: ProfessorTeachingProfile
  /** How the professor *writes questions* (from Professor Practice). */
  questionStyleProfile?: ProfessorQuestionStyleProfile
  classProgress?: ClassProgress
  noteLinks: NoteLink[]
  lectureLinks: LectureChunkLink[]
  /**
   * Fingerprint of the transcript/notes chunks this context was built from.
   * A mismatch means the derived context is stale and should be recomputed.
   */
  sourceHash: string
  updatedAt: number
}

export function courseContextId(projectId: string): string {
  return projectId
}
