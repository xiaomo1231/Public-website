import { describe, expect, it } from 'vitest'
import * as QuizV8 from '@/infrastructure/ai/prompts/quiz-generator/v8'
import * as QuizV9 from '@/infrastructure/ai/prompts/quiz-generator/v9'
import * as PracticeV2 from '@/infrastructure/ai/prompts/practice-generate/v2'
import * as PracticeV3 from '@/infrastructure/ai/prompts/practice-generate/v3'
import * as StyleV1 from '@/infrastructure/ai/prompts/question-style/v1'
import * as StyleV2 from '@/infrastructure/ai/prompts/question-style/v2'
import { prompts } from '@/infrastructure/ai/prompts'
import { QuizService } from '@/services/quizService'
import type { AIService } from '@/services/aiService'
import type { QuizGenerationOutput } from '@/infrastructure/ai/prompts/quiz-generator/v9'
import { verifyAiPart, checkPracticeAnswer } from '@/entities/homework/practice/verify'
import { subjectPromptVersion } from '@/infrastructure/ai/prompts/subject-profile/v1'

const input = {
  topicName: 'Stoichiometry',
  topicDescription: 'Moles and masses',
  knowledgePoints: ['molar mass'],
  plan: [
    { type: 'numeric' as const, difficulty: 'basic' as const },
    { type: 'multiple_choice' as const, difficulty: 'basic' as const },
  ],
  language: 'en' as const,
  sourceSnippets: ['[chunk:c1]\nThe molar mass of water is 18.02 g/mol.'],
}

describe('quiz-generator v9', () => {
  it('is v8 word for word without its options, new types or conventions', () => {
    expect(prompts.quizGenerator.VERSION).toBe('v9')
    expect(QuizV9.buildSystemPrompt()).toBe(QuizV8.buildSystemPrompt())
    for (const types of [['multiple_choice'], ['numeric', 'short_answer']] as const)
      expect(QuizV9.buildSystemPrompt({ types: [...types] })).toBe(
        QuizV8.buildSystemPrompt({ types: [...types] }),
      )
    expect(QuizV9.buildUserPrompt(input)).toBe(QuizV8.buildUserPrompt(input))
    expect(QuizV9.buildUserPrompt({ ...input, professorConventions: [] })).toBe(
      QuizV8.buildUserPrompt(input),
    )
  })

  it('describes significant figures only when asked and only for numeric answers', () => {
    const withSigFigs = QuizV9.buildSystemPrompt({ types: ['numeric'], sigFigs: true })
    expect(withSigFigs).toContain('S1. Significant figures')
    expect(withSigFigs).toContain('"sigFigs"')
    expect(QuizV9.buildSystemPrompt({ types: ['multiple_choice'], sigFigs: true })).toBe(
      QuizV8.buildSystemPrompt({ types: ['multiple_choice'] }),
    )
  })

  it('describes the new types with their fields', () => {
    const system = QuizV9.buildSystemPrompt({ types: ['vector', 'nomenclature', 'force_list'] })
    expect(system).toContain('V1. For `vector`')
    expect(system).toContain('V2. For `nomenclature`')
    expect(system).toContain('V3. For `force_list`')
    expect(system).toContain('"components"')
    expect(system).toContain('"forces"')
    expect(system).toContain('vector | nomenclature | force_list')
    // The numeric rule only carried the shared rules.
    expect(system).not.toContain('For `numeric`')
    expect(system).toContain('Every question must cite the snippet')
  })

  it('lets the professor\'s final "none" option be used and be correct', () => {
    const system = QuizV9.buildSystemPrompt({ types: ['multiple_choice'], noneOfTheAbove: true })
    expect(system).not.toContain('Do not use "all of the above", "none of the above"')
    expect(system).toContain('LAST option')
    const user = QuizV9.buildUserPrompt({
      ...input,
      professorConventions: ['none_of_above', 'marks_per_part'],
      noneOptionLabel: 'None of the options are correct',
    })
    expect(user).toContain('"None of the options are correct"')
    expect(user).toContain('Show the marks')
    // Stable conventions come before the source material (shared prefix).
    expect(user.indexOf('PROFESSOR CONVENTIONS')).toBeLessThan(
      user.indexOf('BEGIN SOURCE MATERIAL'),
    )
  })
})

