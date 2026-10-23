/**
 * 学习计划: exams the student is preparing for, the study calendar, the tasks
 * the local scheduler laid out, and the diagnostic paper (摸底卷).
 *
 * Tables (Dexie v20): `exams` and `studyTasks` carry `projectId` (a plan may
 * span several courses: the plan row itself is global), `studyPlans` holds the
 * one global plan row, `diagnostics` the diagnostic papers (each section
 * carries its course). All are exported / restored, and deleting a course
 * removes its exams, tasks and diagnostic sections.
 */

import type { ExamReview } from './review'

/** How a calendar day is used. `off` = no study that day. */
export type DayType = 'class' | 'weekend' | 'holiday' | 'off'

export const DAY_TYPES: readonly DayType[] = ['class', 'weekend', 'holiday', 'off']

export interface DayOverride {
  type: DayType
  /** Minutes for this day only; absent = the day type's minutes. */
  minutes?: number
}

export interface StudyCalendar {
  /** Minutes available per day type (`off` is always 0). */
  minutes: Record<DayType, number>
  /** Weekly pattern, indexed like `Date.getDay()` (0 = Sunday). */
  weekly: DayType[]
  /** Per-day exceptions, keyed `YYYY-MM-DD`. */
  overrides: Record<string, DayOverride>
}

export const DEFAULT_CALENDAR: StudyCalendar = {
  minutes: { class: 90, weekend: 240, holiday: 180, off: 0 },
  weekly: ['weekend', 'class', 'class', 'class', 'class', 'class', 'weekend'],
  overrides: {},
}

/** Most minutes a single day may hold. */
export const MAX_DAY_MINUTES = 16 * 60

/** What an exam covers. */
export type PlannedExamScope =
  | { kind: 'course' }
  /** A scope of the course's 考点清单 (syllabus document + scope id). */
  | { kind: 'syllabus'; documentId: string; scopeId: string }
  | { kind: 'topics'; topicIds: string[] }

/** Materials the student picked for this exam (ids within the course). */
export interface PlannedExamMaterials {
  /** Past papers (`HomeworkSet.kind === 'exam'`, not AI 模拟卷). */
  pastExamSetIds: string[]
  /** Review documents (notes, review sheets…). */
  reviewDocumentIds: string[]
  /** Professor practice sets (`PracticeSet`). */
  practiceSetIds: string[]
  /** Homework sets (`HomeworkSet`). */
  homeworkSetIds: string[]
  /**
   * Files picked in the materials picker (any role). A past paper, homework
   * or professor-practice file brings its recognised set; other files are
   * read as review material. Absent on older rows (= none).
   */
  documentIds?: string[]
  /**
   * Folders picked whole (`Document.folderPath`): every file in the folder or
   * below it counts, including files added to the folder later.
   */
  folderPaths?: string[]
}

export const EMPTY_MATERIALS: PlannedExamMaterials = {
  pastExamSetIds: [],
  reviewDocumentIds: [],
  practiceSetIds: [],
  homeworkSetIds: [],
  documentIds: [],
  folderPaths: [],
}

export interface PlannedExam {
  id: string
  projectId: string
  name: string
  /** Start of the exam (epoch ms). */
  at: number
  /** Where it is written, when known (粘贴识别 or typed). */
  location?: string
  /** Length in minutes, when known. */
  durationMinutes?: number
  scope: PlannedExamScope
  materials: PlannedExamMaterials
  /**
   * 复习提纲 generated for this exam (see `review.ts`). Stored on the row (no
   * table of its own), so it is exported and deleted with the exam.
   */
  review?: ExamReview
  createdAt: number
  updatedAt: number
}

/** A slider position on the 权重 tab. */
export interface ExamWeightSetting {
  /** Share of the study time, 0–100. */
  share: number
  locked: boolean
}

export interface PlanSummary {
  text: string
  at: number
  promptVersion: string
}

