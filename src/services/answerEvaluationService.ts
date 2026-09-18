import type { Question } from '@/entities/question/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import {
  compareMath,
  numericEquivalent,
  parseNumeric,
} from '@/infrastructure/math/expressionEvaluator'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

const UNVERIFIED_NOTE = (): string => t('question.unverified')

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Deterministic answer evaluation. Never calls the network — callers may
 * layer an AI fallback on top when the result is `unverified`.
 */
export function evaluateDeterministic(question: Question, userAnswer: string): QuestionEvaluation {
  switch (question.type) {
    case 'multiple_choice':
      return evaluateOption(question, userAnswer, false)
    case 'true_false':
      return evaluateOption(question, userAnswer, true)
    case 'numeric':
      return evaluateNumeric(question, userAnswer)
    case 'math_expr':
      return evaluateMath(question, userAnswer)
    default: {
      const exhaustive: never = question.type
      void exhaustive
      return { isCorrect: null, method: 'unverified', confidence: 0, note: UNVERIFIED_NOTE() }
    }
  }
}

function evaluateOption(question: Question, userAnswer: string, isBoolean: boolean): QuestionEvaluation {
  const expected = question.correctAnswer.trim()
  const given = userAnswer.trim()

  if (isBoolean) {
    const parseBool = (s: string): boolean | null => {
      const v = s.toLowerCase().trim()
      if (['true', 't', 'yes', 'y', '1'].includes(v)) return true
      if (['false', 'f', 'no', 'n', '0'].includes(v)) return false
      return null
    }
    const expectedBool = parseBool(expected)
    const givenBool = parseBool(given)
    if (expectedBool !== null && givenBool !== null) {
      return {
        isCorrect: expectedBool === givenBool,
        method: 'exact',
        confidence: 1,
        expected,
        normalizedUser: given,
        normalizedExpected: expected,
      }
    }
    // Fall through to string comparison if the AI stored "True"/"False" as text
  }

  // Multiple choice: accept either the option id ("opt-2") or the label text.
  const options = question.options ?? []
  const expectedOption = options.find((o) => o.id === expected || norm(o.label) === norm(expected))
  const givenOption = options.find((o) => o.id === given || norm(o.label) === norm(given))

  if (expectedOption && givenOption) {
    return {
      isCorrect: expectedOption.id === givenOption.id,
      method: 'option_id',
      confidence: 1,
      expected: expectedOption.label,
      normalizedUser: givenOption.label,
      normalizedExpected: expectedOption.label,
    }
  }

  return {
    isCorrect: norm(expected) === norm(given),
    method: 'case_insensitive',
    confidence: 0.8,
    expected,
    normalizedUser: given,
    normalizedExpected: expected,
  }
}

function evaluateNumeric(question: Question, userAnswer: string): QuestionEvaluation {
  const given = userAnswer.trim()
  const expected = question.correctAnswer.trim()
  if (!given) {
    return { isCorrect: false, method: 'numeric', confidence: 1, expected, normalizedUser: '', note: t('errors.emptyAnswer') }
  }
  const result = numericEquivalent(given, expected)
  if (result === null) {
    const userNum = parseNumeric(given)
    const expectedNum = parseNumeric(expected)
    if (userNum === null) {
      return {
        isCorrect: null,
        method: 'unverified',
        confidence: 0,
        expected,
        normalizedUser: given,
        note: t('errors.numberUnreadable', { answer: UNVERIFIED_NOTE() }),
      }
    }
    if (expectedNum === null) {
      return { isCorrect: null, method: 'unverified', confidence: 0, expected, normalizedUser: given, note: UNVERIFIED_NOTE() }
    }
  }
  return {
    isCorrect: result,
    method: 'numeric_tolerance',
    confidence: 0.99,
    expected,
    normalizedUser: given,
    normalizedExpected: expected,
  }
}

function evaluateMath(question: Question, userAnswer: string): QuestionEvaluation {
  const comparison = compareMath(userAnswer, question.correctAnswer)
  return {
    isCorrect: comparison.equivalent,
    method: 'math_equivalent',
    confidence: comparison.equivalent === null ? 0 : 0.95,
    expected: comparison.normalizedExpected,
    normalizedUser: comparison.normalizedUser,
    normalizedExpected: comparison.normalizedExpected,
    ...(comparison.note ? { note: comparison.note } : {}),
  }
}

/**
 * Convert a free-text AI verdict into a `QuestionEvaluation`. Used as a
 * fallback when the deterministic evaluator returns `unverified`.
 */
export function evaluationFromAI(
  verdict: { isCorrect: boolean; feedback?: string; confidence?: number },
  fallback: QuestionEvaluation,
): QuestionEvaluation {
  logger.debug('AI answer evaluation used', { isCorrect: verdict.isCorrect })
  return {
    isCorrect: verdict.isCorrect,
    method: 'ai',
    confidence: verdict.confidence ?? 0.7,
    ...(fallback.expected ? { expected: fallback.expected } : {}),
    ...(fallback.normalizedUser ? { normalizedUser: fallback.normalizedUser } : {}),
    ...(verdict.feedback ? { explanation: verdict.feedback } : {}),
    note: t('errors.judgedByAi'),
  }
}

export const UNVERIFIED_MESSAGE = t('question.unverified')