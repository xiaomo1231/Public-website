import type { TranslationKey } from '@/i18n'

/**
 * Vocabulary: word books, per-word spaced-repetition progress and review logs.
 *
 * Progress is per WORD and global (not per course): a word learned from the
 * CET-4 book is not new again when it turns up in a course. Exam books are
 * read-only data shipped with the app (`public/vocab/`, from ECDICT); course
 * and custom books store their own entries.
 */

/** Exam tags in bit order — must match `TAGS` in scripts/build-vocab.mjs. */
export const TAG_ORDER = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'] as const
export type ExamTag = (typeof TAG_ORDER)[number]

export const EXAM_LABEL_KEYS: Record<ExamTag, TranslationKey> = {
  zk: 'vocab.exam.zk',
  gk: 'vocab.exam.gk',
  cet4: 'vocab.exam.cet4',
  cet6: 'vocab.exam.cet6',
  ky: 'vocab.exam.ky',
  toefl: 'vocab.exam.toefl',
  ielts: 'vocab.exam.ielts',
  gre: 'vocab.exam.gre',
}

/** The book suggested on first use. */
export const RECOMMENDED_BOOK = 'exam:cet4'

export function examBookId(tag: ExamTag): string {
  return `exam:${tag}`
}

export function examTagOf(bookId: string): ExamTag | null {
  const tag = bookId.startsWith('exam:') ? bookId.slice(5) : ''
  return (TAG_ORDER as readonly string[]).includes(tag) ? (tag as ExamTag) : null
}

/** One dictionary entry (ECDICT, exam-tagged words only). */
export interface DictEntry {
  word: string
  phonetic: string
  meanings: string[]
  tags: ExamTag[]
  /** Frequency rank (1 = most frequent); 0 when unknown. */
  rank: number
  /** Inflected forms (past tense, plural, …). */
  forms: string[]
}

export type VocabBookKind = 'exam' | 'course' | 'custom'

/** A stored book: a course's vocabulary or an imported list. Exam books are not stored. */
export interface VocabBook {
  id: string
  kind: 'course' | 'custom'
  name: string
  /** Course books only. */
  projectId?: string
  createdAt: number
  updatedAt: number
}

/** Where a course word was found. */
export interface WordContext {
  text: string
  page?: number
  documentName?: string
  chunkId?: string
}

/** A word in a course or custom book. */
export interface VocabEntry {
  id: string
  bookId: string
  projectId?: string
  /** Lower-case headword (lemma). */
  word: string
  phonetic?: string
  meanings: string[]
  context?: WordContext
  /** How often it appears in the course material. */
  occurrences?: number
  /** Where the meaning came from. */
  glossBy: 'dictionary' | 'ai' | 'user' | 'none'
  createdAt: number
}

/** A word as shown to the student, whichever book it comes from. */
export interface WordView {
  word: string
  phonetic: string
  meanings: string[]
  tags: ExamTag[]
  /** Inflected forms, when the dictionary knows them. */
  forms?: string[]
  context?: WordContext
}

/** ts-fsrs card states. */
export type CardState = 0 | 1 | 2 | 3

/** Spaced-repetition progress of one word (an FSRS card plus bookkeeping). */
export interface VocabCard {
  /** Lower-case headword; the primary key. */
  word: string
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  learning_steps: number
  state: CardState
  last_review?: number
  /** Book the word was first learned from. */
  bookId: string
  addedAt: number
  /** Wrong spellings so far. */
  mistakes: number
  lastMistakeAt?: number
}

export type VocabRating = 1 | 2 | 3 | 4

/** How a word is practised. */
export type VocabMode = 'learn' | 'recognize' | 'spell' | 'dictation' | 'cloze'

export interface VocabReview {
  id: string
  word: string
  rating: VocabRating
  mode: VocabMode
  /** Typing modes: whether the spelling was right. */
  correct?: boolean
  at: number
}

/** How reviews are practised: chosen per word, or one mode throughout. */
export type ReviewModePreference = 'auto' | 'recognize' | 'spell' | 'dictation'

export interface VocabSettings {
  bookId: string | null
  dailyNew: number
  reviewMode: ReviewModePreference
}

export const DEFAULT_DAILY_NEW = 20
export const DEFAULT_VOCAB_SETTINGS: VocabSettings = { bookId: null, dailyNew: DEFAULT_DAILY_NEW, reviewMode: 'auto' }

/** One item of a study session. */
export interface SessionItem {
  view: WordView
  kind: 'new' | 'review'
  mode: VocabMode
}

export type ExportFormat = 'anki' | 'csv' | 'txt'
