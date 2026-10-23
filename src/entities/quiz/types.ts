import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { QuestionType } from '@/entities/question/types'
import type { TranslationKey } from '@/i18n/types'
import type { QuestionLanguage } from '../user/types'
import type { ExamLanguageKey } from '@/infrastructure/ai/prompts/exam-language/v1'

/**
 * The language a quiz / oral exam is written in: Chinese, English, the
 * material's mix, Chinese with English terms, or 跟随考试语言 (`exam:<code>`).
 */
export type QuizLanguage = 'zh' | 'en' | 'mixed' | 'zh_terms' | ExamLanguageKey

export type QuizDifficulty = 'adaptive' | DifficultyLevel

export interface QuizConfig {
  topicId?: string
  topicName?: string
  /**
   *  topic      — a single topic
   *  mixed      — everything in the project
   *  weakness   — aggregated weak knowledge points
   *  review     — a review session built from recent mistakes
   *  oral       — oral-exam rehearsal: `count` topics (1–5) drawn at random
   *               from the exam scope / the topic / the course, each one main
   *               question with follow-ups (see `OralQuestionInfo`)
   */
  mode: 'topic' | 'mixed' | 'weakness' | 'review' | 'oral'
  count: number
  /** Oral mode only: the answer countdown per drawn topic. */
  oral?: OralExamSettings
  difficulty: QuizDifficulty
  types: QuestionType[]
  /** Restrict retrieval to a textbook chapter/section (course structure). */
  chapterId?: string
  sectionId?: string
  /** Explicit knowledge points to focus on (review sessions, practice-this-mistake). */
  focusKnowledgePoints?: string[]
  /** When set, the session was launched from a specific mistake. */
  sourceMistakeId?: string
  /** Language of the questions; absent uses the student's saved preference. */
  questionLanguage?: QuestionLanguage
  /**
   * A quiz over an exam scope of the course syllabus, or one exam topic of it.
   * Exam topics matched to course topics are quizzed from those topics'
   * sources; unmatched ones only with `includeUnmatched`, and their questions
   * have no course source (labelled as AI-generated).
   */
  examScope?: ExamScopeSelection
  /**
   * Mixed review / oral rehearsal restricted to these course topics (a
   * planned exam's scope, from its 考试工作台). Absent or empty = every topic.
   */
  topicIds?: string[]
}

export interface OralExamSettings {
  /** Seconds for the main answer; absent = no countdown. */
  timerSeconds?: number
}

/** Topics drawn per oral rehearsal, and the default countdown. */
export const ORAL_MAX_TOPICS = 5
export const ORAL_DEFAULT_TIMER_SECONDS = 180

export interface ExamScopeSelection {
  /** The syllabus document. */
  documentId: string
  scopeId: string
  /** One exam topic of the scope; absent = the whole scope. */
  examTopicId?: string
  includeUnmatched: boolean
}

/**
 * `paused` — generation was paused (or stopped) before every planned question
 * existed. The questions generated so far are stored; `resume` /
 * `oralResume` hold what is needed to fill the remaining slots. A paused quiz
 * cannot be taken until 「继续出题」 completes it.
 */
export type QuizStatus = 'generating' | 'paused' | 'ready' | 'in_progress' | 'completed' | 'failed'

export const QUIZ_STATUS_LABEL_KEYS: Record<QuizStatus, TranslationKey> = {
  generating: 'quizStatus.generating',
  paused: 'quizStatus.paused',
  ready: 'quizStatus.ready',
  in_progress: 'quizStatus.in_progress',
  completed: 'quizStatus.completed',
  failed: 'quizStatus.failed',
}

export interface QuizDifficultyStat {
  correct: number
  wrong: number
  unverified: number
  total: number
}

export interface QuizKnowledgeStat {
  knowledgePoint: string
  correct: number
  wrong: number
  unverified: number
  total: number
  /**
   * Graded credit on the same basis as the overall percentage (1 per correct
   * answer, earned / total for a partly covered short answer). Missing on
   * scores saved before it existed; `correct` is the fallback.
   */
  points?: number
}

/** A knowledge point's score as a percentage, on the overall score's basis. */
export function knowledgeStatPercent(stat: QuizKnowledgeStat): number | null {
  const gradable = stat.correct + stat.wrong
  if (gradable <= 0) return null
  return Math.round(((stat.points ?? stat.correct) / gradable) * 100)
}

export interface QuizScore {
  correct: number
  wrong: number
  unverified: number
  total: number
  /**
   * Graded credit: one per correct answer plus partial credit for short
   * answers (3 of 5 points → 0.6). Absent on scores saved before short answers.
   */
  points?: number
  /**
   * Share of graded credit over graded questions, as a percentage. An oral
   * quiz pools its scoring points instead (Σ covered / Σ points of the scored
   * questions), the same basis as its per-topic scores.
   */
  percentage: number
  /** Oral quizzes: scoring points covered / total over the scored questions. */
  rubricPoints?: { earned: number; total: number }
  byDifficulty: Record<string, QuizDifficultyStat>
  byKnowledgePoint: QuizKnowledgeStat[]
  weakKnowledgePoints: string[]
}

