/**
 * Schema validation + sanitisation for tutor AI output.
 *
 * Both the generated question and the evaluation are coerced into the
 * expected shape before use. A question that cannot be salvaged is rejected
 * (thrown) rather than presented to the student.
 */

import type { DifficultyLevel, TutorEvaluation } from '@/infrastructure/ai/prompts/types'
import type { TutorQuestion } from '@/entities/tutorSession/types'
import {
  asBoolean,
  asEnum,
  asStringArray,
  asTrimmedString,
} from '@/infrastructure/ai/validation'
import { AppError } from '@/infrastructure/errors/AppError'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { t } from '@/i18n'

const QUESTION_TYPES = ['multiple_choice', 'true_false', 'numeric', 'math_expr'] as const

/**
 * Canonicalise the maths in model-authored text before it is stored or shown.
 *
 * Applied to both the prompt and the expected answer, so option/answer matching
 * (which compares them as strings) stays consistent. This is where a Private
 * Use Area glyph copied out of the source is recovered or marked, rather than
 * reaching the student.
 */
function cleanMath(value: string): string {
  return normalizeMathNotation(value).text
}

const DIFFICULTIES: readonly DifficultyLevel[] = [
  'beginner',
  'basic',
  'intermediate',
  'advanced',
  'challenge',
]

/** Coerce model output into a usable `TutorQuestion`, or throw. */
export function normalizeTutorQuestion(raw: unknown): TutorQuestion {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const prompt = cleanMath(asTrimmedString(record.prompt))
  const expectedAnswer = cleanMath(asTrimmedString(record.expectedAnswer))
  if (!prompt || !expectedAnswer) {
    throw new AppError(t('errors.aiNoQuestion'), 'MALFORMED_QUESTION')
  }
  const options = asStringArray(record.options).map(cleanMath)
  return {
    id: '',
    prompt,
    type: asEnum(record.type, QUESTION_TYPES, 'multiple_choice'),
    ...(options.length > 0 ? { options } : {}),
    expectedAnswer,
    explanation: cleanMath(asTrimmedString(record.explanation)),
    knowledgePoint: asTrimmedString(record.knowledgePoint, 'General'),
    difficulty: asEnum(record.difficulty, DIFFICULTIES, 'basic'),
    sourceRefs: [],
    hints: asStringArray(record.hints).slice(0, 5).map(cleanMath),
  }
}

/** Coerce model output into a usable `TutorEvaluation`. */
export function normalizeTutorEvaluation(raw: unknown): TutorEvaluation {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const grounded = cleanMath(asTrimmedString(record.groundedExplanation))
  const feedback = cleanMath(asTrimmedString(record.feedback, t('errors.tutorFeedbackFallback')))
  return {
    isCorrect: asBoolean(record.isCorrect, false),
    feedback,
    breakdown: asStringArray(record.breakdown).map(cleanMath),
    nextSteps: cleanMath(asTrimmedString(record.nextSteps)),
    groundedExplanation: grounded || feedback,
    isSupplementary: asBoolean(record.isSupplementary, false),
  }
}
