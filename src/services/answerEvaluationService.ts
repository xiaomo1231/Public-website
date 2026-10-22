import type { Question } from '@/entities/question/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import {
  compareMath,
  numericEquivalent,
  parseNumeric,
} from '@/infrastructure/math/expressionEvaluator'
import { compareQuantity, splitQuantity } from '@/infrastructure/math/quantityAnswer'
import {
  judgeSigFigs,
  readSigFigs,
  sigFigRelativeTolerance,
} from '@/infrastructure/math/significantFigures'
import { compareVector } from '@/infrastructure/math/vectorAnswer'
import { compareFormula, nameAccepted } from '@/infrastructure/chemistry/nomenclature'
import {
  DEFAULT_SIG_FIG_POLICY,
  sigFigCredit,
  type AnswerDimensions,
  type SigFigPolicy,
  type UnitStatus,
} from '@/entities/question/answerDimensions'
import { forceListScore, gradeForceList } from '@/entities/question/forceList'
import { dimensionsNote } from './answerDimensionsFeedback'
import { compareEquations, parseEquation } from '@/infrastructure/chemistry/equation'
import { orderingItems, scoreOrdering } from '@/infrastructure/math/orderingAnswer'
import { displayAnswer, expectedAnswerText, optionLetter } from '@/entities/question/types'
import { logger } from '@/infrastructure/logger/logger'
import { unverifiedShortAnswer } from './shortAnswerGrader'
import { compareTargetText, isNearTarget } from '@/shared/lib/language'
import type { BlankResult, NearSpelling } from '@/entities/questionAttempt/types'
import { t, type TranslationKey } from '@/i18n'
import {
  decodeGenderAnswer,
  paradigmBlanks,
  paradigmCellLabel,
  stripPluralArticle,
} from '@/entities/question/languageDrills'

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
  /**
   * The course's significant-figure rule (`Project.sigFigPolicy`): how an
   * answer with the right value and unit but the wrong significant figures
   * counts. Default: hint only, no deduction (平台拟定规则).
   */
  sigFigPolicy?: SigFigPolicy | undefined
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
      return evaluateNumeric(question, userAnswer, options.sigFigPolicy ?? DEFAULT_SIG_FIG_POLICY)
    case 'vector':
      return evaluateVector(question, userAnswer)
    case 'nomenclature':
      return evaluateNomenclature(question, userAnswer)
    case 'force_list':
      return evaluateForceList(question, userAnswer)
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
    case 'article_gender':
      return evaluateArticleGender(question, userAnswer)
    case 'paradigm_table':
      return evaluateParadigm(question, userAnswer, options.targetLanguage)
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

/** The number of a plain numeric answer: an expression (`3/4`) or scientific notation (`6.02×10^23`). */
function readAnswerNumber(text: string): number | null {
  const direct = parseNumeric(text)
  if (direct !== null) return direct
  const split = splitQuantity(text)
  return split && !split.unitText ? split.value : null
}

function withinTolerance(value: number, expected: number, relTol: number): boolean {
  if (expected === 0) return Math.abs(value) <= 1e-9
  return Math.abs(value - expected) <= relTol * Math.abs(expected)
}

/**
 * The significant-figure dimension of an answer, read from the digits the
 * student typed. A plain numeric answer must be a single written number
 * (`3/4` has no significant figures to judge); a quantity may be followed by
 * its unit.
 */
function sigFigDimension(
  question: Question,
  given: string,
  allowUnit: boolean,
): AnswerDimensions['sigFigs'] {
  const required = question.sigFigs
  if (!required) return undefined
  const basis = question.sigFigsBasis ? { basis: question.sigFigsBasis } : {}
  const reading = readSigFigs(given)
  const rest = reading ? reading.rest.trim() : ''
  if (!reading || (!allowUnit && rest)) return { status: 'unreadable', required, ...basis }
  const judgement = judgeSigFigs(given, required)
  return {
    status: judgement.status,
    required,
    ...(judgement.given ? { given: judgement.given } : {}),
    ...(judgement.ambiguous ? { ambiguous: true } : {}),
    ...basis,
  }
}