/** What the last scheduling run could not fit. */
export interface OverflowReport {
  droppedMinutes: number
  dropped: Array<{ examId: string; topicId?: string; label: string; minutes: number }>
  suggestions: PlanSuggestion[]
}

export type PlanSuggestion =
  | { kind: 'add_minutes'; minutesPerDay: number }
  | { kind: 'lower_weight'; examId: string }
  | { kind: 'skip_mastered'; topics: number }
  | { kind: 'use_off_days'; days: number }

export const STUDY_PLAN_ID = 'singleton'

export interface StudyPlan {
  id: string
  calendar: StudyCalendar
  /** The student's slider shares, by exam id; absent = the suggested shares. */
  weights?: Record<string, ExamWeightSetting>
  summary?: PlanSummary
  /** When the tasks were last laid out. */
  lastPlannedAt?: number
  overflow?: OverflowReport
  updatedAt: number
}

export type StudyTaskKind =
  /** First pass of a topic (tutor lesson). */
  | 'learn'
  /** Spaced review of a topic (+1 / +3 / +7 days) or an occasional one. */
  | 'review'
  /** The short practice block that ends a study day. */
  | 'day_practice'
  /** Mistake re-tests due. */
  | 'mistakes'
  /** Review cards due. */
  | 'cards'
  /** Vocabulary session (language courses). */
  | 'vocab'
  /** A professor mock / past paper (existing mock exam). */
  | 'mock'
  /**
   * The AI 模拟卷: `refId` = `ai-mock:<examId>` (generate one) or the
   * generated paper's set id (take it).
   */
  | 'ai_mock'
  /** A homework set (guided practice). */
  | 'homework'
  /** A professor practice set. */
  | 'practice_set'
  /** Final days: weak spots only. */
  | 'weak_spots'
  /** A review file the student picked for the exam (`refId` = document id). */
  | 'review_material'
  /** Read one topic of the exam's 复习提纲 (`refId` = `review:<examId>:<sectionId>`). */
  | 'review_sheet'

export type StudyTaskStatus = 'pending' | 'done' | 'skipped'

export interface StudyTask {
  id: string
  projectId: string
  examId: string
  /** `YYYY-MM-DD` (local). */
  date: string
  kind: StudyTaskKind
  /** Course topic id, or a pseudo id for an exam topic without a course topic. */
  topicId?: string
  /** Topic labels shown on the task (weak spots / day practice list several). */
  topicNames?: string[]
  /** Homework set / practice set / mock paper id. */
  refId?: string
  title?: string
  minutes: number
  /** Position within the day. */
  order: number
  status: StudyTaskStatus
  /** The student moved it to `date`; re-planning keeps it there. */
  pinned?: boolean
  doneAt?: number
  createdAt: number
  updatedAt: number
}

/** One planned part of a diagnostic section: one generation request (≤5 questions). */
export interface DiagnosticItem {
  id: string
  label: string
  count: number
  topicId?: string
  /** An exam topic of a syllabus scope (quizzed through `QuizConfig.examScope`). */
  examTopic?: { documentId: string; scopeId: string; examTopicId: string }
  /** The quiz holding this item's questions (removed once the section is assembled). */
  quizId?: string
  status: 'pending' | 'generating' | 'paused' | 'done' | 'failed'
  error?: string
  questions?: number
}

export interface DiagnosticSection {
  examId: string
  projectId: string
  label: string
  /** Questions planned. */
  count: number
  /** Estimated minutes to answer them. */
  minutes: number
  items: DiagnosticItem[]
  /** The assembled quiz the student takes. */
  quizId?: string
}

export type DiagnosticStatus = 'draft' | 'generating' | 'paused' | 'partial' | 'ready'

export interface DiagnosticPaper {
  id: string
  examIds: string[]
  sections: DiagnosticSection[]
  status: DiagnosticStatus
  createdAt: number
  updatedAt: number
}
