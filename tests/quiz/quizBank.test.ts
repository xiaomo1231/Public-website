import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { QuizService } from '@/services/quizService'
import {
  BANK_MAX_QUESTIONS,
  planBank,
  selectNextBankQuestion,
  usesQuestionBank,
  type BankCandidate,
} from '@/services/quizBank'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import { quizGenerationProgress, quizLength, type QuizConfig } from '@/entities/quiz/types'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

async function seed() {
  const p = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
  const docs = new DocumentRepository(db)
  const doc = await docs.create({ projectId: p.id, type: 'pdf', name: 'book.pdf', sizeBytes: 1 })
  await docs.update(doc.id, { status: 'ready' })
  await new ChunkRepository(db).addMany(
    Array.from({ length: 12 }, (_, i) => ({
      documentId: doc.id,
      projectId: p.id,
      contentType: 'paragraph' as const,
      text: `Page ${i + 1}: limits and derivatives, part ${i + 1}.`,
      sourceReference: 'book.pdf',
      order: i,
      pageNumber: i + 1,
    })),
  )
  await new CourseAnalysisRepository(db).reseedProject(
    p.id,
    {
      topics: [{ name: 'Limits', description: 'd', sourceRefs: [] }],
      concepts: [],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map([['Limits', 't1']]),
      documentIds: [doc.id],
    },
    'en',
  )
  return p.id
}

/** Answers each plan line with a numeric question (answer 3), knowledge point by line. */
function planAI() {
  let call = 0
  const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
    call++
    const plan = [...messages[1]!.content.matchAll(/^\s*\d+\. type=(\w+) difficulty=(\w+)/gm)].map(
      (m) => ({ type: m[1]!, difficulty: m[2]! }),
    )
    return {
      data: {
        questions: plan.map(({ type, difficulty }, i) => ({
          prompt: `Q${call}.${i} ${difficulty}`,
          type,
          correctAnswer: '3',
          solution: '',
          knowledgePoint: `K${(call * 7 + i) % 3}`,
          difficulty,
          hints: [],
        })),
      },
    }
  })
  return { ai: { chatJSON, currentProvider: {}, maxOutputTokens: 2048 } as unknown as AIService }
}

const adaptive = (count: number): QuizConfig => ({
  mode: 'topic',
  count,
  difficulty: 'adaptive',
  types: ['numeric'],
})

describe('planBank', () => {
  it('starts with the base level and offers one level either side later', () => {
    const plan = planBank(5, 'basic')
    expect(plan).toHaveLength(2 + 3 * 3)
    expect(plan.filter((e) => e.slot < 2).map((e) => e.difficulty)).toEqual(['basic', 'basic'])
    expect(new Set(plan.map((e) => e.difficulty))).toEqual(
      new Set(['beginner', 'basic', 'intermediate']),
    )
    for (let slot = 0; slot < 5; slot++) {
      expect(plan.some((e) => e.slot === slot && e.difficulty === 'basic')).toBe(true)
    }
  })

  it('caps the bank at 2.5 × the quiz length and at most 60', () => {
    expect(planBank(10, 'basic')).toHaveLength(25)
    const large = planBank(30, 'basic')
    expect(large).toHaveLength(BANK_MAX_QUESTIONS)
    // Both directions stay available, and every slot keeps its start question.
    expect(large.some((e) => e.difficulty === 'beginner')).toBe(true)
    expect(large.some((e) => e.difficulty === 'intermediate')).toBe(true)
    expect(new Set(large.filter((e) => e.difficulty === 'basic').map((e) => e.slot)).size).toBe(30)
  })

  it('applies to adaptive topic / mixed / weakness quizzes only', () => {
    expect(usesQuestionBank(adaptive(5))).toBe(true)
    expect(usesQuestionBank({ ...adaptive(5), difficulty: 'basic' })).toBe(false)
    expect(usesQuestionBank({ ...adaptive(5), mode: 'review' })).toBe(false)
    expect(usesQuestionBank({ ...adaptive(5), mode: 'weakness', sourceMistakeId: 'm' })).toBe(false)
  })
})