/**
 * Value, unit and significant figures are judged separately; this turns the
 * three into a verdict under the course rule. A wrong value or unit is wrong;
 * a significant-figure slip on a right value and unit is a hint (full credit)
 * or a deduction, as the course rule says — never decided silently.
 */
function finishNumeric(
  base: Omit<QuestionEvaluation, 'isCorrect' | 'confidence'>,
  dimensions: AnswerDimensions,
  policy: SigFigPolicy,
  extra: { convertedValue?: number; unit?: string; given: string } = { given: '' },
): QuestionEvaluation {
  const rule = dimensions.sigFigs
    ? {
        sigFigRule: {
          mode: policy.mode,
          ...(policy.mode === 'deduct' && policy.percent !== undefined
            ? { percent: policy.percent }
            : {}),
          source: policy.source,
          deducted: false,
        },
      }
    : {}
  const unitStatus: UnitStatus | undefined = dimensions.unit?.status
  const note = dimensionsNote(dimensions, extra)
  const withNote = note ? { note } : {}
  if (dimensions.value === 'unreadable' || unitStatus === 'unreadable') {
    return {
      ...base,
      ...rule,
      dimensions,
      isCorrect: null,
      method: 'unverified',
      confidence: 0,
      ...withNote,
    }
  }
  const valueAndUnitRight =
    dimensions.value === 'correct' && (!unitStatus || unitStatus === 'correct')
  if (!valueAndUnitRight) {
    return { ...base, ...rule, dimensions, isCorrect: false, confidence: 0.99, ...withNote }
  }
  const sigFigStatus = dimensions.sigFigs?.status
  if (sigFigStatus === 'too-many' || sigFigStatus === 'too-few') {
    const deducted = policy.mode === 'deduct'
    const credit = sigFigCredit(policy)
    return {
      ...base,
      dimensions,
      sigFigRule: {
        mode: policy.mode,
        ...(deducted && policy.percent !== undefined ? { percent: policy.percent } : {}),
        source: policy.source,
        deducted,
      },
      isCorrect: !deducted,
      confidence: 0.99,
      ...(deducted ? { score: { earned: credit, total: 1 } } : {}),
      ...withNote,
    }
  }
  return { ...base, ...rule, dimensions, isCorrect: true, confidence: 0.99, ...withNote }
}

function evaluateNumeric(
  question: Question,
  userAnswer: string,
  policy: SigFigPolicy,
): QuestionEvaluation {
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
  if (question.unit) return evaluateQuantity(question, given, expected, question.unit, policy)
  if (!question.sigFigs) return evaluatePlainNumber(given, expected)
  const expectedNum = parseNumeric(expected)
  const userNum = readAnswerNumber(given)
  const base = {
    method: 'numeric_tolerance' as const,
    expected,
    normalizedUser: given,
    normalizedExpected: expected,
  }
  if (userNum === null || expectedNum === null) {
    return {
      ...base,
      isCorrect: null,
      method: 'unverified',
      confidence: 0,
      note:
        userNum === null
          ? t('errors.numberUnreadable', { answer: UNVERIFIED_NOTE() })
          : UNVERIFIED_NOTE(),
    }
  }
  const tolerance = sigFigRelativeTolerance(given, expectedNum, question.sigFigs)
  const dimensions: AnswerDimensions = {
    value: withinTolerance(userNum, expectedNum, tolerance) ? 'correct' : 'wrong',
  }
  const sigFigs = sigFigDimension(question, given, false)
  if (sigFigs) dimensions.sigFigs = sigFigs
  return finishNumeric(base, dimensions, policy, { given })
}

