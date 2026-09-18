import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { MistakeService } from '@/services/mistakeService'
import { MistakeRepository } from '@/entities/mistake/repository'
import { ProjectService } from '@/services/projectService'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import type { Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'

function makeAttempt(projectId: string, questionId: string, isCorrect: boolean, opts: { quizId?: string; userAnswer?: string } = {}): QuestionAttempt {
  return {
    id: crypto.randomUUID(),
    projectId,
    questionId,
    ...(opts.quizId ? { quizId: opts.quizId } : {}),
    knowledgePoint: 'Chain Rule',
    questionType: 'short_answer',
    difficulty: 'intermediate',
    userAnswer: opts.userAnswer ?? 'wrong answer',
    evaluation: { isCorrect, method: 'exact', confidence: 1 },
    hintsUsed: 0,
    createdAt: Date.now(),
  }
}

describe('MistakeService', () => {
  let db: AppDatabase
  let projects: ProjectService
  let service: MistakeService

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
    service = new MistakeService(db)
  })

  async function seedQuestion(projectId: string): Promise<Question> {
    const repo = new QuestionRepository(db)
    const [q] = await repo.addMany([
      {
        projectId,
        knowledgePoint: 'Chain Rule',
        type: 'short_answer',
        difficulty: 'intermediate',
        prompt: 'Differentiate sin(2x)',
        correctAnswer: '2cos(2x)',
        solution: 'Apply the chain rule.',
        hints: [],
      },
    ])
    return q!
  }

  it('creates a mistake from a wrong attempt', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const q = await seedQuestion(p.id)
    const attempt = makeAttempt(p.id, q.id, false)
    const mistake = await service.recordFromAttempt(attempt, q)
    expect(mistake).not.toBeNull()
    expect(mistake!.question).toBe('Differentiate sin(2x)')
    expect(mistake!.studentAnswer).toBe('wrong answer')
    expect(mistake!.correctAnswer).toBe('2cos(2x)')
    expect(mistake!.knowledgePoint).toBe('Chain Rule')
    expect(mistake!.status).toBe('active')
    expect(mistake!.source).toBe('auto')
    expect(mistake!.attemptCount).toBe(1)
  })

  it('ignores correct attempts', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const q = await seedQuestion(p.id)
    const mistake = await service.recordFromAttempt(makeAttempt(p.id, q.id, true), q)
    expect(mistake).toBeNull()
    expect(await service.list(p.id)).toHaveLength(0)
  })

  it('merges repeat mistakes on the same question instead of duplicating', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const q = await seedQuestion(p.id)
    const first = await service.recordFromAttempt(makeAttempt(p.id, q.id, false), q)
    const second = await service.recordFromAttempt(makeAttempt(p.id, q.id, false, { userAnswer: 'again wrong' }), q)
    expect(second!.id).toBe(first!.id)
    expect(second!.attemptCount).toBe(2)
    expect(second!.attemptIds).toHaveLength(2)
    expect(second!.studentAnswer).toBe('again wrong')
    expect(await service.list(p.id)).toHaveLength(1)
  })

  it('re-activates an understood mistake when the student errs again', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const q = await seedQuestion(p.id)
    const first = await service.recordFromAttempt(makeAttempt(p.id, q.id, false), q)
    await service.markUnderstood(first!.id)
    expect((await service.get(first!.id))!.status).toBe('understood')
    const again = await service.recordFromAttempt(makeAttempt(p.id, q.id, false), q)
    expect(again!.status).toBe('active')
  })

  it('adds a mistake manually', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const mistake = await service.addManual({
      projectId: p.id,
      question: 'What is the derivative of ln(x)?',
      studentAnswer: 'ln(x)',
      correctAnswer: '1/x',
      knowledgePoint: 'Logarithmic derivatives',
    })
    expect(mistake.source).toBe('manual')
    expect(mistake.questionId).toBeUndefined()
    expect(mistake.knowledgePoint).toBe('Logarithmic derivatives')
  })

  it('rejects manual mistakes with missing required fields', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    await expect(
      service.addManual({ projectId: p.id, question: '', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' }),
    ).rejects.toThrow(/question/i)
    await expect(
      service.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: '', knowledgePoint: 'KP' }),
    ).rejects.toThrow(/correct answer/i)
    await expect(
      service.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: '' }),
    ).rejects.toThrow(/knowledge point/i)
  })

  it('removes a mistake', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const m = await service.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    await service.remove(m.id)
    expect(await service.get(m.id)).toBeUndefined()
    expect(await service.list(p.id)).toHaveLength(0)
  })

  it('archives and restores a mistake', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const m = await service.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    const archived = await service.archive(m.id)
    expect(archived.status).toBe('archived')
    expect(archived.archivedAt).toBeGreaterThan(0)
    const restored = await service.restore(m.id)
    expect(restored.status).toBe('active')
  })

  it('marks a mistake as understood', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const m = await service.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    const understood = await service.markUnderstood(m.id)
    expect(understood.status).toBe('understood')
    expect(understood.resolvedAt).toBeGreaterThan(0)
  })

  it('filters by status, knowledge point, type, and query', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const a = await service.addManual({ projectId: p.id, question: 'Chain rule question', studentAnswer: 'x', correctAnswer: 'y', knowledgePoint: 'Chain Rule' })
    await service.addManual({ projectId: p.id, question: 'Integral question', studentAnswer: 'x', correctAnswer: 'y', knowledgePoint: 'Integrals' })
    await service.markUnderstood(a.id)

    expect(await service.list(p.id, { status: 'active' })).toHaveLength(1)
    expect(await service.list(p.id, { status: 'understood' })).toHaveLength(1)
    expect(await service.list(p.id, { knowledgePoint: 'Integrals' })).toHaveLength(1)
    expect(await service.list(p.id, { query: 'chain' })).toHaveLength(1)
    expect(await service.list(p.id, { status: 'all' })).toHaveLength(2)
  })

  it('computes stats', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    await service.addManual({ projectId: p.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule', mistakeType: 'conceptual' })
    await service.addManual({ projectId: p.id, question: 'Q2', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule', mistakeType: 'sign' })
    await service.addManual({ projectId: p.id, question: 'Q3', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Integrals', mistakeType: 'conceptual' })
    const stats = await service.stats(p.id)
    expect(stats.total).toBe(3)
    expect(stats.active).toBe(3)
    expect(stats.byType.conceptual).toBe(2)
    expect(stats.byType.sign).toBe(1)
    expect(stats.byKnowledgePoint[0]).toEqual({ knowledgePoint: 'Chain Rule', count: 2 })
  })

  it('isolates mistakes between projects', async () => {
    const p1 = await projects.create({ name: 'P1', subject: 'calculus' })
    const p2 = await projects.create({ name: 'P2', subject: 'physics' })
    await service.addManual({ projectId: p1.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    expect(await service.list(p1.id)).toHaveLength(1)
    expect(await service.list(p2.id)).toHaveLength(0)
  })

  it('persists analysis results', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const m = await service.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    const saved = await service.saveAnalysis(m.id, {
      whereWrong: 'w',
      firstError: 'f',
      whyWrong: 'y',
      correctApproach: 'c',
      possibleCause: 'A possible cause is a sign slip.',
      mistakeType: 'sign',
      reviewKnowledgePoints: ['KP'],
      shouldPracticeMore: true,
      continuePrompt: 'Ready?',
      analyzedAt: Date.now(),
      promptVersion: 'v2',
    })
    expect(saved.analysisStatus).toBe('ready')
    expect(saved.mistakeType).toBe('sign')
    expect(saved.analysis?.possibleCause).toMatch(/possible cause/i)
  })

  it('tracks analysis failure state', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const m = await service.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    const failed = await service.markAnalysisFailed(m.id, 'network error')
    expect(failed.analysisStatus).toBe('failed')
    expect(failed.analysisError).toBe('network error')
  })

  it('finds recent mistakes for a knowledge point', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    await service.addManual({ projectId: p.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await service.addManual({ projectId: p.id, question: 'Q2', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await service.addManual({ projectId: p.id, question: 'Q3', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Other' })
    const recent = await service.recentForKnowledgePoint(p.id, 'Chain Rule')
    expect(recent).toHaveLength(2)
  })

  it('deletes all mistakes for a project', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    await service.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    const repo = new MistakeRepository(db)
    const deleted = await repo.deleteByProject(p.id)
    expect(deleted).toBe(1)
  })
})

describe('MistakeService + QuizService integration', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('records mistakes automatically when a quiz answer is wrong', async () => {
    const { QuizService } = await import('@/services/quizService')
    const { ProjectService: PS } = await import('@/services/projectService')
    const projects = new PS(db)
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const questionRepo = new QuestionRepository(db)
    const [q] = await questionRepo.addMany([
      {
        projectId: p.id,
        knowledgePoint: 'Power Rule',
        type: 'numeric',
        difficulty: 'basic',
        prompt: 'Derivative of x^2 at x=3',
        correctAnswer: '6',
        hints: [],
      },
    ])
    const attemptRepo = new QuestionAttemptRepository(db)
    const { QuizRepository } = await import('@/entities/quiz/repository')
    const quizRepo = new QuizRepository(db)
    const quiz = await quizRepo.upsert({
      id: crypto.randomUUID(),
      projectId: p.id,
      title: 'T',
      config: { mode: 'mixed', count: 1, difficulty: 'adaptive', types: ['numeric'] },
      questionIds: [q!.id],
      status: 'in_progress',
      difficultyPlan: ['basic'],
      startedAt: Date.now(),
      promptVersion: 'v1',
    })

    const mistakes = new MistakeService(db)
    const svc = new QuizService({
      ai: { chatJSON: async () => ({ data: {}, raw: { content: '', model: 'm' } }) } as never,
      db,
      questions: questionRepo,
      attempts: attemptRepo,
      quizzes: quizRepo,
      analyses: new (await import('@/entities/courseAnalysis/repository')).CourseAnalysisRepository(db),
      chunks: new (await import('@/entities/chunk/repository')).ChunkRepository(db),
      mastery: new (await import('@/services/masteryService')).MasteryService(db),
      mistakes,
    })

    await svc.submitAnswer(quiz.id, q!.id, '5')
    const rows = await mistakes.list(p.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.question).toBe('Derivative of x^2 at x=3')
    expect(rows[0]!.studentAnswer).toBe('5')
  })
})