describe('selectNextBankQuestion', () => {
  const c = (
    questionId: string,
    slot: number,
    difficulty: BankCandidate['difficulty'],
    knowledgePoint = 'A',
  ): BankCandidate => ({ questionId, slot, difficulty, knowledgePoint, type: 'numeric' })

  it('takes the exact level of the slot, else the nearest', () => {
    const candidates = [c('e', 2, 'beginner'), c('b', 2, 'basic'), c('i', 2, 'intermediate')]
    const pick = (target: BankCandidate['difficulty'], served: string[] = []) =>
      selectNextBankQuestion({ candidates, served: new Set(served), slot: 2, target })?.questionId
    expect(pick('intermediate')).toBe('i')
    expect(pick('advanced')).toBe('i')
    expect(pick('intermediate', ['i'])).toBe('b')
  })

  it('falls back to the nearest level of any slot when the slot is empty', () => {
    const candidates = [c('x', 1, 'basic'), c('y', 4, 'beginner'), c('z', 3, 'intermediate')]
    const pick = selectNextBankQuestion({
      candidates,
      served: new Set(),
      slot: 2,
      target: 'beginner',
    })
    expect(pick?.questionId).toBe('y')
    expect(
      selectNextBankQuestion({
        candidates,
        served: new Set(['x', 'y', 'z']),
        slot: 2,
        target: 'basic',
      }),
    ).toBeNull()
  })

  it('avoids repeating the previous knowledge point when possible', () => {
    const candidates = [c('same', 2, 'basic', 'A'), c('later', 3, 'basic', 'B')]
    expect(
      selectNextBankQuestion({
        candidates,
        served: new Set(),
        slot: 2,
        target: 'basic',
        previousKnowledgePoint: 'A',
      })?.questionId,
    ).toBe('later')
    // Only a further level elsewhere: the slot's own exact question stays.
    const farther = [c('same', 2, 'basic', 'A'), c('later', 3, 'intermediate', 'B')]
    expect(
      selectNextBankQuestion({
        candidates: farther,
        served: new Set(),
        slot: 2,
        target: 'basic',
        previousKnowledgePoint: 'A',
      })?.questionId,
    ).toBe('same')
  })
})