describe('practice-generate v3 and question-style v2', () => {
  it('practice prompts are v2 word for word without the new options', () => {
    expect(PracticeV3.buildSystemPrompt()).toBe(PracticeV2.buildSystemPrompt())
    const practice = {
      language: 'en' as const,
      keyPoints: '- moles',
      slots: [{ id: 's1', mode: 'compact' as const, partLabels: [], knowledgePoints: ['moles'] }],
    }
    expect(PracticeV3.buildUserPrompt(practice)).toBe(PracticeV2.buildUserPrompt(practice))
    expect(PracticeV3.buildSystemPrompt({ sigFigs: true })).toContain('"sigFigs"')
    expect(
      PracticeV3.buildUserPrompt({ ...practice, professorConventions: ['data_sheet'] }),
    ).toContain('data / formula sheet')
  })

  it('question-style v2 adds the five categories', () => {
    expect(prompts.questionStyle.VERSION).toBe('v2')
    const system = StyleV2.buildSystemPrompt()
    expect(system.startsWith(StyleV1.buildSystemPrompt().split('  difficulty')[0]!)).toBe(true)
    for (const category of ['options —', 'marks —', 'data_sheet —', 'sig_figs —', 'context —'])
      expect(system).toContain(category)
  })

  it('bumped only the chemistry and physics profile revisions', () => {
    expect(subjectPromptVersion('x', 'chemistry')).toBe('x+subject-profile/v1:chemistry.r4')
    expect(subjectPromptVersion('x', 'physics')).toBe('x+subject-profile/v1:physics.r3')
    expect(subjectPromptVersion('x', 'biology')).toBe('x+subject-profile/v1:biology.r2')
  })
})

describe('validating generated questions', () => {
  const service = () => new QuizService({ ai: {} as AIService })
  const base = {
    solution: '',
    knowledgePoint: 'kp',
    difficulty: 'basic',
    hints: [],
  }
  const validate = (questions: unknown[]) =>
    service().validateGenerated({ questions } as unknown as QuizGenerationOutput, 10)

  it('keeps the required significant figures and rewrites the reference to them', () => {
    const [q] = validate([
      { ...base, prompt: 'Mass?', type: 'numeric', correctAnswer: '1500', unit: 'g', sigFigs: 3 },
    ])
    expect(q).toMatchObject({ sigFigs: 3, sigFigsBasis: 'data', unit: 'g' })
    expect(q!.correctAnswer).toBe('1.50e3')
    const [plain] = validate([
      { ...base, prompt: 'Count?', type: 'numeric', correctAnswer: '12', sigFigs: null },
    ])
    expect(plain!.sigFigs).toBeUndefined()
  })

  it('validates vectors, nomenclature and free-body diagrams', () => {
    const out = validate([
      {
        ...base,
        prompt: 'Acceleration?',
        type: 'vector',
        components: [-0.903, 2.84],
        unit: 'm/s^2',
        correctAnswer: '',
      },
      {
        ...base,
        prompt: 'Write the formula of iron(III) sulfate.',
        type: 'nomenclature',
        direction: 'name_to_formula',
        formula: 'Fe2(SO4)3',
        names: ['iron(III) sulfate'],
        correctAnswer: '',
      },
      {
        ...base,
        prompt: 'Name $\\ce{Fe2(SO4)3}$, i.e. iron(III) sulfate.',
        type: 'nomenclature',
        direction: 'formula_to_name',
        formula: 'Fe2(SO4)3',
        names: ['iron(III) sulfate'],
        correctAnswer: '',
      },
      {
        ...base,
        prompt: 'Forces on the block?',
        type: 'force_list',
        forces: [
          { type: 'gravity', angle: 270, magnitude: 49 },
          { type: 'normal', angle: 90, magnitude: null },
        ],
        correctAnswer: '',
      },
      { ...base, prompt: 'Bad vector', type: 'vector', components: ['a'], correctAnswer: '' },
      {
        ...base,
        prompt: 'Bad forces',
        type: 'force_list',
        forces: [{ type: 'weight', angle: 270 }],
        correctAnswer: '',
      },
    ])
    expect(out.map((q) => q.type)).toEqual(['vector', 'nomenclature', 'force_list'])
    expect(out[0]!.vector).toEqual({ components: [-0.903, 2.84], unit: 'm/s^2' })
    expect(out[1]!.correctAnswer).toBe('Fe2(SO4)3')
    expect(out[2]!.forces).toHaveLength(2)
  })

  it('a "none of the options" answer is not dropped as a stand-out answer', () => {
    const [q] = validate([
      {
        ...base,
        prompt: 'Which value?',
        type: 'multiple_choice',
        correctAnswer: 'None of the options are correct',
        options: [
          { label: '1.0 g', isCorrect: false },
          { label: '2.0 g', isCorrect: false },
          { label: '3.0 g', isCorrect: false },
          { label: 'None of the options are correct', isCorrect: true },
        ],
      },
    ])
    expect(q).toBeDefined()
  })
})

describe('practice parts with significant figures', () => {
  it('the numeric check carries sigFigs and grading judges the value only', () => {
    const verified = verifyAiPart(
      {
        prompt: 'Mass of 0.250 mol water?',
        answer: '4.50 g',
        solution: '',
        check: { type: 'numeric', expression: '0.250*18.02', unit: 'g', sigFigs: 3 },
      },
      undefined,
      'en',
    )
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.part.grader).toMatchObject({ kind: 'quantity', sigFigs: 3 })
    const info = { parts: [verified.part] }
    const exact = checkPracticeAnswer(info, '4.505 g')
    expect(exact?.verdict).toBe('correct')
    expect(exact?.dimensions[0]).toMatchObject({
      value: 'correct',
      unit: { status: 'correct' },
      sigFigs: { status: 'too-many' },
    })
    expect(checkPracticeAnswer(info, '4.51 kg')?.verdict).toBe('incorrect')
  })
})
