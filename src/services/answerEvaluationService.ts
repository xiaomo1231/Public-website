import type { Question } from '@/entities/question/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import {
  compareMath,
  numericEquivalent,
  parseNumeric,
} from '@/infrastructure/math/expressionEvaluator'
import { compareQuantity, splitQuantity } from '@/infrastructure/math/quantityAnswer'
import { compareEquations, parseEquation } from '@/infrastructure/chemistry/equation'
import { orderingItems, scoreOrdering } from '@/infrastructure/math/orderingAnswer'
import { expectedAnswerText, optionLetter } from '@/entities/question/types'
import { logger } from '@/infrastructure/logger/logger'
import { unverifiedShortAnswer } from './shortAnswerGrader'
import { compareTargetText, isNearTarget } from '@/shared/lib/language'
import type { BlankResult, NearSpelling } from '@/entities/questionAttempt/types'
import { t } from '@/i18n'

const UNVERIFIED_NOTE = (): string => t('question.unverified')

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface DeterministicOptions {
  /**
   * The language the course teaches (BCP-47, `Project.targetLanguage`):
   * fill-blank answers must then be spelt exactly — accents, capitals and
   * spelling variants earn half a blank, with a hint.
   */
  targetLanguage?: string | undefined
}

/**
 * Deterministic answer evaluation. Never calls the network — callers may
 * layer an AI fallback on top when the result is `unverified`.
 */
export function evaluateDeterministic(
  question: Question,
  userAnswer: string,
  options: DeterministicOptions = {},
): QuestionEvaluation {
  switch (question.type) {
    case 'multiple_choice':
      return evaluateOption(question, userAnswer, false)
    case 'true_false':
      return evaluateOption(question, userAnswer, true)
    case 'numeric':
      return evaluateNumeric(question, userAnswer)
    case 'math_expr':
      return evaluateMath(question, userAnswer)
    case 'code_output':
      return evaluateCodeOutput(question, userAnswer)
    case 'chem_equation':
      return evaluateChemEquation(question, userAnswer)
    case 'ordering':
      return evaluateOrdering(question, userAnswer)
    case 'multiple_select':
      return evaluateMultipleSelect(question, userAnswer)
    case 'matching':
      return evaluateMatching(question, userAnswer)
    case 'fill_blank':
      return evaluateFillBlank(question, userAnswer, options.targetLanguage)
    case 'short_answer':
      // Graded by scoring points with AI (ShortAnswerGrader); offline it is
      // shown with its points but not scored.
      return unverifiedShortAnswer(question, userAnswer.trim(), t('shortAnswer.needsAi'))
    default: {
      const exhaustive: never = question.type
      void exhaustive
      return { isCorrect: null, method: 'unverified', confidence: 0, note: UNVERIFIED_NOTE() }
    }
  }
}

const TRUE_WORDS = new Set(['true', 't', 'yes', 'y', '1', '正确', '对', '是', '√', '✓', '✔'])
const FALSE_WORDS = new Set(['false', 'f', 'no', 'n', '0', '错误', '错', '否', '×', '✗', '✘', 'x'])

/** Read a true/false answer, including Chinese words, ticks/crosses and JSON booleans. */
export function parseTrueFalse(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const v = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[。.!！]$/, '')
  if (TRUE_WORDS.has(v)) return true
  if (FALSE_WORDS.has(v)) return false
  return null
}

