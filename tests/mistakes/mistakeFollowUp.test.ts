import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { MistakeService } from '@/services/mistakeService'
import { MistakeFollowUpService, requestedSigFigs } from '@/services/mistakeFollowUpService'
import {
  CHECKED_ANSWER_TYPE,
  MasteryService,
  observationFromAttempt,
} from '@/services/masteryService'
import {
  FOLLOW_UP_DAYS,
  afterRetest,
  errorDimensionOf,
  isRetestDue,
  questionHash,
  startFollowUp,
} from '@/entities/mistake/followUp'
import type { AIService } from '@/services/aiService'
import type { Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import type { Mistake } from '@/entities/mistake/types'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'

const DAY = 24 * 3600_000

describe('follow-up ladder (pure)', () => {
  it('re-tests after 1 → 3 → 7 → 14 days and finishes after the last', () => {
    let followUp = startFollowUp(0, 'Q')
    expect(followUp.dueAt).toBe(DAY)
    const seen: number[] = [followUp.dueAt]
    for (let i = 0; i < FOLLOW_UP_DAYS.length; i += 1) {
      followUp = afterRetest(followUp, true, followUp.dueAt)
      if (!followUp.completedAt) seen.push(followUp.dueAt)
    }
    expect(followUp.completedAt).toBeDefined()
    expect(seen.slice(1).map((due, i) => (due - seen[i]!) / DAY)).toEqual([3, 7, 14])
    expect(followUp.history.every((event) => event.passed)).toBe(true)
  })

  it('starts again at 1 day after a failed re-test, with the new reason', () => {
    let followUp = startFollowUp(0, 'Q')
    followUp = afterRetest(followUp, true, DAY)
    followUp = afterRetest(followUp, false, 4 * DAY, 'unit')
    expect(followUp.stage).toBe(0)
    expect(followUp.dueAt).toBe(5 * DAY)
    expect(followUp.reason).toBe('unit')
  })

  it('is due only for active, unfinished ladders past their date', () => {
    const followUp = startFollowUp(0, 'Q')
    expect(isRetestDue({ status: 'active', followUp }, DAY)).toBe(true)
    expect(isRetestDue({ status: 'active', followUp }, DAY - 1)).toBe(false)
    expect(isRetestDue({ status: 'understood', followUp }, DAY)).toBe(false)
    expect(isRetestDue({ status: 'active' }, DAY)).toBe(false)
  })

  it('reads the error kind from the grader’s value / unit / sig-fig dimensions', () => {
    expect(
      errorDimensionOf({
        evaluation: {
          dimensions: { value: 'correct', unit: { status: 'missing', expected: 'm' } },
        },
      }),
    ).toBe('unit')
    expect(
      errorDimensionOf({
        evaluation: {
          dimensions: { value: 'correct', sigFigs: { status: 'too-many', required: 3 } },
        },
      }),
    ).toBe('sig_figs')
    expect(errorDimensionOf({ evaluation: { dimensions: { value: 'wrong' } } })).toBe('value')
    expect(errorDimensionOf({ mistakeType: 'sign' })).toBe('sign')
    expect(errorDimensionOf({})).toBeUndefined()
  })

  it('reads the significant figures a question asks for', () => {
    expect(requestedSigFigs('Give your answer to 3 significant figures.')).toBe(3)
    expect(requestedSigFigs('结果保留2位有效数字。')).toBe(2)
    expect(requestedSigFigs('Find v.')).toBeUndefined()
  })

  it('counts AI-checked answers half and local checks fully, like quiz short answers', () => {
    const base: QuestionAttempt = {
      id: 'a',
      projectId: 'p',
      questionId: 'q',
      knowledgePoint: 'k',
      questionType: CHECKED_ANSWER_TYPE,
      difficulty: 'basic',
      userAnswer: 'x',
      evaluation: { isCorrect: true, method: 'ai', confidence: 0.8 },
      hintsUsed: 0,
      createdAt: 1,
    }
    expect(observationFromAttempt(base).weight).toBe(0.5)
    expect(
      observationFromAttempt({ ...base, evaluation: { ...base.evaluation, method: 'exact' } })
        .weight,
    ).toBeUndefined()
  })
})

type Handler = (system: string, user: string) => unknown

function stubAI(handler: Handler) {
  const calls: Array<{ system: string; user: string }> = []
  const respond = vi.fn(async (messages: Array<{ content: string }>) => {
    const system = messages[0]!.content
    const user = messages[1]!.content
    calls.push({ system, user })
    return { data: await handler(system, user), raw: {} }
  })
  return {
    calls,
    ai: { streamJSON: respond, chatJSON: respond, maxOutputTokens: 8192 } as unknown as AIService,
  }
}

const isReview = (system: string) => system.includes('You review NEW practice questions')
const pass = { results: [{ id: 'p1', pass: true, reason: 'ok' }] }

describe('MistakeFollowUpService', () => {
  let db: AppDatabase
  let projectId: string
  let lectureId: string
  let paperId: string

  async function quizMistake(question: Partial<Question> = {}, wrong = '6'): Promise<Mistake> {
    const q: Question = {
      id: crypto.randomUUID(),
      projectId,
      knowledgePoint: 'Kinematics',
      type: 'numeric',
      difficulty: 'basic',
      prompt: 'A car travels 30 m in 5 s. Find its speed in m/s.',
      correctAnswer: '6',
      hints: [],
      sourceRefs: [
        { documentId: paperId, documentName: 'Final.pdf', page: 2 },
        { documentId: lectureId, documentName: 'Lecture 1.pdf', page: 4, chunkId: 'c1' },
      ],
      promptVersion: 'test',
      createdAt: Date.now(),
      ...question,
    }
    await db.questions.add(q)
    const attempt: QuestionAttempt = {
      id: crypto.randomUUID(),
      projectId,
      questionId: q.id,
      quizId: 'quiz-1',
      knowledgePoint: q.knowledgePoint,
      questionType: q.type,
      difficulty: 'basic',
      userAnswer: wrong,
      evaluation: { isCorrect: false, method: 'numeric', confidence: 1 },
      hintsUsed: 0,
      createdAt: Date.now(),
    }
    const mistake = await new MistakeService(db).recordFromAttempt(attempt, q)
    return mistake!
  }

  async function makeDue(id: string): Promise<void> {
    const row = (await db.mistakes.get(id))!
    await db.mistakes.put({ ...row, followUp: { ...row.followUp!, dueAt: Date.now() - 1000 } })
  }

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projectId = (await new ProjectService(db).create({ name: 'Physics', subject: 'physics' })).id
    const documents = new DocumentRepository(db)
    lectureId = (
      await documents.create({
        projectId,
        type: 'text',
        materialType: 'textbook',
        name: 'Lecture 1.pdf',
        sizeBytes: 0,
      })
    ).id
    paperId = (
      await documents.create({
        projectId,
        type: 'text',
        materialType: 'past_exam',
        name: 'Final.pdf',
        sizeBytes: 0,
      })
    ).id
  })

  it('schedules a re-test when a mistake is recorded and links only lecture pages', async () => {
    const mistake = await quizMistake()
    expect(mistake.origin).toBe('quiz')
    expect(mistake.followUp?.stage).toBe(0)
    const service = new MistakeFollowUpService({ ai: null, db })
    const links = await service.lectureLinks(mistake)
    expect(links).toEqual([{ documentId: lectureId, documentName: 'Lecture 1.pdf', page: 4 }])
  })

  it('falls back to the course topic sources for the lecture links', async () => {
    await new CourseAnalysisRepository(db).addTopics([
      {
        id: 't1',
        projectId,
        name: 'Kinematics',
        description: '',
        order: 0,
        sourceRefs: [{ documentId: lectureId, documentName: 'Lecture 1.pdf', page: 9 }],
        createdAt: Date.now(),
      },
    ])
    const mistake = await quizMistake({ sourceRefs: [], topicId: 't1' })
    const links = await new MistakeFollowUpService({ ai: null, db }).lectureLinks(mistake)
    expect(links).toEqual([{ documentId: lectureId, documentName: 'Lecture 1.pdf', page: 9 }])
  })

  it('lets the student retry the same question locally without moving the schedule', async () => {
    const mistake = await quizMistake()
    const service = new MistakeFollowUpService({ ai: null, db })
    expect(await service.retryQuestion(mistake)).not.toBeNull()
    expect((await service.retry(mistake.id, '6')).verdict).toBe('correct')
    const row = (await db.mistakes.get(mistake.id))!
    expect(row.followUp?.stage).toBe(0)
    expect(row.followUp?.history.at(-1)).toMatchObject({ kind: 'retry', passed: true })
  })

  it('builds a reviewed variant that is never the identical question, and runs the re-test', async () => {
    const mistake = await quizMistake()
    let generated = 0
    const { ai, calls } = stubAI((system) => {
      if (isReview(system)) return pass
      generated += 1
      // The first answer repeats the original question; it must be rejected.
      const prompt =
        generated === 1
          ? 'A car travels 30 m in 5 s. Find its speed in m/s.'
          : 'A cyclist rides 48 m in 6 s. Find the speed.'
      return {
        questions: [
          {
            slot: 's1',
            stem: '',
            parts: [
              {
                prompt,
                answer: generated === 1 ? '6 m/s' : '8 m/s',
                solution: 'v = d / t',
                check: {
                  type: 'numeric',
                  expression: generated === 1 ? '30/5' : '48/6',
                  unit: 'm/s',
                },
              },
            ],
          },
        ],
      }
    })
    const service = new MistakeFollowUpService({ ai, db })
    // Not due yet.
    await expect(service.createVariant(mistake.id, 'retest')).rejects.toThrow()
    await makeDue(mistake.id)
    const variant = await service.createVariant(mistake.id, 'retest')
    expect(variant.parts[0]!.prompt).toContain('cyclist')
    expect(variant.hash).not.toBe(questionHash(mistake.question))
    expect(generated).toBe(2)
    expect(calls.some((call) => call.user.includes('Rejected before'))).toBe(true)

    const result = await service.checkVariant(mistake.id, '8 m/s')
    expect(result).toMatchObject({ verdict: 'correct', method: 'local' })
    const row = (await db.mistakes.get(mistake.id))!
    expect(row.followUp?.stage).toBe(1)
    expect(row.followUp!.dueAt - Date.now()).toBeGreaterThan(2.9 * DAY)
    expect(row.followUp?.current).toBeUndefined()
    // Mastery counts the re-test; no new mistake is created.
    expect(await db.mistakes.count()).toBe(1)
    const mastery = await new MasteryService(db).get(projectId, 'Kinematics')
    expect(mastery?.observations.at(-1)).toMatchObject({
      questionType: CHECKED_ANSWER_TYPE,
      isCorrect: true,
    })
  })

  it('a failed re-test restarts the ladder, counts the error again and names its kind', async () => {
    const mistake = await quizMistake()
    const { ai } = stubAI((system) =>
      isReview(system)
        ? pass
        : {
            questions: [
              {
                slot: 's1',
                stem: '',
                parts: [
                  {
                    prompt: 'A runner covers 100 m in 20 s. Find the speed.',
                    answer: '5 m/s',
                    solution: 'v = d/t',
                    check: { type: 'numeric', expression: '100/20', unit: 'm/s' },
                  },
                ],
              },
            ],
          },
    )
    const service = new MistakeFollowUpService({ ai, db })
    await makeDue(mistake.id)
    await service.createVariant(mistake.id, 'retest')
    const result = await service.checkVariant(mistake.id, '5 km')
    expect(result.verdict).toBe('incorrect')
    const row = (await db.mistakes.get(mistake.id))!
    expect(row.followUp?.stage).toBe(0)
    expect(row.attemptCount).toBe(2)
    expect(row.followUp?.reason).toBe('unit')
  })

  it('targets the previous error kind: a sig-fig variant must ask for and check sig figs', async () => {
    const mistake = await quizMistake()
    await db.mistakes.update(mistake.id, { errorDimension: 'sig_figs' })
    const { ai, calls } = stubAI((system) =>
      isReview(system)
        ? pass
        : {
            questions: [
              {
                slot: 's1',
                stem: '',
                parts: [
                  {
                    prompt:
                      'A car travels 10.0 m in 3.00 s. Give its speed to 3 significant figures.',
                    answer: '3.33',
                    solution: 'v = 10/3',
                    check: { type: 'numeric', expression: '10/3', unit: '' },
                  },
                ],
              },
            ],
          },
    )
    const service = new MistakeFollowUpService({ ai, db })
    const variant = await service.createVariant(mistake.id, 'variant')
    expect(calls[0]!.user).toContain('Focus:')
    expect(calls[0]!.user).toContain('significant figures')
    expect(variant.parts[0]!.answer).toBe('3.33')
    const result = await service.checkVariant(mistake.id, '3.3333')
    expect(result).toMatchObject({ verdict: 'incorrect', dimension: 'sig_figs' })
    // A practice variant never moves the re-test schedule.
    expect((await db.mistakes.get(mistake.id))!.followUp?.stage).toBe(0)
    expect((await service.checkVariant(mistake.id, '3.33')).verdict).toBe('correct')
  })

  it('offers no variants or re-tests for independent evaluation items', async () => {
    const now = Date.now()
    const set: HomeworkSet = {
      id: 'set-1',
      projectId,
      documentId: paperId,
      documentName: 'Final.pdf',
      title: 'Final',
      status: 'ready',
      language: 'en',
      questionCount: 1,
      promptVersion: 'v2',
      kind: 'exam',
      createdAt: now,
      updatedAt: now,
    }
    const question = {
      id: 'hq-1',
      projectId,
      setId: set.id,
      documentId: paperId,
      documentName: 'Final.pdf',
      order: 0,
      prompt: 'Find x.',
      sourceRefs: [],
      hints: [],
      generationStatus: 'ready',
      promptVersion: 'v3',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      evalRole: 'independent',
      createdAt: now,
      updatedAt: now,
    } as HomeworkQuestion
    await db.homeworkSets.add(set)
    await db.homeworkQuestions.add(question)
    const { recordCheckedAnswer } = await import('@/services/practiceLearning')
    await recordCheckedAnswer(db, {
      projectId,
      questionId: question.id,
      prompt: question.prompt,
      knowledgePoint: 'Algebra',
      answer: '1',
      correctAnswer: '2',
      check: { verdict: 'incorrect', method: 'local' },
      origin: 'mock_exam',
      homeworkSetId: set.id,
      noFollowUp: true,
    })
    const mistake = (await db.mistakes.toArray())[0]!
    expect(mistake.followUp).toBeUndefined()
    const service = new MistakeFollowUpService({ ai: stubAI(() => pass).ai, db })
    expect(await service.canFollowUp(mistake)).toBe(false)
    await expect(service.createVariant(mistake.id, 'variant')).rejects.toThrow()
    expect(await service.dueRetests(projectId, Date.now() + 30 * DAY)).toEqual([])
  })

  it('builds linear-system variants locally with the same solution type', async () => {
    const now = Date.now()
    await db.homeworkSets.add({
      id: 'ps-1',
      projectId,
      documentId: lectureId,
      documentName: 'HW',
      title: 'Practice',
      status: 'ready',
      language: 'en',
      questionCount: 1,
      promptVersion: 'p',
      kind: 'practice',
      createdAt: now,
      updatedAt: now,
    })
    const question = {
      id: 'pq-1',
      projectId,
      setId: 'ps-1',
      documentId: lectureId,
      documentName: 'HW',
      order: 0,
      prompt: 'Solve the system.',
      sourceRefs: [],
      hints: [],
      solution: 'RREF',
      generationStatus: 'ready',
      promptVersion: 'p',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      practice: {
        origin: 'local',
        parts: [
          {
            answer: 'no solution',
            grader: {
              kind: 'linear_system',
              augmented: [
                ['1', '1', '1'],
                ['1', '1', '2'],
              ],
              rref: [
                ['1', '1', '0'],
                ['0', '0', '1'],
              ],
              solution: 'none',
              free: 0,
            },
          },
        ],
        knowledgePoints: ['Linear systems'],
        templates: ['linear_system'],
      },
      createdAt: now,
      updatedAt: now,
    } as HomeworkQuestion
    await db.homeworkQuestions.add(question)
    const { recordCheckedAnswer } = await import('@/services/practiceLearning')
    await recordCheckedAnswer(db, {
      projectId,
      questionId: question.id,
      prompt: question.prompt,
      knowledgePoint: 'Linear systems',
      answer: 'x1 = 1',
      correctAnswer: 'no solution',
      check: { verdict: 'incorrect', method: 'local' },
      origin: 'homework_practice',
      homeworkSetId: 'ps-1',
    })
    const mistake = (await db.mistakes.toArray())[0]!
    const { ai, calls } = stubAI((system) => (isReview(system) ? pass : { questions: [] }))
    const variant = await new MistakeFollowUpService({ ai, db }).createVariant(
      mistake.id,
      'variant',
    )
    expect(variant.origin).toBe('local')
    expect(variant.parts[0]!.grader).toMatchObject({ kind: 'linear_system', solution: 'none' })
    expect(calls.every((call) => isReview(call.system))).toBe(true)
  })

  it('lists the due re-tests of a course', async () => {
    const mistake = await quizMistake()
    const service = new MistakeFollowUpService({ ai: null, db })
    expect(await service.dueRetests(projectId)).toEqual([])
    expect((await service.dueRetests(projectId, Date.now() + 2 * DAY)).map((m) => m.id)).toEqual([
      mistake.id,
    ])
  })
})
