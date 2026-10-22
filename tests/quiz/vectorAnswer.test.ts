import { beforeEach, describe, expect, it } from 'vitest'
import {
  compareVector,
  compassText,
  formatVectorSpec,
  parseVectorAnswer,
  readDirection,
} from '@/infrastructure/math/vectorAnswer'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import { questionTypesForSubject, type Question } from '@/entities/question/types'
import { setUILanguage } from '@/i18n'

const reference = { components: [-0.903, 2.84], unit: 'm/s^2' }

function close(actual: number[] | undefined, expected: number[]): void {
  expect(actual).toBeDefined()
  actual!.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 2))
}

describe('reading a vector', () => {
  it.each([
    ['(-0.903, 2.84) m/s^2', [-0.903, 2.84]],
    ['(−0.903, 2.84) m/s²', [-0.903, 2.84]],
    ['<1, -2, 3>', [1, -2, 3]],
    ['⟨1, 2⟩', [1, 2]],
    ['-0.903 î + 2.84 ĵ', [-0.903, 2.84]],
    ['(3i - 4j) N', [3, -4]],
    ['2i + 3j - k', [2, 3, -1]],
  ])('components: %s', (text, expected) => {
    const parsed = parseVectorAnswer(text)
    expect(parsed?.form).toBe('components')
    close(parsed?.components, expected)
  })

  it.each([
    ['17.7° W of N', 107.7],
    ['N 17.7° W', 107.7],
    ['北偏西 17.7°', 107.7],
    ['30° S of E', -30],
    ['E 30° S', -30],
    ['30° above +x', 30],
    ['30° below the -x axis', 210],
    ['30° above the negative x-axis', 150],
    ['30° counterclockwise from +x', 30],
    ['30° clockwise from +y', 60],
    ['∠30°', 30],
    ['due south', 270],
    ['at 30^\\circ', 30],
  ])('direction: %s → %f°', (text, angle) => {
    const direction = readDirection(text.replace('^\\circ', '°'))
    expect(direction).not.toBeNull()
    const normalise = (a: number) => ((a % 360) + 360) % 360
    expect(normalise(direction!.angle)).toBeCloseTo(normalise(angle), 6)
  })

  it('magnitude + direction becomes components', () => {
    const parsed = parseVectorAnswer('2.98 m/s^2 at 17.7° W of N')
    expect(parsed?.form).toBe('polar')
    expect(parsed?.unitText).toBe('m/s^2')
    close(parsed?.components, [-0.906, 2.839])
  })

  it('reads nothing that is not a vector', () => {
    expect(parseVectorAnswer('fast')).toBeNull()
    expect(parseVectorAnswer('')).toBeNull()
  })
})

describe('comparing vectors', () => {
  it('components and magnitude + direction are interchangeable', () => {
    expect(compareVector('(-0.903, 2.84) m/s^2', reference).outcome).toBe('correct')
    expect(compareVector('2.98 m/s^2 at 17.6° W of N', reference).outcome).toBe('correct')
    expect(compareVector('2.98 m/s^2, N 17.6° W', reference).outcome).toBe('correct')
    expect(compareVector('2.98 m/s^2 ∠107.6°', reference).outcome).toBe('correct')
  })

  it('converts the unit', () => {
    const result = compareVector('(-90.3, 284) cm/s^2', reference)
    expect(result.outcome).toBe('correct')
    expect(result.convertedFrom).toBe('cm/s^2')
  })

  it('names the specific mistake', () => {
    expect(compareVector('(0.903, 2.84) m/s^2', reference)).toMatchObject({
      outcome: 'wrong-sign',
      signs: [0],
    })
    expect(compareVector('(2.84, -0.903) m/s^2', reference).outcome).toBe('swapped')
    expect(compareVector('2.98 m/s^2 at 17.6° E of N', reference).outcome).toBe('wrong-sign')
    expect(compareVector('2.98 m/s^2 at 40° W of N', reference).outcome).toBe('direction-wrong')
    expect(compareVector('5.00 m/s^2 at 17.6° W of N', reference).outcome).toBe('magnitude-wrong')
    expect(compareVector('(5, 5) m/s^2', reference).outcome).toBe('wrong')
    expect(compareVector('(-0.903, 2.84)', reference).outcome).toBe('missing-unit')
    expect(compareVector('(-0.903, 2.84) N', reference).outcome).toBe('wrong-dimension')
    expect(compareVector('(1, 2, 3) m/s^2', reference).outcome).toBe('component-count')
  })

  it('tolerates 1% in magnitude and 1° in direction, not more', () => {
    expect(compareVector('2.96 m/s^2 at 18.5° W of N', reference).outcome).toBe('correct')
    expect(compareVector('2.98 m/s^2 at 19.5° W of N', reference).outcome).toBe('direction-wrong')
  })

  it('3-D vectors are compared by the difference vector', () => {
    const spec = { components: [1, -2, 3] }
    expect(compareVector('<1.005, -2, 3>', spec).outcome).toBe('correct')
    expect(compareVector('<-1, -2, 3>', spec).outcome).toBe('wrong-sign')
  })

  it('shows the reference both ways', () => {
    expect(compassText(107.6)).toBe('17.6° W of N')
    expect(compassText(-30)).toBe('60° E of S')
    expect(formatVectorSpec(reference)).toContain('(-0.903, 2.84) m/s^2')
    expect(formatVectorSpec(reference)).toContain('W of N')
  })
})

describe('vector questions', () => {
  beforeEach(() => setUILanguage('zh-CN'))
  const question: Question = {
    id: 'v1',
    projectId: 'p',
    knowledgePoint: 'kinematics',
    type: 'vector',
    difficulty: 'basic',
    prompt: 'Find the acceleration.',
    correctAnswer: '(-0.903, 2.84) m/s^2',
    vector: reference,
    hints: [],
    sourceRefs: [],
    promptVersion: 'v9',
    createdAt: 0,
  }

  it('grades locally with a specific message', () => {
    expect(evaluateDeterministic(question, '2.98 m/s^2 at 17.6° W of N').isCorrect).toBe(true)
    const wrong = evaluateDeterministic(question, '(0.903, 2.84) m/s^2')
    expect(wrong.isCorrect).toBe(false)
    expect(wrong.note).toContain('x 分量的正负号不对')
    const unreadable = evaluateDeterministic(question, 'fast')
    expect(unreadable.isCorrect).toBeNull()
  })

  it('is offered to physics and maths courses only', () => {
    expect(questionTypesForSubject('physics')).toContain('vector')
    expect(questionTypesForSubject('linear_algebra')).toContain('vector')
    expect(questionTypesForSubject('chemistry')).not.toContain('vector')
    expect(questionTypesForSubject('physics')).toContain('force_list')
    expect(questionTypesForSubject('chemistry')).toContain('nomenclature')
    expect(questionTypesForSubject('biology')).not.toContain('nomenclature')
  })
})
