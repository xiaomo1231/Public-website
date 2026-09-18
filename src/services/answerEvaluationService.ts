import type { Question } from '@/entities/question/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import {
  compareMath,
  numericEquivalent,
  parseNumeric,
} from '@/infrastructure/math/expressionEvaluator'
import { logger } from '@/infrastructure/logger/logger'

const UNVERIFIED_NOTE = 'Unable to verify automatically'

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function stripArticle(text: string): string {
  return norm(text).replace(/^(a|an|the)\s+/, '')
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'is', 'are', 'to', 'in', 'on', 'at', 'by', 'for',
  'and', 'or', 'as', 'it', 'its', 'that', 'this', 'with', 'from',
])

function contentTokens(text: string): string[] {
  return stripArticle(text)
    .split(/[\s,;]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
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
    case 'short_answer':
      return evaluateShortAnswer(question, userAnswer)
    default: {
      const exhaustive: never = question.type
      void exhaustive
      return { isCorrect: null, method: 'unverified', confidence: 0, note: UNVERIFIED_NOTE }
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
    return { isCorrect: false, method: 'numeric', confidence: 1, expected, normalizedUser: '', note: 'Empty answer' }
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
        note: `${UNVERIFIED_NOTE} — could not read your number.`,
      }
    }
    if (expectedNum === null) {
      return { isCorrect: null, method: 'unverified', confidence: 0, expected, normalizedUser: given, note: UNVERIFIED_NOTE }
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

function evaluateShortAnswer(question: Question, userAnswer: string): QuestionEvaluation {
  const given = userAnswer.trim()
  const expected = question.correctAnswer.trim()
  if (!given) {
    return { isCorrect: false, method: 'exact', confidence: 1, expected, normalizedUser: '', note: 'Empty answer' }
  }
  if (stripArticle(given) === stripArticle(expected)) {
    return {
      isCorrect: true,
      method: 'case_insensitive',
      confidence: 0.95,
      expected,
      normalizedUser: given,
      normalizedExpected: expected,
    }
  }

  // Split the canonical answer on common separators (e.g. "rate of change | derivative").
  const alternatives = expected
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const alt of alternatives) {
    if (stripArticle(given) === stripArticle(alt)) {
      return {
        isCorrect: true,
        method: 'case_insensitive',
        confidence: 0.9,
        expected,
        normalizedUser: given,
        normalizedExpected: alt,
      }
    }
  }

  // Token overlap heuristic — a weak signal we surface with low confidence.
  const expectedTokens = new Set(contentTokens(expected))
  const givenTokens = contentTokens(given)
  if (expectedTokens.size > 0 && givenTokens.length > 0) {
    const hits = givenTokens.filter((t) => expectedTokens.has(t)).length
    const recall = hits / expectedTokens.size
    const precision = hits / givenTokens.length
    if (recall >= 0.75 && precision >= 0.75) {
      return {
        isCorrect: true,
        method: 'ai',
        confidence: 0.6,
        expected,
        normalizedUser: given,
        normalizedExpected: expected,
        note: 'Accepted based on keyword overlap.',
      }
    }
  }

  return {
    isCorrect: null,
    method: 'unverified',
    confidence: 0,
    expected,
    normalizedUser: given,
    normalizedExpected: expected,
    note: `${UNVERIFIED_NOTE} — this answer needs review.`,
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
    note: 'Judged by AI.',
  }
}

export const UNVERIFIED_MESSAGE = UNVERIFIED_NOTE