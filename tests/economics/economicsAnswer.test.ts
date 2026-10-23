import { describe, expect, it } from 'vitest'
import {
  compareEconNumber,
  econSpecFromText,
  readEconNumber,
} from '@/infrastructure/math/economicsAnswer'
import { econSpecFor, evaluateDeterministic } from '@/services/answerEvaluationService'
import type { Question } from '@/entities/question/types'
import type { Subject } from '@/entities/project/types'
import { checkPracticeAnswer, verifyAiPart } from '@/entities/homework/practice/verify'
import { gradeBlank } from '@/services/guidedGrading'

function numeric(correctAnswer: string, prompt = 'Compute it.', extra: Partial<Question> = {}) {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'surplus',
    type: 'numeric',
    difficulty: 'intermediate',
    prompt,
    correctAnswer,
    hints: [],
    sourceRefs: [],
    promptVersion: 'test',
    createdAt: 0,
    ...extra,
  } as Question
}

describe('readEconNumber', () => {
  it('reads money, separators, percentages and scale words', () => {
    expect(readEconNumber('$1,800')?.value).toBe(1800)
    expect(readEconNumber('1,800')?.value).toBe(1800)
    expect(readEconNumber('85 000')?.value).toBe(85000)
    expect(readEconNumber('85 000')?.value).toBe(85000)
    expect(readEconNumber('85 000')?.value).toBe(85000)
    expect(readEconNumber('$1.4')?.value).toBe(1.4)
    expect(readEconNumber('−$20')?.value).toBe(-20)
    expect(readEconNumber('$-20')?.value).toBe(-20)
    expect(readEconNumber('10%')).toMatchObject({ value: 10, percent: true })
    expect(readEconNumber('60k')).toMatchObject({ value: 60000, scaled: true })
    expect(readEconNumber('60 thousand')?.value).toBe(60000)
    expect(readEconNumber('$1.2 million')?.value).toBe(1_200_000)
    expect(readEconNumber('3万')?.value).toBe(30000)
    expect(readEconNumber('1,800 dollars')?.value).toBe(1800)
    expect(readEconNumber('10/8')?.value).toBe(1.25)
  })

  it('does not guess at ambiguous or broken numbers', () => {
    expect(readEconNumber('1,5')).toBeNull()
    expect(readEconNumber('1,80')).toBeNull()
    expect(readEconNumber('$')).toBeNull()
    expect(readEconNumber('shift right')).toBeNull()
    expect(readEconNumber('')).toBeNull()
  })
})

