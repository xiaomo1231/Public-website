import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { QuizService, scoreQuiz } from '@/services/quizService'
import { MasteryService, observationFromAttempt } from '@/services/masteryService'
import { MistakeService } from '@/services/mistakeService'
import { computeMastery } from '@/services/adaptiveDifficulty'
import {
  ShortAnswerGrader,
  buildRubricEvaluation,
  isVerbatimEvidence,
} from '@/services/shortAnswerGrader'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import { MistakeRepository } from '@/entities/mistake/repository'
import { KnowledgeMasteryRepository } from '@/entities/knowledgeMastery/repository'
import { questionTypesForSubject, type Question } from '@/entities/question/types'
import type { QuestionAttempt, QuestionEvaluation } from '@/entities/questionAttempt/types'
import type { Quiz } from '@/entities/quiz/types'
import type { AIService } from '@/services/aiService'
import type { QuizGenerationOutput } from '@/infrastructure/ai/prompts/quiz-generator/v5'
import { prompts } from '@/infrastructure/ai/prompts'
import type { ShortAnswerCheckOutput } from '@/infrastructure/ai/prompts/short-answer-check/v1'
import { ShortAnswerFeedback } from '@/widgets/quiz/ShortAnswerFeedback'

const RUBRIC = [
  { id: 'p1', text: 'A derivative is the instantaneous rate of change.' },
  { id: 'p2', text: 'It is the limit of the difference quotient.' },
  { id: 'p3', text: 'Geometrically it is the slope of the tangent line.' },
  { id: 'p4', text: 'A function must be continuous where it is differentiable.' },
  { id: 'p5', text: 'Example: the derivative of x^2 is 2x.' },
]

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-short',
    projectId: 'p1',
    knowledgePoint: 'Derivatives',
    type: 'short_answer',
    difficulty: 'basic',
    prompt: 'Explain what a derivative is.',
    correctAnswer: 'The derivative is the instantaneous rate of change …',
    rubric: RUBRIC,
    hints: [],
    sourceRefs: [],
    promptVersion: 'v3',
    createdAt: 1,
    ...overrides,
  }
}

const ANSWER =
  'A derivative tells you how fast a function changes at one instant. ' +
  'It equals the slope of the tangent line, and for example d/dx of x^2 is 2x. ' +
  'Every continuous function is differentiable.'

/** The model claims three points; one quote is invented and must not count. */
const AI_OUTPUT: ShortAnswerCheckOutput = {
  status: 'ready',
  points: [
    { id: 'p1', covered: true, evidence: 'how fast a function changes at one instant' },
    { id: 'p2', covered: true, evidence: 'the limit of the difference quotient' }, // not in the answer
    { id: 'p3', covered: true, evidence: 'the slope of the tangent line' },
    { id: 'p4', covered: false },
    { id: 'p5', covered: true, evidence: 'd/dx of x^2 is 2x' },
  ],
  contradictions: ['Every continuous function is differentiable.', 'Made-up statement'],
  feedback: 'Add the limit definition.',
}

describe('scoring points', () => {
  it('scores covered points over the total, verifying every quote locally', () => {
    const evaluation = buildRubricEvaluation(question(), ANSWER, AI_OUTPUT)
    expect(evaluation.score).toEqual({ earned: 3, total: 5 })
    expect(evaluation.isCorrect).toBe(false)
    expect(evaluation.method).toBe('rubric_ai')
    const p2 = evaluation.rubric!.find((point) => point.pointId === 'p2')!
    // Claimed as covered, but the quote is not in the answer: no credit.
    expect(p2.covered).toBe(false)
    expect(p2.evidence).toBeUndefined()
    expect(evaluation.contradictions).toEqual(['Every continuous function is differentiable.'])
  })

  it('treats a missing point decision as not covered and full coverage as correct', () => {
    const all = buildRubricEvaluation(question({ rubric: RUBRIC.slice(0, 1) }), ANSWER, {
      points: [{ id: 'p1', covered: true, evidence: 'how fast a function changes' }],
    })
    expect(all).toMatchObject({ isCorrect: true, score: { earned: 1, total: 1 } })
    const none = buildRubricEvaluation(question(), ANSWER, { points: [] })
    expect(none.score).toEqual({ earned: 0, total: 5 })
  })

  it('matches quotes across spacing, case and full-width punctuation', () => {
    expect(isVerbatimEvidence('导数是 瞬时变化率。', '我认为导数是瞬时变化率，也就是……')).toBe(true)
    expect(isVerbatimEvidence('SLOPE of the Tangent', 'the slope of the tangent line')).toBe(true)
    expect(isVerbatimEvidence('导数是平均变化率', '导数是瞬时变化率')).toBe(false)
    expect(isVerbatimEvidence('。', 'anything')).toBe(false)
  })
})