describe('bank quiz service', () => {
  it('generates the bank and serves one question at a time', async () => {
    const projectId = await seed()
    const service = new QuizService({ ai: planAI().ai, db })
    const quiz = await service.generateQuiz(projectId, adaptive(4))
    expect(quiz.status).toBe('ready')
    expect(quiz.bank?.entries).toHaveLength(2 + 3 + 3)
    expect(quiz.bank?.length).toBe(4)
    expect(quiz.questionIds).toHaveLength(1)
    expect(quiz.difficultyPlan).toEqual(['basic'])
    expect(quizLength(quiz)).toBe(4)
    expect(quiz.title).toContain('4')
  })

  it('moves up after a correct streak and down after a wrong streak', async () => {
    const projectId = await seed()
    const service = new QuizService({ ai: planAI().ai, db })

    const up = await service.generateQuiz(projectId, adaptive(4))
    const first = await service.submitAnswer(up.id, up.questionIds[0]!, '3')
    expect(first.nextQuestion?.difficulty).toBe('basic')
    const second = await service.submitAnswer(up.id, first.nextQuestion!.id, '3')
    expect(second.nextDifficulty).toBe('intermediate')
    expect(second.nextQuestion?.difficulty).toBe('intermediate')

    const down = await service.generateQuiz(projectId, adaptive(4))
    const a = await service.submitAnswer(down.id, down.questionIds[0]!, '4')
    const b = await service.submitAnswer(down.id, a.nextQuestion!.id, '4')
    expect(b.nextQuestion?.difficulty).toBe('beginner')
    expect((await service.getQuiz(down.id)).difficultyPlan).toEqual(['basic', 'basic', 'beginner'])
  })

  it('ignores disputed answers when choosing the next level', async () => {
    const projectId = await seed()
    const service = new QuizService({ ai: planAI().ai, db })
    const quiz = await service.generateQuiz(projectId, adaptive(4))
    const a = await service.submitAnswer(quiz.id, quiz.questionIds[0]!, '4')
    await service.disputeAttempt(a.attempt.id)
    const b = await service.submitAnswer(quiz.id, a.nextQuestion!.id, '4')
    // One counted wrong answer is not enough to move.
    expect(b.nextQuestion?.difficulty).toBe('basic')
  })

  it('resumes mid-quiz: served order is kept and a missing next question is served', async () => {
    const projectId = await seed()
    const service = new QuizService({ ai: planAI().ai, db })
    const quiz = await service.generateQuiz(projectId, adaptive(4))
    const a = await service.submitAnswer(quiz.id, quiz.questionIds[0]!, '3')
    const served = (await service.getQuiz(quiz.id)).questionIds
    expect(served).toEqual([quiz.questionIds[0], a.nextQuestion!.id])

    // A fresh service (reopened tab) sees the same served questions in order.
    const reopened = new QuizService({ ai: planAI().ai, db })
    expect((await reopened.getQuestions(quiz.id)).map((q) => q.id)).toEqual(served)
    expect((await reopened.resumeQuestionBank(quiz.id)).questionIds).toEqual(served)

    // The tab closed after an answer but before the next question was served.
    const row = await reopened.getQuiz(quiz.id)
    await new QuizRepository(db).upsert({
      ...row,
      questionIds: row.questionIds.slice(0, 1),
      difficultyPlan: row.difficultyPlan.slice(0, 1),
    })
    const resumed = await reopened.resumeQuestionBank(quiz.id)
    expect(resumed.questionIds).toHaveLength(2)
    expect(resumed.questionIds[0]).toBe(quiz.questionIds[0])
  })

  it('completes after the configured length; results hold only served questions', async () => {
    const projectId = await seed()
    const service = new QuizService({ ai: planAI().ai, db })
    const quiz = await service.generateQuiz(projectId, adaptive(4))
    let id = quiz.questionIds[0]!
    let last = false
    for (let i = 0; i < 4; i++) {
      const result = await service.submitAnswer(quiz.id, id, i % 2 === 0 ? '3' : '4')
      last = result.isLastQuestion
      if (result.nextQuestion) id = result.nextQuestion.id
    }
    expect(last).toBe(true)
    const done = await service.getQuiz(quiz.id)
    expect(done.status).toBe('completed')
    expect(done.questionIds).toHaveLength(4)
    expect(done.score?.total).toBe(4)
    expect(await service.getQuestions(quiz.id)).toHaveLength(4)
    expect(done.bank?.entries.length).toBeGreaterThan(4)
  })

  it('reports bank progress while paused', async () => {
    const projectId = await seed()
    const service = new QuizService({ ai: planAI().ai, db })
    let calls = 0
    const quiz = await service.generateQuiz(projectId, adaptive(4), {
      control: { signal: new AbortController().signal, shouldContinue: () => calls++ < 1 },
    })
    expect(quiz.status).toBe('paused')
    expect(quizGenerationProgress(quiz)).toEqual({ done: 5, total: 8 })
    const finished = await service.continueQuiz(quiz.id)
    expect(finished.status).toBe('ready')
    expect(finished.bank?.entries).toHaveLength(8)
    expect(finished.questionIds).toHaveLength(1)
  })

  it('leaves non-adaptive quizzes unchanged', async () => {
    const projectId = await seed()
    const service = new QuizService({ ai: planAI().ai, db })
    const quiz = await service.generateQuiz(projectId, { ...adaptive(4), difficulty: 'basic' })
    expect(quiz.bank).toBeUndefined()
    expect(quiz.questionIds).toHaveLength(4)
    const result = await service.submitAnswer(quiz.id, quiz.questionIds[0]!, '3')
    expect(result.nextQuestion).toBeUndefined()
  })
})
