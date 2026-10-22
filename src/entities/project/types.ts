export type Subject =
  | 'calculus'
  | 'linear_algebra'
  | 'discrete_math'
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'cs'
  | 'stats'
  | 'medicine'
  | 'language'
  | 'other'

/**
 * How a medical course is examined. `domestic`: Chinese medical-school style
 * (名词解释 / 简答 / 论述, Chinese terms with English). `international`: an
 * English-taught programme (English + Latin terminology, structure
 * identification, oral-style descriptions, MCQ).
 */
export type ExamStyle = 'domestic' | 'international'

export const EXAM_STYLES: readonly ExamStyle[] = ['domestic', 'international']

/**
 * Everything about a project's subject that shapes AI prompts. Resolved
 * server-side from the project row (and, for the exam-style default, from its
 * processed materials) — never passed in from the UI.
 */
export interface SubjectContext {
  subject: Subject
  /** BCP-47 primary tag of the language being learnt (`language` courses only). */
  targetLanguage?: string
  /** Effective exam style (`medicine` only): explicit choice or inferred default. */
  examStyle?: ExamStyle
}

/** What prompt helpers accept: a bare subject, or the subject with its details. */
export type SubjectInput = Subject | SubjectContext | undefined

import type { TranslationKey } from '@/i18n/types'
import type { SigFigPolicy } from '@/entities/question/answerDimensions'

export const SUBJECT_LABEL_KEYS: Record<Subject, TranslationKey> = {
  calculus: 'subject.calculus',
  linear_algebra: 'subject.linearAlgebra',
  discrete_math: 'subject.discreteMath',
  physics: 'subject.physics',
  chemistry: 'subject.chemistry',
  biology: 'subject.biology',
  cs: 'subject.computerScience',
  stats: 'subject.statistics',
  medicine: 'subject.medicine',
  language: 'subject.language',
  other: 'subject.other',
}

export interface Project {
  id: string
  name: string
  subject: Subject
  /**
   * Language being learnt, as a lower-case BCP-47 primary tag ('de', 'hu',
   * 'en', 'fr', 'es', …). Only meaningful when `subject === 'language'`.
   */
  targetLanguage?: string
  /**
   * Exam style chosen for a medicine course. Unset → inferred from the
   * course materials (see `resolveExamStyle`).
   */
  examStyle?: ExamStyle
  /**
   * 「有效数字评分规则」: how an answer with the right value and unit but the
   * wrong significant figures counts. Unset ⇒ hint only, no deduction, as a
   * platform rule (`DEFAULT_SIG_FIG_POLICY`).
   */
  sigFigPolicy?: SigFigPolicy
  description?: string
  createdAt: number
  updatedAt: number
}

export interface CreateProjectInput {
  name: string
  subject: Subject
  targetLanguage?: string
  examStyle?: ExamStyle
  description?: string
}

export interface UpdateProjectInput {
  name?: string
  subject?: Subject
  /** `null` clears the field. */
  targetLanguage?: string | null
  /** `null` clears the field (back to the inferred default). */
  examStyle?: ExamStyle | null
  /** `null` clears the rule (back to the platform default). */
  sigFigPolicy?: SigFigPolicy | null
  description?: string
}

/** Normalise a BCP-47 tag to its lower-case primary subtag ('de-AT' → 'de'). */
export function normalizeLanguageTag(tag: string | null | undefined): string | undefined {
  const primary = tag?.trim().split(/[-_]/)[0]?.toLowerCase()
  return primary && /^[a-z]{2,8}$/.test(primary) ? primary : undefined
}
