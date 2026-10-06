import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QuizService } from '@/services/quizService'
import type { AIService } from '@/services/aiService'
import type { QuizGenerationOutput } from '@/infrastructure/ai/prompts/quiz-generator/v5'
import { blankAccepted, evaluateDeterministic } from '@/services/answerEvaluationService'
import { checkBlanksWithAi } from '@/services/fillBlankChecker'
import { displayAnswer, expectedAnswerText, type Question } from '@/entities/question/types'
import { FillBlankInput, MatchingInput, MultipleSelectInput } from '@/widgets/quiz/ExamFormatInputs'

function question(overrides: Partial<Question>): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'K',
    type: 'multiple_select',
    difficulty: 'basic',
    prompt: 'Prompt',
    correctAnswer: '',
    hints: [],
    sourceRefs: [],
    promptVersion: 'v5',
    createdAt: 1,
    ...overrides,
  }
}

const option = (id: string, label: string, isCorrect = false) => ({ id, label, isCorrect })

describe('X-type (multiple select) grading', () => {
  // 属于胆碱能纤维的是：A 交感节前 B 副交感节后 C 支配汗腺的交感节后 D 支配心脏的交感节后
  const q = question({
    options: [option('a', '交感神经节前纤维', true), option('b', '副交感神经节后纤维', true), option('c', '支配汗腺的交感节后纤维', true), option('d', '支配心脏的交感节后纤维')],
    correctAnswer: '交感神经节前纤维 | 副交感神经节后纤维 | 支配汗腺的交感节后纤维',
  })

  it('needs every correct option and nothing else for full marks', () => {
    expect(evaluateDeterministic(q, 'a,b,c')).toMatchObject({ isCorrect: true, method: 'multi_select', score: { earned: 3, total: 3 } })
    expect(evaluateDeterministic(q, 'c,a,b').isCorrect).toBe(true)
  })

  it('gives partial credit, with each wrong choice cancelling a right one', () => {
    expect(evaluateDeterministic(q, 'a,b')).toMatchObject({ isCorrect: false, score: { earned: 2, total: 3 }, normalizedUser: 'AB', normalizedExpected: 'ABC' })
    expect(evaluateDeterministic(q, 'a,b,d').score).toEqual({ earned: 1, total: 3 })
    expect(evaluateDeterministic(q, 'd').score).toEqual({ earned: 0, total: 3 })
    expect(evaluateDeterministic(q, '').score).toEqual({ earned: 0, total: 3 })
  })

  it('shows answers as option letters', () => {
    expect(displayAnswer(q, 'a,c')).toContain('A')
    expect(displayAnswer(q, 'a,c')).toContain('C')
    expect(expectedAnswerText(q)).toMatch(/^A\. 交感神经节前纤维/)
  })

  it('toggles options in a stable order', () => {
    const onChange = vi.fn()
    render(<MultipleSelectInput question={q} value="c" onChange={onChange} />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes[2]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(boxes[0]!)
    expect(onChange).toHaveBeenCalledWith('a,c')
  })
})

describe('B-type (matching) grading', () => {
  const q = question({
    type: 'matching',
    options: [option('a', '腋神经'), option('b', '肌皮神经'), option('c', '桡神经'), option('d', '正中神经')],
    matchItems: ['三角肌', '肱二头肌', '肱三头肌'],
    correctAnswer: '腋神经 | 肌皮神经 | 桡神经',
  })

  it('scores each stem on its own', () => {
    expect(evaluateDeterministic(q, 'a,b,c')).toMatchObject({ isCorrect: true, method: 'match_items', score: { earned: 3, total: 3 } })
    const partial = evaluateDeterministic(q, 'a,d,c')
    expect(partial).toMatchObject({ isCorrect: false, score: { earned: 2, total: 3 }, normalizedUser: '1A 2D 3C', normalizedExpected: '1A 2B 3C' })
    expect(evaluateDeterministic(q, 'a,,').score).toEqual({ earned: 1, total: 3 })
  })

  it('lets an option be used for several stems', () => {
    const shared = question({ ...q, correctAnswer: '腋神经 | 腋神经 | 桡神经' })
    expect(evaluateDeterministic(shared, 'a,a,c').isCorrect).toBe(true)
  })

  it('shows answers as item → letter', () => {
    expect(displayAnswer(q, 'a,d,c')).toContain('2→D')
    expect(expectedAnswerText(q)).toContain('1. 三角肌 → A')
  })

  it('picks one shared option per stem', () => {
    const onChange = vi.fn()
    render(<MatchingInput question={q} value="a,," onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('radio', { name: 'B. 肌皮神经' })[1]!)
    expect(onChange).toHaveBeenCalledWith('a,b,')
  })
})

describe('fill-in-the-blank grading', () => {
  const q = question({
    type: 'fill_blank',
    prompt: '神经肌接头处释放的递质是 ____，其受体是 ____ 受体。',
    blanks: [['乙酰胆碱', 'ACh'], ['N2', 'N₂型胆碱', 'N2型胆碱']],
    correctAnswer: '乙酰胆碱 | N2',
  })

  it('accepts listed answers, ignoring spacing, case, width and punctuation', () => {
    expect(evaluateDeterministic(q, '乙酰胆碱\nN2')).toMatchObject({ isCorrect: true, method: 'blank_match', score: { earned: 2, total: 2 } })
    expect(evaluateDeterministic(q, 'ach\nＮ２').isCorrect).toBe(true)
    expect(evaluateDeterministic(q, ' 乙酰胆碱。\n n2型胆碱 ').isCorrect).toBe(true)
  })

  it('accepts a term with its abbreviation in parentheses', () => {
    expect(blankAccepted('乙酰胆碱（ACh）', ['乙酰胆碱', 'ACh'])).toBe(true)
    expect(blankAccepted('乙酰胆碱(ACh)', ['ACh', '乙酰胆碱'])).toBe(true)
    // The bracketed part must be accepted too; anything else is left to the AI check.
    expect(blankAccepted('乙酰胆碱（随便写）', ['乙酰胆碱'])).toBe(false)
    expect(blankAccepted('去甲肾上腺素（NE）', ['乙酰胆碱', 'ACh'])).toBe(false)
    expect(blankAccepted('', ['乙酰胆碱'])).toBe(false)
  })

  it('reports each blank and gives partial credit', () => {
    const result = evaluateDeterministic(q, '乙酰胆碱\nM')
    expect(result).toMatchObject({ isCorrect: false, score: { earned: 1, total: 2 } })
    expect(result.blanks?.map((b) => b.correct)).toEqual([true, false])
  })

  it('asks the AI only about unmatched blanks and rescoring stays local', async () => {
    const chatJSON = vi.fn().mockResolvedValue({ data: { blanks: [{ index: 2, equivalent: true }, { index: 1, equivalent: true }] } })
    const ai = { chatJSON } as unknown as AIService
    const local = evaluateDeterministic(q, '乙酰胆碱\n烟碱型')
    const checked = await checkBlanksWithAi(ai, q, local)
    expect(chatJSON).toHaveBeenCalledTimes(1)
    const userPrompt = chatJSON.mock.calls[0]![0][1].content as string
    expect(userPrompt).toContain('烟碱型')
    expect(userPrompt).not.toContain('"answer": "乙酰胆碱"')
    expect(checked).toMatchObject({ isCorrect: true, score: { earned: 2, total: 2 } })
    expect(checked.blanks?.[1]).toMatchObject({ correct: true, byAi: true })
    expect(checked.blanks?.[0]?.byAi).toBeUndefined()
  })

  it('keeps the local result when the AI fails or there is nothing to ask', async () => {
    const failing = { chatJSON: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as AIService
    const local = evaluateDeterministic(q, '乙酰胆碱\n烟碱型')
    expect(await checkBlanksWithAi(failing, q, local)).toBe(local)
    const unused = { chatJSON: vi.fn() } as unknown as AIService
    const empty = evaluateDeterministic(q, '乙酰胆碱\n')
    expect(await checkBlanksWithAi(unused, q, empty)).toBe(empty)
    expect(unused.chatJSON).not.toHaveBeenCalled()
  })

  it('renders one input per blank and joins them by line', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    render(<FillBlankInput question={q} value={'乙酰胆碱\n'} onChange={onChange} onSubmit={onSubmit} />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(2)
    fireEvent.change(inputs[1]!, { target: { value: 'N2' } })
    expect(onChange).toHaveBeenCalledWith('乙酰胆碱\nN2')
    fireEvent.keyDown(inputs[1]!, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalled()
  })
})

describe('quiz validation for the exam formats', () => {
  const service = new QuizService({ ai: {} as AIService })
  const base = { solution: '', knowledgePoint: 'K', difficulty: 'basic' as const, hints: [] }
  const validate = (questions: unknown[]) => service.validateGenerated({ questions } as unknown as QuizGenerationOutput, questions.length)
  const options = (correct: boolean[]) => correct.map((isCorrect, i) => ({ label: `选项${i + 1}`, isCorrect }))

  it('keeps X-type questions with at least two correct options out of four or more', () => {
    const valid = validate([
      { ...base, prompt: 'X ok', type: 'multiple_select', correctAnswer: '', options: options([true, true, false, false, false]) },
      { ...base, prompt: 'X one correct', type: 'multiple_select', correctAnswer: '', options: options([true, false, false, false]) },
      { ...base, prompt: 'X three options', type: 'multiple_select', correctAnswer: '', options: options([true, true, false]) },
    ])
    expect(valid.map((q) => q.prompt)).toEqual(['X ok'])
    expect(valid[0]!.correctAnswer).toBe('选项1 | 选项2')
  })

  it('keeps B-type questions whose answers index the shared options', () => {
    const valid = validate([
      { ...base, prompt: 'B ok', type: 'matching', correctAnswer: '', options: options([false, false, false, false]), matchItems: ['甲', '乙'], matchAnswers: [2, 0] },
      { ...base, prompt: 'B bad index', type: 'matching', correctAnswer: '', options: options([false, false, false]), matchItems: ['甲', '乙'], matchAnswers: [3, 0] },
      { ...base, prompt: 'B count mismatch', type: 'matching', correctAnswer: '', options: options([false, false, false]), matchItems: ['甲', '乙'], matchAnswers: [1] },
    ])
    expect(valid.map((q) => q.prompt)).toEqual(['B ok'])
    expect(valid[0]).toMatchObject({ correctAnswer: '选项3 | 选项1', matchItems: ['甲', '乙'] })
    expect(valid[0]!.options!.every((o) => !o.isCorrect)).toBe(true)
  })

  it('keeps fill-blank questions with one answer list per blank', () => {
    const valid = validate([
      { ...base, prompt: '____ 是 ____ 的递质', type: 'fill_blank', correctAnswer: '', blanks: [['ACh', '乙酰胆碱'], ['神经肌接头']] },
      { ...base, prompt: '只有一个 ____', type: 'fill_blank', correctAnswer: '', blanks: [['a'], ['b']] },
      { ...base, prompt: '没有空', type: 'fill_blank', correctAnswer: '', blanks: [['a']] },
    ])
    expect(valid.map((q) => q.prompt)).toEqual(['____ 是 ____ 的递质'])
    expect(valid[0]!.correctAnswer).toBe('ACh | 神经肌接头')
  })
})