/** A bare number with no unit and no significant-figure requirement: 1% tolerance. */
function evaluatePlainNumber(given: string, expected: string): QuestionEvaluation {
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
 * A physical quantity. Three separate checks: the VALUE (converted from the
 * student's unit into the expected one), the UNIT (missing / another kind of
 * quantity / a convertible but wrong unit) and, when required, the
 * SIGNIFICANT FIGURES of the number as typed.
 */
function evaluateQuantity(
  question: Question,
  given: string,
  expectedValue: string,
  unit: string,
  policy: SigFigPolicy,
): QuestionEvaluation {
  const expected = `${expectedValue} ${unit}`
  const expectedNumber = Number(expectedValue)
  const relTol =
    question.sigFigs && Number.isFinite(expectedNumber)
      ? sigFigRelativeTolerance(given, expectedNumber, question.sigFigs)
      : undefined
  const result = compareQuantity(given, expectedValue, unit, relTol ? { relTol } : {})
  const base = {
    method: 'unit_conversion' as const,
    expected,
    normalizedUser: given,
    normalizedExpected: expected,
  }
  const unitDimension = (status: UnitStatus): NonNullable<AnswerDimensions['unit']> => ({
    status,
    expected: unit,
    ...(result.givenUnit ? { given: result.givenUnit } : {}),
    ...(result.converted ? { converted: true } : {}),
  })
  let dimensions: AnswerDimensions
  switch (result.outcome) {
    case 'correct':
      dimensions = { value: 'correct', unit: unitDimension('correct') }
      break
    case 'wrong-value':
      dimensions = { value: 'wrong', unit: unitDimension('correct') }
      break
    case 'wrong-unit':
      // The number is right for the expected unit; the unit written is not.
      dimensions = { value: 'correct', unit: unitDimension('wrong-unit') }
      break
    case 'missing-unit': {
      const bare = splitQuantity(given)
      dimensions = {
        value:
          bare &&
          Number.isFinite(expectedNumber) &&
          withinTolerance(bare.value, expectedNumber, relTol ?? 1e-2)
            ? 'correct'
            : 'wrong',
        unit: unitDimension('missing'),
      }
      break
    }
    case 'wrong-dimension':
      dimensions = { value: 'wrong', unit: unitDimension('wrong-dimension') }
      break
    case 'unreadable-unit':
      dimensions = { value: 'unreadable', unit: unitDimension('unreadable') }
      break
    case 'unreadable-number':
      dimensions = { value: 'unreadable' }
      break
  }
  const sigFigs =
    dimensions.value !== 'unreadable' ? sigFigDimension(question, given, true) : undefined
  if (sigFigs) dimensions.sigFigs = sigFigs
  return finishNumeric(base, dimensions, policy, {
    given,
    unit,
    ...(result.convertedValue !== undefined ? { convertedValue: result.convertedValue } : {}),
  })
}

/**
 * A vector, as components or as magnitude + direction: converted to
 * components and compared within 1% of the magnitude and 1° of direction.
 */
function evaluateVector(question: Question, userAnswer: string): QuestionEvaluation {
  const spec = question.vector
  const expected = expectedAnswerText(question)
  const base = {
    method: 'vector' as const,
    expected,
    normalizedUser: userAnswer.trim(),
    normalizedExpected: expected,
  }
  if (!spec)
    return {
      ...base,
      isCorrect: null,
      method: 'unverified',
      confidence: 0,
      note: UNVERIFIED_NOTE(),
    }
  if (!userAnswer.trim())
    return { ...base, isCorrect: false, confidence: 1, note: t('errors.emptyAnswer') }
  const comparison = compareVector(userAnswer, spec)
  const note = vectorNote(comparison.outcome, comparison.signs, spec.unit, comparison.convertedFrom)
  if (comparison.outcome === 'unreadable' || comparison.outcome === 'unreadable-unit')
    return {
      ...base,
      vector: comparison,
      isCorrect: null,
      method: 'unverified',
      confidence: 0,
      note,
    }
  return {
    ...base,
    vector: comparison,
    isCorrect: comparison.outcome === 'correct',
    confidence: 0.99,
    ...(note ? { note } : {}),
  }
}

const AXIS_NAMES = ['x', 'y', 'z']

function vectorNote(
  outcome: string,
  signs: number[] | undefined,
  unit: string | undefined,
  convertedFrom: string | undefined,
): string {
  switch (outcome) {
    case 'correct':
      return convertedFrom && unit ? t('vector.converted', { from: convertedFrom, unit }) : ''
    case 'wrong-sign':
      return t('vector.wrongSign', {
        axes: (signs ?? []).map((i) => AXIS_NAMES[i] ?? String(i + 1)).join(', '),
      })
    case 'swapped':
      return t('vector.swapped')
    case 'direction-wrong':
      return t('vector.directionWrong')
    case 'magnitude-wrong':
      return t('vector.magnitudeWrong')
    case 'component-count':
      return t('vector.componentCount')
    case 'missing-unit':
      return t('vector.missingUnit', { unit: unit ?? '' })
    case 'wrong-dimension':
      return t('vector.wrongDimension', { unit: unit ?? '' })
    case 'unreadable-unit':
      return t('vector.unreadableUnit')
    case 'unreadable':
      return t('vector.unreadable')
    default:
      return t('vector.wrong')
  }
}

/**
 * Nomenclature. Name → formula: compared by composition and charge (and mass
 * number for a nuclide). Formula → name: compared with the accepted names; a
 * name that does not match is reported as a blank so the AI equivalence check
 * (as for fill-blanks) can still accept an exact synonym.
 */
function evaluateNomenclature(question: Question, userAnswer: string): QuestionEvaluation {
  const spec = question.nomenclature
  const expected = question.correctAnswer
  const given = userAnswer.trim()
  const base = {
    method: 'nomenclature' as const,
    expected,
    normalizedUser: given,
    normalizedExpected: expected,
  }
  if (!spec)
    return {
      ...base,
      isCorrect: null,
      method: 'unverified',
      confidence: 0,
      note: UNVERIFIED_NOTE(),
    }
  if (!given) return { ...base, isCorrect: false, confidence: 1, note: t('errors.emptyAnswer') }
  if (spec.direction === 'formula_to_name') {
    const correct = nameAccepted(given, spec.names)
    return {
      ...base,
      isCorrect: correct,
      confidence: 1,
      blanks: [{ label: t('nomenclature.name'), given, accepted: spec.names, correct }],
      ...(correct ? {} : { note: t('nomenclature.nameMismatch') }),
    }
  }
  const outcome = compareFormula(given, spec.formula)
  switch (outcome) {
    case 'correct':
      return { ...base, isCorrect: true, confidence: 1 }
    case 'isomers':
      return {
        ...base,
        isCorrect: null,
        method: 'unverified',
        confidence: 0,
        note: t('chemEquation.isomers', { species: given }),
      }
    case 'unreadable':
      return {
        ...base,
        isCorrect: null,
        method: 'unverified',
        confidence: 0,
        note: t('nomenclature.unreadable'),
      }
    default:
      return {
        ...base,
        isCorrect: false,
        confidence: 1,
        note: t(
          outcome === 'charge'
            ? 'nomenclature.charge'
            : outcome === 'mass-number'
              ? 'nomenclature.massNumber'
              : 'nomenclature.composition',
        ),
      }
  }
}

/** Free-body diagram: forces matched by type and direction (±10°). */
function evaluateForceList(question: Question, userAnswer: string): QuestionEvaluation {
  const reference = question.forces ?? []
  const expected = expectedAnswerText(question)
  const base = {
    method: 'force_list' as const,
    expected,
    normalizedUser: displayAnswer(question, userAnswer),
    normalizedExpected: expected,
  }
  if (reference.length === 0)
    return {
      ...base,
      isCorrect: null,
      method: 'unverified',
      confidence: 0,
      note: UNVERIFIED_NOTE(),
    }
  const result = gradeForceList(userAnswer, reference)
  const earned = forceListScore(result, reference.length) * reference.length
  const isCorrect =
    result.matched.length === reference.length &&
    result.extra.length === 0 &&
    result.unreadable === 0
  const name = (type: string) => t(`forceType.${type}` as TranslationKey)
  const parts = [
    result.missing.length
      ? t('forceList.missing', { forces: result.missing.map(name).join(', ') })
      : '',
    result.extra.length ? t('forceList.extra', { forces: result.extra.map(name).join(', ') }) : '',
    result.wrongDirection.length
      ? t('forceList.wrongDirection', { forces: result.wrongDirection.map(name).join(', ') })
      : '',
    result.wrongMagnitude.length
      ? t('forceList.wrongMagnitude', { forces: result.wrongMagnitude.map(name).join(', ') })
      : '',
    result.unreadable ? t('forceList.unreadable', { count: result.unreadable }) : '',
  ].filter(Boolean)
  return {
    ...base,
    forces: result,
    isCorrect,
    confidence: 1,
    score: { earned: Math.round(earned * 100) / 100, total: reference.length },
    ...(parts.length ? { note: parts.join(' ') } : {}),
  }
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
                what:
                  item.what === 'charge'
                    ? t('chemEquation.charge')
                    : item.what === 'mass number'
                      ? t('chemEquation.massNumber')
                      : item.what === 'atomic number'
                        ? t('chemEquation.atomicNumber')
                        : item.what,
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

/**
 * One form in the course's language, graded by spelling: exact → 1, only
 * accents / capitals / a spelling variant apart → ½ with the form it should
 * have been, anything else → 0. The closest accepted form wins.
 */
export function gradeTargetForm(
  answer: string,
  accepted: string[],
  language: string | undefined,
  label?: string,
): BlankResult {
  const given = answer.trim()
  const base = { ...(label ? { label } : {}), given, accepted }
  if (!given) return { ...base, correct: false }
  let near: { outcome: NearSpelling; expected: string } | null = null
  for (const expected of accepted) {
    const outcome = compareTargetText(expected, given, language)
    if (outcome === 'exact') return { ...base, correct: true }
    if (!near && isNearTarget(outcome)) near = { outcome, expected }
  }
  return near
    ? { ...base, correct: false, spelling: near.outcome, expectedForm: near.expected }
    : { ...base, correct: false }
}

/**
 * German article (and plural): the article is one point, right or wrong; the
 * plural, when asked, is a second point graded by spelling (half for an
 * umlaut or capital slip). Correct only when everything is exact.
 */
function evaluateArticleGender(question: Question, userAnswer: string): QuestionEvaluation {
  const noun = question.gender
  const expected = expectedAnswerText(question)
  if (!noun) {
    return { isCorrect: null, method: 'unverified', confidence: 0, note: UNVERIFIED_NOTE() }
  }
  const { article, plural } = decodeGenderAnswer(userAnswer)
  const parts: BlankResult[] = [
    {
      label: t('articleGender.article'),
      given: article,
      accepted: [noun.article],
      correct: article.toLowerCase() === noun.article,
    },
  ]
  if (noun.plural) {
    parts.push(
      gradeTargetForm(stripPluralArticle(plural), [noun.plural], 'de', t('articleGender.plural')),
    )
  }
  const earned = parts.reduce((sum, part) => sum + blankCredit(part), 0)
  return {
    isCorrect: parts.every((part) => part.correct),
    method: 'article_gender',
    confidence: 1,
    score: { earned, total: parts.length },
    blanks: parts,
    expected,
    normalizedUser: displayAnswer(question, userAnswer),
    normalizedExpected: expected,
  }
}

/**
 * Paradigm table: each blank against its accepted forms, by spelling in the
 * course's language. Score = sum of cell credits / blanks; correct only when
 * every cell is exact.
 */
function evaluateParadigm(
  question: Question,
  userAnswer: string,
  targetLanguage?: string,
): QuestionEvaluation {
  const table = question.paradigm
  const blanks = table ? paradigmBlanks(table) : []
  if (!table || blanks.length === 0) {
    return { isCorrect: null, method: 'unverified', confidence: 0, note: UNVERIFIED_NOTE() }
  }
  const given = userAnswer.split('\n')
  const cells = blanks.map((blank, i) =>
    gradeTargetForm(
      given[i] ?? '',
      blank.accepted,
      targetLanguage,
      paradigmCellLabel(table, blank.row, blank.column),
    ),
  )
  const earned = cells.reduce((sum, cell) => sum + blankCredit(cell), 0)
  const expected = expectedAnswerText(question)
  return {
    isCorrect: cells.every((cell) => cell.correct),
    method: 'paradigm_cells',
    confidence: 1,
    score: { earned, total: cells.length },
    blanks: cells,
    expected,
    normalizedUser: displayAnswer(question, userAnswer),
    normalizedExpected: expected,
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