export interface Quiz {
  id: string
  projectId: string
  title: string
  config: QuizConfig
  questionIds: string[]
  status: QuizStatus
  /** Per-question adaptive difficulty actually used, in order. */
  difficultyPlan: DifficultyLevel[]
  errorMessage?: string
  score?: QuizScore
  startedAt: number
  finishedAt?: number
  /** Prompt version that generated the questions. */
  promptVersion: string
  /** While generating / paused: what is needed to fill the remaining slots. */
  resume?: QuizResumeState
  /** Oral rehearsal while generating / paused: the topics still to draw up. */
  oralResume?: OralResumeState
  /**
   * An adaptive quiz drawn from a question bank (题库式自适应). While
   * generating, `questionIds` holds every bank question; once ready it holds
   * only the questions served so far (in order) and `difficultyPlan` their
   * levels — the rest of the bank stays hidden in `bank.entries`.
   */
  bank?: QuizBank
}

/** One planned bank position: the quiz slot it may fill and its level. */
export interface QuizBankSlot {
  slot: number
  difficulty: DifficultyLevel
}

/** A generated bank question (served or not). */
export interface QuizBankEntry extends QuizBankSlot {
  questionId: string
}

export interface QuizBank {
  /** The level the quiz starts at. */
  start: DifficultyLevel
  /** What was planned, indexed like `QuizResumeState.questionSlots` while generating. */
  plan: QuizBankSlot[]
  /** Every generated bank question; empty until generation completes. */
  entries: QuizBankEntry[]
  /** Questions the student answers in all (the configured count, or fewer if the bank is short). */
  length: number
}

/** How many questions the student answers: a bank quiz serves them one by one. */
export function quizLength(quiz: Quiz): number {
  if (quiz.bank && quiz.bank.entries.length > 0) return quiz.bank.length
  return quiz.questionIds.length
}

/** One planned question not generated yet; `slot` is its place in the plan. */
export interface QuizResumeSlot {
  slot: number
  type: QuestionType
  difficulty: DifficultyLevel
  /** Index into `QuizResumeState.groups` (a mixed review spreads over topics). */
  group?: number
}

/** A topic group of the quiz; its passages are reloaded by chunk id on resume. */
export interface QuizResumeGroup {
  topicId?: string
  aiOnly?: boolean
  knowledgePoints: string[]
  snippetChunkIds: string[]
}

export interface QuizResumeState {
  pending: QuizResumeSlot[]
  /** Plan slot of each stored question, parallel to `Quiz.questionIds`. */
  questionSlots: number[]
  groups: QuizResumeGroup[]
  /** The quiz's knowledge points (fallback for a question without one). */
  knowledgePoints: string[]
  topicName: string
  topicDescription: string
  language: QuizLanguage
  professorStyleContext?: string
  /** 教授出题习惯 block captured when the quiz was planned. */
  professorHabits?: string
  /**
   * Conventions read from the habits profile (`professorConventions`): a final
   * "none of the options" choice, marks per part, a data sheet, context
   * stories, strict significant figures.
   */
  professorConventions?: string[]
  /** The professor's own wording of the final "none of the options" choice. */
  noneOptionLabel?: string
  updatedAt: number
}

export interface OralResumeState {
  /** Drawn topics without a generated item yet. */
  remaining: Array<{ topic: string; topicIds: string[]; aiOnly: boolean }>
  /** Topics drawn in all. */
  total: number
  difficulty: DifficultyLevel
  /** The quiz title's topic label. */
  label: string
  language: QuizLanguage
  updatedAt: number
}

/**
 * How far an unfinished quiz got: questions generated of those planned, or
 * for an oral rehearsal the drawn topics written up of those drawn.
 */
export function quizGenerationProgress(quiz: Quiz): { done: number; total: number } {
  if (quiz.oralResume) {
    const total = quiz.oralResume.total
    return { done: total - quiz.oralResume.remaining.length, total }
  }
  // A bank quiz generates several levels per slot before it can be taken.
  if (quiz.bank) return { done: quiz.questionIds.length, total: quiz.bank.plan.length }
  return { done: quiz.questionIds.length, total: quiz.config.count }
}

/**
 * Unfinished quizzes (being taken, ready, or paused while generating) apart
 * from finished ones, each newest first.
 */
export function splitQuizzes(quizzes: readonly Quiz[]): { active: Quiz[]; finished: Quiz[] } {
  const newest = (a: Quiz, b: Quiz) => b.startedAt - a.startedAt
  const done = (quiz: Quiz) => quiz.status === 'completed' || quiz.status === 'failed'
  return {
    active: quizzes.filter((quiz) => !done(quiz)).sort(newest),
    finished: quizzes.filter(done).sort(newest),
  }
}
