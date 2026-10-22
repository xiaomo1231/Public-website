import { beforeEach, describe, expect, it } from 'vitest'
import {
  formatSigFigs,
  judgeSigFigs,
  readSigFigs,
  sigFigRelativeTolerance,
  sigFigsOf,
} from '@/infrastructure/math/significantFigures'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import type { Question } from '@/entities/question/types'
import {
  answerIssueTags,
  hasSigFigIssue,
  isSigFigOnlyError,
  normalizeSigFigPolicy,
} from '@/entities/question/answerDimensions'
import { sigFigRuleText } from '@/services/answerDimensionsFeedback'
import { setUILanguage } from '@/i18n'

function q(partial: Partial<Question>): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'kp',
    type: 'numeric',
    difficulty: 'basic',
    prompt: 'Compute it.',
    correctAnswer: '1.46',
    hints: [],
    sourceRefs: [],
    promptVersion: 'v9',
    createdAt: 0,
    ...partial,
  }
}

describe('reading significant figures from the typed answer', () => {
  it.each([
    ['0.00450', 3, 3],
    ['4.50', 3, 3],
    ['4.5', 2, 2],
    ['1500', 2, 4],
    ['1500.', 4, 4],
    ['1.50×10^3', 3, 3],
    ['1.50 x 10^3', 3, 3],
    ['6.02e23', 3, 3],
    ['6.02E+23', 3, 3],
    ['6.02 × 10²³', 3, 3],
    ['6.022*10^(23)', 4, 4],
    ['−2.0E-3', 2, 2],
    ['-0.0300', 3, 3],
    ['100', 1, 3],
    ['0', 1, 1],
    ['0.00', 1, 2],
    ['1,500', 2, 4],
    ['12.0 kJ/mol', 3, 3],
    ['3.0e8 m/s', 2, 2],
    ['7', 1, 1],
    ['+25.00', 4, 4],
  ])('%s → %i–%i', (text, min, max) => {
    const reading = readSigFigs(text)
    expect(reading).not.toBeNull()
    expect([reading!.min, reading!.max]).toEqual([min, max])
  })

  it('keeps what follows the number (the unit)', () => {
    expect(readSigFigs('12.0 kJ/mol')!.rest.trim()).toBe('kJ/mol')
    expect(readSigFigs('3/4')!.rest).toBe('/4')
  })

  it('reads nothing when the answer does not start with a number', () => {
    expect(readSigFigs('about 5')).toBeNull()
    expect(readSigFigs('')).toBeNull()
  })

  it('judges against the required count, accepting ambiguous integers in range', () => {
    expect(judgeSigFigs('1.46', 3).status).toBe('correct')
    expect(judgeSigFigs('1.463', 3).status).toBe('too-many')
    expect(judgeSigFigs('1.5', 3).status).toBe('too-few')
    const ambiguous = judgeSigFigs('1500', 3)
    expect(ambiguous.status).toBe('correct')
    expect(ambiguous.ambiguous).toBe(true)
    expect(judgeSigFigs('1500', 5).status).toBe('too-few')
    expect(judgeSigFigs('1500', 1).status).toBe('too-many')
  })

  it('counts a model reference', () => {
    expect(sigFigsOf('0.0450')).toBe(3)
    expect(sigFigsOf('1500')).toBeUndefined()
  })

  it('formats a value to a number of significant figures without ambiguity', () => {
    expect(formatSigFigs(1.4636, 3)).toBe('1.46')
    expect(formatSigFigs(0.00123456, 2)).toBe('0.0012')
    expect(formatSigFigs(0.000123456, 2)).toBe('1.2×10^-4')
    expect(formatSigFigs(1500, 3)).toBe('1.50×10^3')
    expect(formatSigFigs(6.02214e23, 3)).toBe('6.02×10^23')
  })

  it('treats rounding as a right value, measured at the precision written', () => {
    // "1" for 1.4636: the value is right to one figure.
    expect(sigFigRelativeTolerance('1', 1.4636, 3)).toBeGreaterThan(0.3)
    // "1.464" is compared tightly.
    expect(sigFigRelativeTolerance('1.464', 1.4636, 3)).toBeLessThan(0.011)
  })
})

