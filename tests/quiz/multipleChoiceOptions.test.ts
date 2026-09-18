import { describe, expect, it } from 'vitest'
import { QuizService } from '@/services/quizService'
import type { AIService } from '@/services/aiService'
import type { QuizGenerationOutput } from '@/infrastructure/ai/prompts/quiz-generator/v1'

/**
 * A multiple-choice question with blank options used to be accepted and
 * persisted, so the UI rendered "A. B. C. D." with no content. Validation now
 * rejects any option set that is not usable.
 *
 * `validateGenerated` throws when nothing survives, so every rejection case is
 * paired with a known-good question and we assert only that one is kept.
 */

function service(): QuizService {
  return new QuizService({ ai: {} as AIService })
}

const GOOD = {
  prompt: 'GOOD QUESTION',
  type: 'multiple_choice' as const,
  options: [
    { label: '3', isCorrect: false },
    { label: '4', isCorrect: true },
    { label: '5', isCorrect: false },
    { label: '6', isCorrect: false },
  ],
  correctAnswer: '4',
  solution: '',
  knowledgePoint: 'Arithmetic',
  difficulty: 'basic' as const,
  hints: [],
}

function choice(overrides: Record<string, unknown>) {
  return {
    prompt: 'What is 2 + 2?',
    type: 'multiple_choice',
    correctAnswer: '4',
    solution: '',
    knowledgePoint: 'Arithmetic',
    difficulty: 'basic',
    hints: [],
    ...overrides,
  }
}

/** Returns the surviving questions when `bad` is offered alongside GOOD. */
function survivors(bad: unknown) {
  return service().validateGenerated(
    { questions: [bad, GOOD] } as unknown as QuizGenerationOutput,
    10,
  )
}

function isRejected(bad: unknown): boolean {
  const out = survivors(bad)
  return out.length === 1 && out[0]!.prompt === 'GOOD QUESTION'
}

