import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuizService } from '@/services/quizService'
import type { AIService } from '@/services/aiService'
import type { QuizGenerationOutput } from '@/infrastructure/ai/prompts/quiz-generator/v5'
import { evaluateDeterministic, normalizeProgramOutput } from '@/services/answerEvaluationService'
import {
  expectedAnswerText,
  questionTypesForSubject,
  type Question,
} from '@/entities/question/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { AnswerInput } from '@/widgets/quiz/AnswerInput'
import { QuestionCard } from '@/widgets/quiz/QuestionCard'

function question(overrides: Partial<Question>): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'Kinematics',
    type: 'numeric',
    difficulty: 'basic',
    prompt: 'How fast?',
    correctAnswer: '9.8',
    hints: [],
    sourceRefs: [],
    promptVersion: 'v2',
    createdAt: 1,
    ...overrides,
  }
}

const PROGRAM = ['```python', 'for i in range(3):', '    print(i * 2)', '```'].join('\n')

describe('physics: numeric answers with units', () => {
  const g = question({ unit: 'm/s^2' })

  it('accepts any equivalent unit', () => {
    expect(evaluateDeterministic(g, '9.8 m/s^2')).toMatchObject({ isCorrect: true, method: 'unit_conversion' })
    expect(evaluateDeterministic(g, '980 cm/s²').isCorrect).toBe(true)
  })

  it('explains a missing or incompatible unit', () => {
    const missing = evaluateDeterministic(g, '9.8')
    expect(missing.isCorrect).toBe(false)
    expect(missing.note).toMatch(/unit is required/i)
    const wrong = evaluateDeterministic(g, '9.8 N')
    expect(wrong.isCorrect).toBe(false)
    expect(wrong.note).toMatch(/different quantity/)
  })

  it('shows how a wrong value converts, and the expected answer with its unit', () => {
    const result = evaluateDeterministic(g, '1200 cm/s^2')
    expect(result.isCorrect).toBe(false)
    expect(result.note).toContain('12 m/s^2')
    expect(result.expected).toBe('9.8 m/s^2')
    expect(expectedAnswerText(g)).toBe('9.8 m/s^2')
  })

  it('does not grade an unreadable unit as wrong', () => {
    expect(evaluateDeterministic(g, '9.8 furlongs-ish')).toMatchObject({ isCorrect: null, method: 'unverified' })
  })

  it('keeps unit-free numeric questions as before', () => {
    expect(evaluateDeterministic(question({}), '9.8').isCorrect).toBe(true)
  })
})

describe('computer science: code output questions', () => {
  const q = question({ type: 'code_output', prompt: `What does this print?\n\n${PROGRAM}`, correctAnswer: '0\n2\n4' })

  it('matches output exactly, ignoring line endings and trailing spaces', () => {
    expect(evaluateDeterministic(q, '0\r\n2  \n4\n')).toMatchObject({ isCorrect: true, method: 'exact_output' })
    expect(evaluateDeterministic(q, '0 2 4').isCorrect).toBe(false)
    expect(evaluateDeterministic(q, '0\n2\n4.0').isCorrect).toBe(false)
  })

  it('normalises program output', () => {
    expect(normalizeProgramOutput('\n a  \r\nb\t\n\n')).toBe(' a\nb')
  })

  it('is only offered in computer-science courses', () => {
    expect(questionTypesForSubject('cs')).toContain('code_output')
    expect(questionTypesForSubject('physics')).not.toContain('code_output')
    expect(questionTypesForSubject(undefined)).not.toContain('code_output')
  })
})

describe('quiz generator output validation', () => {
  const service = new QuizService({ ai: {} as AIService })
  const base = { solution: '', knowledgePoint: 'K', difficulty: 'basic' as const, hints: [] }

  it('keeps a valid unit and drops an invalid one', () => {
    const output = {
      questions: [
        { ...base, prompt: 'Acceleration?', type: 'numeric', correctAnswer: '9.8', unit: 'm/s^2' },
        { ...base, prompt: 'Apples?', type: 'numeric', correctAnswer: '3', unit: 'apples' },
        { ...base, prompt: 'Probability?', type: 'numeric', correctAnswer: '0.5', unit: null },
      ],
    } as unknown as QuizGenerationOutput
    const [withUnit, badUnit, noUnit] = service.validateGenerated(output, 3)
    expect(withUnit!.unit).toBe('m/s^2')
    expect(badUnit!.unit).toBeUndefined()
    expect(noUnit!.unit).toBeUndefined()
  })

  it('requires the program for a code-output question', () => {
    const output = {
      questions: [
        { ...base, prompt: 'What does print(1) print?', type: 'code_output', correctAnswer: '1' },
        { ...base, prompt: `What does this print?\n${PROGRAM}`, type: 'code_output', correctAnswer: '0\n2\n4  \n' },
      ],
    } as unknown as QuizGenerationOutput
    const valid = service.validateGenerated(output, 2)
    expect(valid).toHaveLength(1)
    expect(valid[0]!.correctAnswer).toBe('0\n2\n4')
  })

  it('describes both in the generator prompt', () => {
    const system = prompts.quizGenerator.buildSystemPrompt()
    expect(prompts.quizGenerator.VERSION).toBe('v5')
    expect(system).toContain('`unit`')
    expect(system).toContain('`code_output`')
  })
})

describe('quiz UI', () => {
  it('asks for a value with its unit, without revealing the unit', () => {
    render(<AnswerInput question={question({ unit: 'm/s^2' })} value="" onChange={() => {}} />)
    expect(screen.getByPlaceholderText(/Value and unit/)).toBeInTheDocument()
    expect(screen.queryByText(/m\/s\^2\b(?! )/)).toBeNull()
  })

  it('renders the program as a code block and takes multi-line output', () => {
    const q = question({ type: 'code_output', prompt: `What does this print?\n\n${PROGRAM}`, correctAnswer: '0\n2\n4' })
    const { container } = render(
      <QuestionCard
        question={q}
        index={0}
        total={1}
        difficulty="basic"
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        onNext={() => {}}
        isLast
      />,
    )
    expect(container.querySelector('pre code')?.textContent).toContain('for i in range(3):')
    expect(screen.getByText('python')).toBeInTheDocument()
    expect(screen.getByText('Code output')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Exactly what the program prints/).tagName).toBe('TEXTAREA')
  })
})
