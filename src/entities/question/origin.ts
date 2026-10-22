import type { Question } from './types'
import type { PracticeQuestionInfo } from '@/entities/homework/practice/types'

/**
 * Where a question came from, as the student should read it:
 *
 *   - `original` 原题   — taken from material the student uploaded (a homework
 *                         assignment, a professor practice sheet, a past exam).
 *   - `adapted`  改编题 — a variant built from an original (practice-set full
 *                         version, locally constructed linear systems).
 *   - `ai`       AI 新题 — written by the AI, not copied from any original.
 *
 * Resolved from fields that already exist; nothing new is stored.
 */
export type QuestionOriginKind = 'original' | 'adapted' | 'ai'

export interface QuestionOriginInfo {
  kind: QuestionOriginKind
  /**
   * `ai` only: whether the question was written from real course passages
   * (it cites them) or has no course source at all (`ai_without_source`).
   */
  grounded?: boolean
}

/**
 * Quiz and oral questions are always AI-written. A quiz question cites the
 * course passages it was written from (`grounded`); an exam-scope question
 * for a topic the material does not cover has no source.
 */
export function quizQuestionOrigin(
  question: Pick<Question, 'origin' | 'sourceRefs'>,
): QuestionOriginInfo {
  const grounded = question.origin !== 'ai_without_source' && (question.sourceRefs?.length ?? 0) > 0
  return { kind: 'ai', grounded }
}

/** A professor practice question is read from the professor's own sheet. */
export function professorPracticeOrigin(): QuestionOriginInfo {
  return { kind: 'original' }
}

/**
 * A homework question: the assignment's own questions are originals. A
 * practice-set question mirroring an original (full version) or built locally
 * from a known template (linear systems) is adapted; an AI-written lite
 * question is new.
 */
export function homeworkQuestionOrigin(question: {
  practice?: Pick<PracticeQuestionInfo, 'origin' | 'sourceQuestionId'>
}): QuestionOriginInfo {
  const practice = question.practice
  if (!practice) return { kind: 'original' }
  if (practice.sourceQuestionId || practice.origin === 'local') return { kind: 'adapted' }
  return { kind: 'ai', grounded: false }
}

/**
 * Who set a question's scoring points.
 *
 *   - `professor` — split from the professor's answer / marking scheme.
 *   - `platform`  — written by the platform's AI; never the professor's.
 */
export type RubricSource = 'professor' | 'platform'

/**
 * The source to show. An unknown source (rows written before the field
 * existed) reads as `platform` — the safe side: AI scoring points are never
 * presented as the professor's. A caller that knows by construction the
 * points come from the professor (Professor Practice: the rubric extractor
 * only ever splits the professor's reference answer) passes `professor` as
 * the fallback.
 */
export function rubricSourceOf(
  source: RubricSource | undefined,
  fallback: RubricSource = 'platform',
): RubricSource {
  return source === 'professor' || source === 'platform' ? source : fallback
}