describe('multiple-choice option validation', () => {
  it('keeps a well-formed option set, in order', () => {
    const out = service().validateGenerated({ questions: [GOOD] } as unknown as QuizGenerationOutput, 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.options?.map((o) => o.label)).toEqual(['3', '4', '5', '6'])
    expect(out[0]!.correctAnswer).toBe('4')
    expect(out[0]!.options?.filter((o) => o.isCorrect)).toHaveLength(1)
  })

  it('trims option labels', () => {
    const out = service().validateGenerated(
      {
        questions: [
          choice({
            options: [
              { label: '  3  ', isCorrect: false },
              { label: ' 4 ', isCorrect: true },
              { label: '5', isCorrect: false },
              { label: '6', isCorrect: false },
            ],
          }),
        ],
      } as unknown as QuizGenerationOutput,
      1,
    )
    expect(out[0]!.options?.map((o) => o.label)).toEqual(['3', '4', '5', '6'])
  })

  it('trusts correctAnswer when it names an option', () => {
    // Grading and the "revealed" UI both key off `correctAnswer`, so a stray
    // `isCorrect` flag on another option does not change the answer.
    const out = service().validateGenerated(
      {
        questions: [
          choice({
            correctAnswer: '4',
            options: [
              { label: '3', isCorrect: false },
              { label: '4', isCorrect: false },
              { label: '5', isCorrect: true },
              { label: '6', isCorrect: false },
            ],
          }),
        ],
      } as unknown as QuizGenerationOutput,
      1,
    )
    expect(out[0]!.correctAnswer).toBe('4')
  })

  it('adopts the flagged option when correctAnswer names no option', () => {
    const out = service().validateGenerated(
      {
        questions: [
          choice({
            correctAnswer: 'option B',
            options: [
              { label: '3', isCorrect: false },
              { label: '4', isCorrect: true },
              { label: '5', isCorrect: false },
              { label: '6', isCorrect: false },
            ],
          }),
        ],
      } as unknown as QuizGenerationOutput,
      1,
    )
    expect(out[0]!.correctAnswer).toBe('4')
  })

  it('rejects empty option labels (the reported bug)', () => {
    expect(
      isRejected(
        choice({
          options: [
            { label: '', isCorrect: false },
            { label: '', isCorrect: true },
            { label: '', isCorrect: false },
            { label: '', isCorrect: false },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('rejects whitespace-only option labels', () => {
    expect(
      isRejected(
        choice({
          options: [
            { label: '   ', isCorrect: false },
            { label: '  ', isCorrect: true },
            { label: ' ', isCorrect: false },
            { label: '\t', isCorrect: false },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('rejects an option with no label field at all', () => {
    expect(
      isRejected(
        choice({
          options: [
            { label: '3', isCorrect: false },
            { isCorrect: true },
            { label: '5', isCorrect: false },
            { label: '6', isCorrect: false },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('rejects fewer than two options', () => {
    expect(isRejected(choice({ options: [{ label: '4', isCorrect: true }] }))).toBe(true)
  })

  it('rejects a missing options array', () => {
    expect(isRejected(choice({}))).toBe(true)
  })

  it('rejects options supplied as bare strings', () => {
    expect(isRejected(choice({ options: ['3', '4', '5', '6'] }))).toBe(true)
  })

  it('rejects options that use a different field name', () => {
    expect(
      isRejected(
        choice({
          options: [
            { text: '3', isCorrect: false },
            { text: '4', isCorrect: true },
            { text: '5', isCorrect: false },
            { text: '6', isCorrect: false },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('rejects an option set with no correct answer', () => {
    expect(
      isRejected(
        choice({
          options: [
            { label: '3', isCorrect: false },
            { label: '4', isCorrect: false },
            { label: '5', isCorrect: false },
            { label: '6', isCorrect: false },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('rejects an option set with more than one correct answer', () => {
    expect(
      isRejected(
        choice({
          options: [
            { label: '3', isCorrect: false },
            { label: '4', isCorrect: true },
            { label: '5', isCorrect: true },
            { label: '6', isCorrect: false },
          ],
        }),
      ),
    ).toBe(true)
  })
})

describe('other question types are unaffected', () => {
  it('keeps true/false questions', () => {
    const out = service().validateGenerated(
      {
        questions: [
          { prompt: 'Derivative of x^2 is 2x?', type: 'true_false', correctAnswer: 'true', solution: '', knowledgePoint: 'Power Rule', difficulty: 'basic', hints: [] },
        ],
      } as unknown as QuizGenerationOutput,
      1,
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.type).toBe('true_false')
    expect(out[0]!.correctAnswer).toBe('true')
    expect(out[0]!.options).toBeUndefined()
  })

  it('keeps numeric questions', () => {
    const out = service().validateGenerated(
      {
        questions: [
          { prompt: 'd/dx x^2 at x=3', type: 'numeric', correctAnswer: '6', solution: '', knowledgePoint: 'Power Rule', difficulty: 'basic', hints: [] },
        ],
      } as unknown as QuizGenerationOutput,
      1,
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.type).toBe('numeric')
    expect(out[0]!.correctAnswer).toBe('6')
  })

  it('keeps math-expression questions', () => {
    const out = service().validateGenerated(
      {
        questions: [
          { prompt: 'Derivative of x^3', type: 'math_expr', correctAnswer: '3x^2', solution: '', knowledgePoint: 'Power Rule', difficulty: 'basic', hints: [] },
        ],
      } as unknown as QuizGenerationOutput,
      1,
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.type).toBe('math_expr')
    expect(out[0]!.correctAnswer).toBe('3x^2')
  })

  it('rejects the removed short-answer type', () => {
    expect(
      isRejected({ prompt: 'Explain?', type: 'short_answer', correctAnswer: 'rate of change', solution: '', knowledgePoint: 'KP', difficulty: 'basic', hints: [] }),
    ).toBe(true)
  })
})