describe('numeric answers: value, unit and significant figures judged separately', () => {
  beforeEach(() => setUILanguage('zh-CN'))

  it('a right answer with the right figures is correct and shows the rule source', () => {
    const result = evaluateDeterministic(q({ sigFigs: 3 }), '1.46')
    expect(result.isCorrect).toBe(true)
    expect(result.dimensions).toMatchObject({ value: 'correct', sigFigs: { status: 'correct' } })
    expect(result.sigFigRule).toMatchObject({ mode: 'hint', source: 'platform', deducted: false })
  })

  it('too many figures: hint only by default — correct, but named and tagged', () => {
    const result = evaluateDeterministic(q({ sigFigs: 3, sigFigsBasis: 'stated' }), '1.4636')
    expect(result.isCorrect).toBe(true)
    expect(result.score).toBeUndefined()
    expect(result.note).toContain('数值正确')
    expect(result.note).toContain('本题要求 3 位有效数字（题目要求）')
    expect(result.note).toContain('你提交了 5 位')
    expect(hasSigFigIssue(result)).toBe(true)
    expect(isSigFigOnlyError(result)).toBe(true)
    expect(answerIssueTags(result)).toEqual(['sigfig'])
  })

  it('too few figures under a deduction rule earns the rest of the question', () => {
    const result = evaluateDeterministic(q({ sigFigs: 3 }), '1.5', {
      sigFigPolicy: { mode: 'deduct', percent: 25, source: 'professor' },
    })
    expect(result.isCorrect).toBe(false)
    expect(result.score).toEqual({ earned: 0.75, total: 1 })
    expect(result.note).toContain('你只提交了 2 位')
    expect(result.sigFigRule).toEqual({
      mode: 'deduct',
      percent: 25,
      source: 'professor',
      deducted: true,
    })
    expect(isSigFigOnlyError(result)).toBe(true)
  })

  it('a wrong value is wrong, and the significant figures are not discussed', () => {
    const result = evaluateDeterministic(q({ sigFigs: 3 }), '2.46')
    expect(result.isCorrect).toBe(false)
    expect(result.dimensions?.value).toBe('wrong')
    expect(result.note).toBe('数值不对。')
    expect(isSigFigOnlyError(result)).toBe(false)
    expect(answerIssueTags(result)).toContain('value')
  })

  it('a coarse but right rounding counts as the right value with too few figures', () => {
    const result = evaluateDeterministic(q({ sigFigs: 3, correctAnswer: '1.4636' }), '1')
    expect(result.dimensions).toMatchObject({ value: 'correct', sigFigs: { status: 'too-few' } })
  })

  it('accepts scientific notation and ambiguous integers', () => {
    expect(
      evaluateDeterministic(q({ sigFigs: 3, correctAnswer: '6.02e23' }), '6.02×10^23').isCorrect,
    ).toBe(true)
    const ambiguous = evaluateDeterministic(q({ sigFigs: 3, correctAnswer: '1500' }), '1500')
    expect(ambiguous.isCorrect).toBe(true)
    expect(ambiguous.dimensions?.sigFigs?.ambiguous).toBe(true)
    expect(ambiguous.note).toContain('1.50×10^3')
  })

  it('an expression answer has no figures to judge', () => {
    const result = evaluateDeterministic(q({ sigFigs: 2, correctAnswer: '0.75' }), '3/4')
    expect(result.dimensions?.value).toBe('correct')
    expect(result.dimensions?.sigFigs?.status).toBe('unreadable')
    expect(result.isCorrect).toBe(true)
    expect(result.note).toContain('请写成小数形式')
  })

  it('without a requirement the grading is unchanged (1% tolerance, no dimensions)', () => {
    const result = evaluateDeterministic(q({}), '1.4636')
    expect(result.isCorrect).toBe(true)
    expect(result.dimensions).toBeUndefined()
    expect(result.sigFigRule).toBeUndefined()
  })
})