describe('compareEconNumber', () => {
  it('accepts money written in any usual way', () => {
    for (const given of ['$1,800', '1,800', '1800', '$1800', '1 800', '$1.8k'])
      expect(compareEconNumber(given, '1800').outcome, given).toBe('correct')
    expect(compareEconNumber('85 000', '85000').outcome).toBe('correct')
    expect(compareEconNumber('$1,900', '$1,800').outcome).toBe('wrong')
  })

  it('accepts a correct rounding to the decimals written, not a coarser guess', () => {
    expect(compareEconNumber('$1.4', '1.43').outcome).toBe('correct')
    expect(compareEconNumber('1.3', '1.25').outcome).toBe('correct')
    expect(compareEconNumber('1', '1.25').outcome).toBe('wrong')
    expect(compareEconNumber('1.20', '1.25').outcome).toBe('wrong')
  })

  it('treats a percent sign as percentage points', () => {
    expect(compareEconNumber('10%', '10').outcome).toBe('correct')
    expect(compareEconNumber('10%', '10%').outcome).toBe('correct')
    expect(compareEconNumber('10', '10%').outcome).toBe('correct')
    expect(compareEconNumber('0.1', '10%')).toEqual({
      outcome: 'correct',
      note: 'decimal-for-percent',
    })
    expect(compareEconNumber('10%', '0.1')).toEqual({
      outcome: 'correct',
      note: 'percent-for-decimal',
    })
    expect(compareEconNumber('12%', '10%').outcome).toBe('wrong')
    expect(compareEconNumber('0.1', '10', { percent: true }).note).toBe('decimal-for-percent')
  })

  it('reads amounts stated in thousands', () => {
    const thousands = { scale: 1000 }
    // DWL = ½ · 60 · 2 thousand = $60,000
    for (const given of ['60', '$60,000', '60 thousand', '60k', '$60k'])
      expect(compareEconNumber(given, '60', thousands).outcome, given).toBe('correct')
    expect(compareEconNumber('60000', '60', thousands)).toEqual({
      outcome: 'correct',
      note: 'full-amount',
    })
    expect(compareEconNumber('60', '$60,000', thousands).outcome).toBe('correct')
    expect(compareEconNumber('6', '60', thousands).outcome).toBe('wrong')
    expect(compareEconNumber('600', '60', thousands).outcome).toBe('wrong')
    // Without a stated scale a bare 60 is not $60,000.
    expect(compareEconNumber('60', '$60,000').outcome).toBe('wrong')
  })

  it('applies the absolute-value convention only when asked', () => {
    expect(compareEconNumber('-1.25', '1.25', { absolute: true })).toEqual({
      outcome: 'correct',
      note: 'absolute-value',
    })
    expect(compareEconNumber('−1.25', '1.25')).toEqual({ outcome: 'wrong', note: 'sign' })
    expect(compareEconNumber('1.25', '1.25', { absolute: true }).outcome).toBe('correct')
    expect(compareEconNumber('10/8', '1.25', { absolute: true }).outcome).toBe('correct')
    // A signed expected value keeps its sign.
    expect(compareEconNumber('0.5', '-0.5', { absolute: true })).toEqual({
      outcome: 'wrong',
      note: 'sign',
    })
  })

  it('reports unreadable answers instead of guessing', () => {
    expect(compareEconNumber('about a thousand', '1000').outcome).toBe('unreadable')
    expect(compareEconNumber('1,5', '1.5').outcome).toBe('unreadable')
  })
})

describe('econSpecFromText', () => {
  it('reads the course conventions from the question', () => {
    expect(econSpecFromText('Compute the price elasticity of demand (midpoint).')).toEqual({
      absolute: true,
    })
    expect(econSpecFromText('Compute the income elasticity of demand.')).toEqual({})
    expect(econSpecFromText('Compute the cross-price elasticity of demand.')).toEqual({})
    expect(econSpecFromText('Quantity is in thousands of units. Compute DWL.')).toEqual({
      scale: 1000,
    })
    expect(econSpecFromText('Q (thousands) … find the tax revenue.')).toEqual({ scale: 1000 })
    expect(econSpecFromText('需求价格弹性是多少？')).toEqual({ absolute: true })
    expect(econSpecFromText('Report the absolute value.', { absolute: false })).toEqual({
      absolute: false,
    })
  })
})

