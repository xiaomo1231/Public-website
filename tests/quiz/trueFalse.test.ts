import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '@/infrastructure/db/database'
import { QuizService } from '@/services/quizService'
import { evaluateDeterministic, parseTrueFalse } from '@/services/answerEvaluationService'
import type { AIService } from '@/services/aiService'
import type { Question } from '@/entities/question/types'
import type { QuizGenerationOutput } from '@/infrastructure/ai/prompts/quiz-generator/v6'

function tf(correctAnswer: string): Question {
  return {
    id: 'q1',
    projectId: 'p1',
    knowledgePoint: 'Logic',
    type: 'true_false',
    difficulty: 'basic',
    prompt: 'Is it?',
    correctAnswer,
    hints: [],
    sourceRefs: [],
    promptVersion: 'v1',
    createdAt: Date.now(),
  }
}

describe('true/false answers', () => {
  it('reads Chinese words, ticks and JSON booleans', () => {
    for (const v of ['true', 'True', '正确', '对', '是', '√', '✓', true]) expect(parseTrueFalse(v)).toBe(true)
    for (const v of ['false', '错误', '错', '否', '×', '✗', false]) expect(parseTrueFalse(v)).toBe(false)
    expect(parseTrueFalse('maybe')).toBeNull()
    expect(parseTrueFalse(1)).toBeNull()
  })

  it('grades a Chinese reference against an English answer', () => {
    expect(evaluateDeterministic(tf('正确'), 'true').isCorrect).toBe(true)
    expect(evaluateDeterministic(tf('×'), 'true').isCorrect).toBe(false)
  })

  it('normalizes generated true/false answers and drops unreadable ones', () => {
    const svc = new QuizService({ ai: { chatJSON: vi.fn() } as unknown as AIService, db: new AppDatabase() })
    const base = { solution: '', knowledgePoint: 'Logic', difficulty: 'basic', hints: [] }
    const data = {
      questions: [
        { ...base, prompt: 'A', type: 'true_false', correctAnswer: '错误' },
        { ...base, prompt: 'B', type: 'true_false', correctAnswer: true },
        { ...base, prompt: 'C', type: 'true_false', correctAnswer: 'depends' },
      ],
    } as unknown as QuizGenerationOutput
    const out = svc.validateGenerated(data, 3)
    expect(out.map((q) => [q.prompt, q.correctAnswer])).toEqual([
      ['A', 'false'],
      ['B', 'true'],
    ])
  })
})