describe('quantities: specific unit feedback', () => {
  beforeEach(() => setUILanguage('zh-CN'))
  const quantity = (answer: string, extra: Partial<Question> = {}) =>
    evaluateDeterministic(q({ correctAnswer: '9.81', unit: 'm/s^2', ...extra }), answer)

  it('value, unit and figures all right', () => {
    const result = quantity('9.81 m/s^2', { sigFigs: 3 })
    expect(result.isCorrect).toBe(true)
    expect(result.dimensions).toMatchObject({
      value: 'correct',
      unit: { status: 'correct' },
      sigFigs: { status: 'correct' },
    })
  })

  it('the exact message: value and unit right, four figures for three', () => {
    const result = quantity('9.810 m/s^2', { sigFigs: 3 })
    expect(result.note).toBe(
      '数值和单位正确；本题要求 3 位有效数字，你提交了 4 位。请按课程要求重新表示。',
    )
  })

  it('a missing unit with the right number says exactly that', () => {
    const result = quantity('9.81')
    expect(result.isCorrect).toBe(false)
    expect(result.dimensions).toMatchObject({ value: 'correct', unit: { status: 'missing' } })
    expect(result.note).toContain('数值正确，但缺少单位')
  })

  it('a unit of another kind of quantity', () => {
    const result = quantity('9.81 N')
    expect(result.dimensions?.unit?.status).toBe('wrong-dimension')
    expect(result.note).toContain('「N」')
    expect(answerIssueTags(result)).toEqual(['value', 'unit'])
  })

  it('the right number in a convertible but wrong unit', () => {
    const result = quantity('9.81 cm/s^2')
    expect(result.isCorrect).toBe(false)
    expect(result.dimensions).toMatchObject({ value: 'correct', unit: { status: 'wrong-unit' } })
    expect(result.note).toContain('0.0981')
    expect(answerIssueTags(result)).toEqual(['unit'])
  })

  it('an equivalent unit is converted and correct', () => {
    const result = quantity('981 cm/s^2', { sigFigs: 3 })
    expect(result.isCorrect).toBe(true)
    expect(result.dimensions?.unit).toMatchObject({ status: 'correct', converted: true })
  })

  it('right unit, wrong value', () => {
    const result = quantity('8.81 m/s^2')
    expect(result.dimensions).toMatchObject({ value: 'wrong', unit: { status: 'correct' } })
    expect(result.note).toBe('单位正确，但数值不对。')
  })

  it('figures are read from the number in front of the unit', () => {
    const result = quantity('9.8 m/s^2', { sigFigs: 3 })
    expect(result.dimensions?.sigFigs).toMatchObject({
      status: 'too-few',
      given: { min: 2, max: 2 },
    })
    expect(result.isCorrect).toBe(true)
  })
})

describe('course rule', () => {
  beforeEach(() => setUILanguage('zh-CN'))
  it('normalises unknown or out-of-range rules to the default', () => {
    expect(normalizeSigFigPolicy(undefined)).toEqual({ mode: 'hint', source: 'platform' })
    expect(normalizeSigFigPolicy({ mode: 'deduct', percent: 0, source: 'professor' })).toEqual({
      mode: 'hint',
      source: 'professor',
    })
    expect(normalizeSigFigPolicy({ mode: 'deduct', percent: '20' })).toEqual({
      mode: 'deduct',
      percent: 20,
      source: 'platform',
    })
  })

  it('always names the source of the rule', () => {
    expect(sigFigRuleText({ mode: 'hint', source: 'platform' })).toBe(
      '有效数字评分规则：仅提示，不扣分（平台拟定规则）',
    )
    expect(sigFigRuleText({ mode: 'deduct', percent: 25, source: 'professor' })).toBe(
      '有效数字评分规则：扣 25%（教授规则）',
    )
  })
})