describe('economics in the quiz grader', () => {
  it('applies only to economics (or an explicit spec)', () => {
    const question = numeric('1800')
    expect(econSpecFor(question, 'economics')).toEqual({})
    expect(econSpecFor(question, 'physics')).toBeNull()
    expect(econSpecFor(question, undefined)).toBeNull()
    expect(econSpecFor({ ...question, econ: { absolute: true } }, undefined)).toEqual({
      absolute: true,
    })
    expect(econSpecFor({ ...question, unit: 'm/s' }, 'economics')).toBeNull()
  })

  it('grades money, percentages and thousands for economics', () => {
    const subject: Subject = 'economics'
    expect(evaluateDeterministic(numeric('1800'), '$1,800', { subject }).isCorrect).toBe(true)
    expect(evaluateDeterministic(numeric('85000'), '85 000', { subject }).isCorrect).toBe(true)
    expect(evaluateDeterministic(numeric('10'), '10%', { subject }).isCorrect).toBe(true)
    const dwl = numeric('60', 'Quantities are in thousands. What is the deadweight loss?')
    expect(evaluateDeterministic(dwl, '$60,000', { subject }).isCorrect).toBe(true)
    expect(evaluateDeterministic(dwl, '60 thousand', { subject }).isCorrect).toBe(true)
    const wrong = evaluateDeterministic(numeric('1800'), '$1,700', { subject })
    expect(wrong.isCorrect).toBe(false)
    expect(wrong.dimensions?.value).toBe('wrong')
  })

  it('accepts a negative elasticity with a note under the absolute-value convention', () => {
    const elasticity = numeric(
      '1.25',
      'Using the midpoint method, what is the price elasticity of demand?',
    )
    const result = evaluateDeterministic(elasticity, '-1.25', { subject: 'economics' })
    expect(result.isCorrect).toBe(true)
    expect(result.note).toMatch(/absolute value|绝对值/)
    const income = numeric('1.25', 'What is the income elasticity of demand?')
    const signed = evaluateDeterministic(income, '-1.25', { subject: 'economics' })
    expect(signed.isCorrect).toBe(false)
    expect(signed.note).toMatch(/sign|正负号/)
  })

  it('leaves other subjects exactly as before', () => {
    const cases: Array<[string, string]> = [
      ['1800', '$1,800'],
      ['1800', '1,800'],
      ['85000', '85 000'],
      ['10', '10%'],
      ['1.25', '-1.25'],
      ['60', '60000'],
      ['0.75', '3/4'],
      ['2', '2.01'],
    ]
    for (const subject of ['physics', 'stats', 'chemistry', 'other', undefined] as const) {
      for (const [expected, given] of cases) {
        const question = numeric(expected, 'What is the price elasticity of demand?')
        expect(evaluateDeterministic(question, given, { subject }), `${subject} ${given}`).toEqual(
          evaluateDeterministic(question, given),
        )
      }
    }
  })
})

describe('economics in practice and guided grading', () => {
  it('verifies a money answer against the computation and grades it as money', () => {
    const verified = verifyAiPart(
      {
        prompt: 'Find the consumer surplus.',
        answer: 'Consumer surplus is $1,800.',
        solution: '½ × 60 × 60',
        check: { type: 'numeric', expression: '0.5*60*60', unit: '' },
      },
      undefined,
      'en',
      { economics: true },
    )
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.part.answer).toBe('$1,800')
    const info = { parts: [verified.part] }
    expect(checkPracticeAnswer(info, '1,800')?.verdict).toBe('correct')
    expect(checkPracticeAnswer(info, '$1800')?.verdict).toBe('correct')
    expect(checkPracticeAnswer(info, '$1,700')?.verdict).toBe('incorrect')
  })

  it('accepts |ε| as the stated answer of a negative computed elasticity', () => {
    const verified = verifyAiPart(
      {
        prompt: 'What is the price elasticity of demand (midpoint method)?',
        answer: '1.25',
        solution: '…',
        check: { type: 'numeric', expression: '(-10/40)/(8/40)', unit: '' },
      },
      undefined,
      'en',
      { economics: true },
    )
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(checkPracticeAnswer({ parts: [verified.part] }, '-1.25')?.verdict).toBe('correct')
  })

  it('keeps the plain numeric check outside economics', () => {
    const raw = {
      prompt: 'Find it.',
      answer: '$1,800',
      solution: '',
      check: { type: 'numeric', expression: '1800', unit: '' },
    }
    // The plain reader takes the first number ("1") and rejects the question, as before.
    expect(verifyAiPart(raw, undefined, 'en').ok).toBe(false)
    expect(verifyAiPart(raw, undefined, 'en', { economics: true }).ok).toBe(true)
  })

  it('reads money in guided number blanks only for economics', () => {
    const blank = { id: 'b1', answer: '1800', kind: 'number' as const }
    expect(gradeBlank(blank, '$1,800', { economics: true }).verdict).toBe('correct')
    expect(gradeBlank(blank, '85 000', { economics: true }).verdict).toBe('wrong')
    expect(gradeBlank(blank, '1,800').verdict).toBe('correct')
    expect(gradeBlank(blank, '$1,800')).toEqual(gradeBlank(blank, '$1,800', {}))
  })
})