describe('ShortAnswerGrader', () => {
  const ai = (chatJSON: ReturnType<typeof vi.fn>) => ({ chatJSON }) as unknown as AIService

  it('does not call the AI for an empty answer', async () => {
    const chatJSON = vi.fn()
    const result = await new ShortAnswerGrader(ai(chatJSON)).grade(question(), ' ok ')
    expect(chatJSON).not.toHaveBeenCalled()
    expect(result).toMatchObject({ isCorrect: false, score: { earned: 0, total: 5 } })
  })

  it('leaves the answer unscored when the check cannot be completed', async () => {
    const failing = await new ShortAnswerGrader(ai(vi.fn().mockRejectedValue(new Error('offline')))).grade(
      question(),
      ANSWER,
    )
    expect(failing).toMatchObject({ isCorrect: null, method: 'unverified' })
    const insufficient = await new ShortAnswerGrader(
      ai(vi.fn().mockResolvedValue({ data: { status: 'insufficient', reason: 'The question is cut off.' } })),
    ).grade(question(), ANSWER)
    expect(insufficient.isCorrect).toBeNull()
    expect(insufficient.note).toContain('The question is cut off.')
  })

  it('sends the scoring points and the subject profile', async () => {
    const chatJSON = vi.fn().mockResolvedValue({ data: AI_OUTPUT })
    await new ShortAnswerGrader(ai(chatJSON)).grade(question(), ANSWER, 'calculus')
    const [system, user] = chatJSON.mock.calls[0]![0] as Array<{ content: string }>
    expect(system!.content).toContain('COURSE SUBJECT: Calculus')
    expect(user!.content).toContain('p3: Geometrically it is the slope of the tangent line.')
  })

  it('is not scored offline', () => {
    expect(evaluateDeterministic(question(), ANSWER)).toMatchObject({ isCorrect: null, method: 'unverified' })
  })
})

describe('partial credit in scores and mastery', () => {
  const attempt = (questionId: string, evaluation: QuestionEvaluation, type = 'short_answer'): QuestionAttempt => ({
    id: `a-${questionId}`,
    projectId: 'p1',
    questionId,
    quizId: 'quiz',
    knowledgePoint: 'Derivatives',
    questionType: type,
    difficulty: 'basic',
    userAnswer: '…',
    evaluation,
    hintsUsed: 0,
    createdAt: 1,
  })
  const quiz = { id: 'quiz', questionIds: ['q1', 'q2', 'q3'] } as Quiz

  it('counts a short answer as earned / total of a question', () => {
    const score = scoreQuiz(quiz, [
      attempt('q1', { isCorrect: true, method: 'exact', confidence: 1 }, 'numeric'),
      attempt('q2', { isCorrect: false, method: 'rubric_ai', confidence: 0.8, score: { earned: 3, total: 5 } }),
      attempt('q3', { isCorrect: false, method: 'exact', confidence: 1 }, 'numeric'),
    ])
    expect(score.points).toBe(1.6)
    expect(score.percentage).toBe(53) // 1.6 / 3
  })

  it('leaves a disputed answer out of the score', () => {
    const score = scoreQuiz(quiz, [
      attempt('q1', { isCorrect: true, method: 'exact', confidence: 1 }, 'numeric'),
      attempt('q2', { isCorrect: false, method: 'rubric_ai', confidence: 0.8, score: { earned: 0, total: 5 }, disputed: true }),
    ])
    expect(score).toMatchObject({ correct: 1, wrong: 0, percentage: 100 })
  })

  it('feeds mastery partial credit at half weight', () => {
    const observation = observationFromAttempt(
      attempt('q2', { isCorrect: false, method: 'rubric_ai', confidence: 0.8, score: { earned: 3, total: 5 } }),
    )
    expect(observation).toMatchObject({ credit: 0.6, weight: 0.5 })
    expect(computeMastery([observation])).toBeCloseTo(0.6)
    // Half weight: one fully wrong ordinary answer outweighs the short answer.
    const wrong = observationFromAttempt(attempt('q3', { isCorrect: false, method: 'exact', confidence: 1 }, 'numeric'))
    expect(computeMastery([{ ...observation, at: 0 }, wrong])).toBeLessThan(0.3)
  })
})