function evaluateOption(
  question: Question,
  userAnswer: string,
  isBoolean: boolean,
): QuestionEvaluation {
  const expected = question.correctAnswer.trim()
  const given = userAnswer.trim()

  if (isBoolean) {
    const expectedBool = parseTrueFalse(expected)
    const givenBool = parseTrueFalse(given)
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
    return {
      isCorrect: false,
      method: 'numeric',
      confidence: 1,
      expected,
      normalizedUser: '',
      note: t('errors.emptyAnswer'),
    }
  }
  if (question.unit) return evaluateQuantity(given, expected, question.unit)
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
      return {
        isCorrect: null,
        method: 'unverified',
        confidence: 0,
        expected,
        normalizedUser: given,
        note: UNVERIFIED_NOTE(),
      }
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

/**
 * A physical quantity: the value is converted from the student's unit into the
 * expected one, and a missing or incompatible unit is reported as such.
 */
function evaluateQuantity(given: string, expectedValue: string, unit: string): QuestionEvaluation {
  const expected = `${expectedValue} ${unit}`
  const result = compareQuantity(given, expectedValue, unit)
  const base = {
    method: 'unit_conversion' as const,
    expected,
    normalizedUser: given,
    normalizedExpected: expected,
  }
  switch (result.outcome) {
    case 'correct':
    case 'wrong-value':
      return {
        ...base,
        isCorrect: result.isCorrect,
        confidence: 0.99,
        ...(result.outcome === 'wrong-value' && result.convertedValue !== undefined
          ? {
              note: t('question.unitConverted', {
                value: formatConverted(result.convertedValue),
                unit,
              }),
            }
          : {}),
      }
    case 'missing-unit':
      return {
        ...base,
        isCorrect: false,
        confidence: 1,
        note: t('question.unitMissing', { example: `${given} ${unit}` }),
      }
    case 'wrong-dimension':
      return {
        ...base,
        isCorrect: false,
        confidence: 0.99,
        note: t('question.unitWrongDimension', { unit }),
      }
    case 'unreadable-unit':
      return {
        ...base,
        isCorrect: null,
        method: 'unverified',
        confidence: 0,
        note: t('question.unitUnreadable', { unit: splitQuantity(given)?.unitText || given }),
      }
    case 'unreadable-number':
      return {
        ...base,
        isCorrect: null,
        method: 'unverified',
        confidence: 0,
        note: t('errors.numberUnreadable', { answer: UNVERIFIED_NOTE() }),
      }
  }
}

function formatConverted(value: number): string {
  return Number.parseFloat(value.toPrecision(4)).toString()
}

/** Program output: line endings and trailing spaces normalised, otherwise exact. */
export function normalizeProgramOutput(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

function evaluateCodeOutput(question: Question, userAnswer: string): QuestionEvaluation {
  const expected = normalizeProgramOutput(question.correctAnswer)
  const given = normalizeProgramOutput(userAnswer)
  const isCorrect = given === expected
  return {
    isCorrect,
    method: 'exact_output',
    confidence: 1,
    expected,
    normalizedUser: given,
    normalizedExpected: expected,
    ...(isCorrect ? {} : { note: t('question.outputMismatch') }),
  }
}

/**
 * A chemical equation: same species on the same sides, balanced, with
 * coefficients proportional to the reference. Graded locally, no AI.
 */
function evaluateChemEquation(question: Question, userAnswer: string): QuestionEvaluation {
  const expected = question.correctAnswer
  const base = {
    method: 'chem_equation' as const,
    expected,
    normalizedUser: userAnswer.trim(),
    normalizedExpected: expected,
  }
  const reference = parseEquation(expected)
  if (!reference.ok)
    return {
      ...base,
      isCorrect: null,
      method: 'unverified',
      confidence: 0,
      note: UNVERIFIED_NOTE(),
    }
  const result = compareEquations(userAnswer, reference.equation)
  switch (result.verdict) {
    case 'correct':
      return { ...base, isCorrect: true, confidence: 1 }
    case 'unreadable':
      return {
        ...base,
        isCorrect: null,
        method: 'unverified',
        confidence: 0,
        note: result.detail
          ? t('chemEquation.unreadableTerm', { term: result.detail })
          : t('chemEquation.unreadable'),
      }
    case 'species':
      return {
        ...base,
        isCorrect: false,
        confidence: 1,
        note: [
          result.missing.length
            ? t('chemEquation.missing', { species: result.missing.join(', ') })
            : '',
          result.extra.length ? t('chemEquation.extra', { species: result.extra.join(', ') }) : '',
        ]
          .filter(Boolean)
          .join(' '),
      }
    case 'unbalanced':
      return {
        ...base,
        isCorrect: false,
        confidence: 1,
        note: t('chemEquation.unbalanced', {
          details: result.imbalances
            .map((item) =>
              t('chemEquation.imbalance', {
                what: item.what === 'charge' ? t('chemEquation.charge') : item.what,
                left: item.left,
                right: item.right,
              }),
            )
            .join('; '),
        }),
      }
    case 'coefficients':
      return { ...base, isCorrect: false, confidence: 1, note: t('chemEquation.coefficients') }
    case 'isomers':
      // Balanced and right by formula, but a structure is written differently:
      // it may be an isomer, so it is not graded either way.
      return {
        ...base,
        isCorrect: null,
        method: 'unverified',
        confidence: 0,
        note: t('chemEquation.isomers', { species: result.species.join(', ') }),
      }
  }
}

/**
 * X-type: every correct option must be chosen. Partial credit is the number
 * of correct options chosen minus the wrong ones chosen (never below zero),
 * out of the number of correct options.
 */
function evaluateMultipleSelect(question: Question, userAnswer: string): QuestionEvaluation {
  const options = question.options ?? []
  const correct = new Set(options.filter((o) => o.isCorrect).map((o) => o.id))
  const chosen = new Set(
    userAnswer
      .split(',')
      .map((id) => id.trim())
      .filter((id) => options.some((o) => o.id === id)),
  )
  const right = [...chosen].filter((id) => correct.has(id)).length
  const wrong = chosen.size - right
  const total = correct.size
  const letters = (ids: Set<string>) =>
    options
      .map((o, i) => (ids.has(o.id) ? optionLetter(i) : ''))
      .filter(Boolean)
      .join('')
  return {
    isCorrect: total > 0 ? right === total && wrong === 0 : null,
    method: 'multi_select',
    confidence: 1,
    score: { earned: Math.max(0, right - wrong), total },
    expected: expectedAnswerText(question),
    normalizedUser: letters(chosen) || '—',
    normalizedExpected: letters(correct),
  }
}

/** B-type: one option per stem; credit per stem matched correctly. */
function evaluateMatching(question: Question, userAnswer: string): QuestionEvaluation {
  const options = question.options ?? []
  const expectedLabels = question.correctAnswer.split(' | ')
  const given = userAnswer.split(',')
  const items = question.matchItems ?? expectedLabels
  let earned = 0
  const userLetters = items.map((_, i) => {
    const index = options.findIndex((o) => o.id === given[i]?.trim())
    if (index >= 0 && options[index]!.label === expectedLabels[i]) earned++
    return index >= 0 ? optionLetter(index) : '—'
  })
  return {
    isCorrect: items.length > 0 ? earned === items.length : null,
    method: 'match_items',
    confidence: 1,
    score: { earned, total: items.length },
    expected: expectedAnswerText(question),
    normalizedUser: userLetters.map((letter, i) => `${i + 1}${letter}`).join(' '),
    normalizedExpected: expectedLabels
      .map(
        (label, i) =>
          `${i + 1}${optionLetter(
            Math.max(
              0,
              options.findIndex((o) => o.label === label),
            ),
          )}`,
      )
      .join(' '),
  }
}

/** A term reduced for comparison: width, case, spaces and punctuation ignored. */
export function normalizeTerm(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** "乙酰胆碱（ACh）" is accepted when either part is an accepted answer and neither contradicts it. */
export function blankAccepted(given: string, accepted: string[]): boolean {
  const targets = new Set(accepted.map(normalizeTerm).filter(Boolean))
  const whole = normalizeTerm(given)
  if (!whole) return false
  if (targets.has(whole)) return true
  const inner = /[（(]([^（）()]*)[）)]/.exec(given.normalize('NFKC'))
  if (!inner) return false
  const outside = normalizeTerm(given.normalize('NFKC').replace(inner[0], ''))
  const inside = normalizeTerm(inner[1] ?? '')
  return (
    (targets.has(outside) || !outside) &&
    (targets.has(inside) || !inside) &&
    Boolean(outside || inside)
  )
}

/** Credit of one blank: 1 when accepted, half for a near spelling in the target language. */
export function blankCredit(blank: BlankResult): number {
  if (blank.correct) return 1
  return blank.spelling ? 0.5 : 0
}

/**
 * One blank in a course taught in `language`: the closest accepted answer by
 * spelling. Exact → accepted; only accents / capitals / a spelling variant
 * apart → not accepted, with the form it should have been. Otherwise the
 * usual lenient match (punctuation, a "term (abbreviation)" pair) applies.
 */
function targetBlank(answer: string, accepted: string[], language: string): BlankResult {
  let near: { outcome: NearSpelling; expected: string } | null = null
  for (const expected of accepted) {
    const outcome = compareTargetText(expected, answer, language)
    if (outcome === 'exact') return { given: answer, accepted, correct: true }
    if (!near && isNearTarget(outcome)) near = { outcome, expected }
  }
  if (near) {
    return {
      given: answer,
      accepted,
      correct: false,
      spelling: near.outcome,
      expectedForm: near.expected,
    }
  }
  return { given: answer, accepted, correct: blankAccepted(answer, accepted) }
}

/** Fill-blank: each blank against its accepted answers; credit per blank. */
function evaluateFillBlank(
  question: Question,
  userAnswer: string,
  targetLanguage?: string,
): QuestionEvaluation {
  const blanks = question.blanks ?? []
  const given = userAnswer.split('\n')
  const results = blanks.map((accepted, i): BlankResult => {
    const answer = (given[i] ?? '').trim()
    if (targetLanguage && answer) return targetBlank(answer, accepted, targetLanguage)
    return { given: answer, accepted, correct: blankAccepted(answer, accepted) }
  })
  const earned = results.reduce((sum, blank) => sum + blankCredit(blank), 0)
  return {
    isCorrect: blanks.length > 0 ? results.every((blank) => blank.correct) : null,
    method: 'blank_match',
    confidence: 1,
    score: { earned, total: blanks.length },
    blanks: results,
    expected: expectedAnswerText(question),
    normalizedUser: results.map((r, i) => `(${i + 1}) ${r.given || '—'}`).join('  '),
    normalizedExpected: expectedAnswerText(question),
  }
}

/** Steps in order: partial credit for the longest run in the right order. */
function evaluateOrdering(question: Question, userAnswer: string): QuestionEvaluation {
  const score = scoreOrdering(userAnswer, question.correctAnswer)
  const expected = expectedAnswerText(question)
  return {
    isCorrect: score.total > 0 ? score.earned === score.total : null,
    method: 'order_match',
    confidence: 1,
    score,
    expected,
    normalizedUser: orderingItems(userAnswer).join(' → '),
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