describe('quiz generation', () => {
  const service = new QuizService({ ai: {} as AIService })
  const base = { solution: '', knowledgePoint: 'K', difficulty: 'basic' as const, hints: [] }

  it('keeps 2–6 distinct scoring points and drops a short answer without enough', () => {
    const output = {
      questions: [
        { ...base, prompt: 'Explain A.', type: 'short_answer', correctAnswer: 'A because B.', rubric: ['A', 'a', ' B ', 7] },
        { ...base, prompt: 'Explain C.', type: 'short_answer', correctAnswer: 'C.', rubric: ['only one'] },
      ],
    } as unknown as QuizGenerationOutput
    const valid = service.validateGenerated(output, 2)
    expect(valid).toHaveLength(1)
    expect(valid[0]!.rubric).toEqual(['A', 'B'])
  })

  it('is offered for every subject and described in the generator prompt', () => {
    expect(questionTypesForSubject('physics')).toContain('short_answer')
    expect(prompts.quizGenerator.buildSystemPrompt()).toContain('`short_answer`')
    expect(prompts.quizGenerator.VERSION).toBe('v5')
  })
})

describe('submit and dispute', () => {
  let db: AppDatabase

  beforeEach(async () => {
    db = new AppDatabase()
    await db.delete()
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('grades by scoring points, records the mistake, and undoes it on dispute', async () => {
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    const [stored] = await new QuestionRepository(db).addMany([
      { ...question(), projectId: project.id },
    ])
    await new QuizRepository(db).upsert({
      id: 'quiz-1',
      projectId: project.id,
      title: 'Short answer',
      config: { mode: 'mixed', count: 1, difficulty: 'basic', types: ['short_answer'] },
      questionIds: [stored!.id],
      status: 'ready',
      difficultyPlan: ['basic'],
      startedAt: 1,
      promptVersion: 'v3',
    })
    const ai = { chatJSON: vi.fn().mockResolvedValue({ data: AI_OUTPUT }) } as unknown as AIService
    const service = new QuizService({
      ai,
      db,
      questions: new QuestionRepository(db),
      attempts: new QuestionAttemptRepository(db),
      quizzes: new QuizRepository(db),
      mastery: new MasteryService(db),
      mistakes: new MistakeService(db),
    })

    const result = await service.submitAnswer('quiz-1', stored!.id, ANSWER, { gradeShortAnswer: true })
    expect(result.evaluation.score).toEqual({ earned: 3, total: 5 })
    expect(await new MistakeRepository(db).findByQuestion(project.id, stored!.id)).toBeDefined()
    const completed = await new QuizRepository(db).get('quiz-1')
    expect(completed!.score!.percentage).toBe(60)

    const disputed = await service.disputeAttempt(result.attempt.id)
    expect(disputed.evaluation.disputed).toBe(true)
    expect(await new MistakeRepository(db).findByQuestion(project.id, stored!.id)).toBeUndefined()
    const mastery = await new KnowledgeMasteryRepository(db).get(project.id, 'Derivatives')
    expect(mastery?.attempts ?? 0).toBe(0)
    const rescored = await new QuizRepository(db).get('quiz-1')
    expect(rescored!.score!.unverified).toBe(1)
  })
})

describe('ShortAnswerFeedback', () => {
  it('shows the score, the evidence and a dispute action', async () => {
    const onDispute = vi.fn()
    render(<ShortAnswerFeedback evaluation={buildRubricEvaluation(question(), ANSWER, AI_OUTPUT)} onDispute={onDispute} />)
    expect(screen.getByText('3/5 scoring points · 60%')).toBeInTheDocument()
    expect(screen.getByText('You wrote: “the slope of the tangent line”')).toBeInTheDocument()
    expect(screen.getByText('Every continuous function is differentiable.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'I disagree with this judgement' }))
    expect(onDispute).toHaveBeenCalled()
  })

  it('lists the points without ticks when the answer was not graded', () => {
    render(<ShortAnswerFeedback evaluation={evaluateDeterministic(question(), ANSWER)} />)
    expect(screen.queryByText(/scoring points ·/)).toBeNull()
    expect(screen.getByText(RUBRIC[0]!.text)).toBeInTheDocument()
    expect(screen.queryByLabelText('Not covered')).toBeNull()
  })
})
