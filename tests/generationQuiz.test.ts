import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { QuizService } from '@/services/quizService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import { AbortedError } from '@/infrastructure/ai/errors'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { QuizConfig } from '@/entities/quiz/types'
import type { ChatMessage } from '@/infrastructure/ai/types'

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

afterEach(() => {
  db.close()
})

async function seed() {
  const p = await new ProjectService(db).create({ name: 'Anatomy', subject: 'medicine' })
  const docs = new DocumentRepository(db)
  const doc = await docs.create({ projectId: p.id, type: 'pdf', name: 'atlas.pdf', sizeBytes: 1 })
  await docs.update(doc.id, { status: 'ready' })
  const chunks = await new ChunkRepository(db).addMany(
    Array.from({ length: 12 }, (_, i) => ({
      documentId: doc.id,
      projectId: p.id,
      contentType: 'paragraph' as const,
      text: `Page ${i + 1}: the shoulder structure number ${i + 1} is described here in detail.`,
      sourceReference: 'atlas.pdf',
      order: i,
      pageNumber: i + 1,
    })),
  )
  await new CourseAnalysisRepository(db).reseedProject(
    p.id,
    {
      topics: [
        {
          id: 't1',
          name: 'Shoulder',
          description: 'd',
          sourceRefs: [],
          sourceChunkIds: [chunks[0]!.id],
        },
        {
          id: 't2',
          name: 'Elbow',
          description: 'd',
          sourceRefs: [],
          sourceChunkIds: [chunks[1]!.id],
        },
        {
          id: 't3',
          name: 'Wrist',
          description: 'd',
          sourceRefs: [],
          sourceChunkIds: [chunks[2]!.id],
        },
      ],
      concepts: [],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map(),
      documentIds: [doc.id],
    },
    'en',
  )
  return { projectId: p.id }
}

const topicConfig = (count: number, types: QuizConfig['types']): QuizConfig =>
  ({ mode: 'topic', topicId: 't1', count, difficulty: 'basic', types }) as QuizConfig

/** Answers each plan line with its own type; `onCall` runs before it answers. */
function planAI(onCall: (call: number, signal?: AbortSignal) => Promise<void> | void = () => {}) {
  let call = 0
  const chatJSON = vi.fn(async (messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
    call++
    const current = call
    await onCall(current, options?.signal)
    const plan = [...messages[1]!.content.matchAll(/^\s*\d+\. type=(\w+)/gm)].map((m) => m[1]!)
    return {
      data: {
        questions: plan.map((type, i) => ({
          prompt: `Q${current}.${i} (${type})`,
          type,
          correctAnswer: type === 'true_false' ? 'true' : '3',
          solution: '',
          knowledgePoint: 'K',
          difficulty: 'basic',
          hints: [],
        })),
      },
    }
  })
  return { ai: { chatJSON, maxOutputTokens: 2048 } as unknown as AIService, chatJSON }
}

/** A request that only ends when its signal aborts (as the real provider does). */
function hangUntilAborted(signal?: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(new AbortedError())
    signal?.addEventListener('abort', () => reject(new AbortedError()))
  })
}

describe('pausing quiz generation', () => {
  it('pause after one batch keeps its questions as a paused quiz; continue fills only the rest', async () => {
    const { projectId } = await seed()
    let run: GenerationRun = createGenerationRun()
    const { ai, chatJSON } = planAI((call) => {
      if (call === 1) run.requestPause()
    })
    const service = new QuizService({ ai, db })
    const paused = await service.generateQuiz(
      projectId,
      topicConfig(10, ['numeric', 'true_false']),
      {
        control: run,
      },
    )
    expect(run.finish()).toBe('paused')
    expect(chatJSON).toHaveBeenCalledTimes(1)
    expect(paused.status).toBe('paused')
    expect(paused.questionIds).toHaveLength(5)
    expect(paused.resume?.pending).toHaveLength(5)
    // Not takeable while unfinished.
    await expect(service.startQuiz(paused.id)).rejects.toThrow()

    run = createGenerationRun()
    const ready = await service.continueQuiz(paused.id, { control: run })
    expect(chatJSON).toHaveBeenCalledTimes(2)
    expect(ready.status).toBe('ready')
    expect(ready.resume).toBeUndefined()
    const questions = await service.getQuestions(ready.id)
    expect(questions).toHaveLength(10)
    // Plan order kept: types alternate as planned, each its own type.
    expect(questions.map((q) => q.type)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? 'numeric' : 'true_false')),
    )
    for (const q of questions) expect(q.prompt).toContain(`(${q.type})`)
    // The continuation was told what was already asked.
    expect((chatJSON.mock.calls[1]![0] as ChatMessage[])[1]!.content).toContain('Avoid repeating')
    await expect(service.startQuiz(ready.id)).resolves.toMatchObject({ status: 'in_progress' })
    // A finished quiz is never reopened by starting it again.
    await service.completeQuiz(ready.id)
    await expect(service.startQuiz(ready.id)).resolves.toMatchObject({ status: 'completed' })
  })

  it('stopNow aborts the batch in flight: a paused quiz, never a failed one', async () => {
    const { projectId } = await seed()
    const run = createGenerationRun()
    const { ai, chatJSON } = planAI(async (call, signal) => {
      if (call === 2) {
        queueMicrotask(() => run.stopNow())
        await hangUntilAborted(signal)
      }
    })
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, topicConfig(10, ['numeric']), {
      control: run,
    })
    expect(run.finish()).toBe('stopped')
    // The aborted batch is not retried.
    expect(chatJSON).toHaveBeenCalledTimes(2)
    expect(quiz.status).toBe('paused')
    expect(quiz.errorMessage).toBeUndefined()
    expect(quiz.questionIds).toHaveLength(5)
    expect(quiz.resume?.pending.map((slot) => slot.slot)).toEqual([5, 6, 7, 8, 9])
    expect((await new QuizRepository(db).get(quiz.id))?.status).toBe('paused')
  })

  it('a pause before any batch keeps an empty paused quiz that continue completes', async () => {
    const { projectId } = await seed()
    const run = createGenerationRun()
    run.requestPause()
    const { ai, chatJSON } = planAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, topicConfig(3, ['numeric']), {
      control: run,
    })
    expect(chatJSON).not.toHaveBeenCalled()
    expect(quiz.status).toBe('paused')
    expect(quiz.questionIds).toHaveLength(0)
    const ready = await service.continueQuiz(quiz.id)
    expect(ready.questionIds).toHaveLength(3)
    expect(chatJSON).toHaveBeenCalledTimes(1)
  })

  it('recovers a quiz left generating by a closed tab as paused', async () => {
    const { projectId } = await seed()
    const repo = new QuizRepository(db)
    await repo.upsert({
      id: 'stale',
      projectId,
      title: 'x',
      config: topicConfig(2, ['numeric']),
      questionIds: [],
      status: 'generating',
      difficultyPlan: [],
      startedAt: 0,
      promptVersion: 'v',
      resume: {
        pending: [{ slot: 0, type: 'numeric', difficulty: 'basic' }],
        questionSlots: [],
        groups: [{ knowledgePoints: [], snippetChunkIds: [] }],
        knowledgePoints: [],
        topicName: 'x',
        topicDescription: 'x',
        language: 'en',
        updatedAt: 0,
      },
    })
    await repo.upsert({
      id: 'legacy',
      projectId,
      title: 'y',
      config: topicConfig(2, ['numeric']),
      questionIds: [],
      status: 'generating',
      difficultyPlan: [],
      startedAt: 0,
      promptVersion: 'v',
    })
    const service = new QuizService({ ai: planAI().ai, db })
    expect(await service.recoverInterruptedQuizzes(projectId)).toBe(2)
    expect((await repo.get('stale'))?.status).toBe('paused')
    expect((await repo.get('legacy'))?.status).toBe('failed')
  })
})

/** An oral examiner item with enough scoring points. */
function oralItem() {
  return {
    question: 'Describe the joint.',
    knowledgePoint: 'Joint',
    outline: '- Parts',
    rubric: ['A: one', 'B: two', 'C: three', 'D: four'],
    followUps: [{ question: 'Which nerve?', answer: 'Axillary.', rubric: ['Axillary nerve'] }],
    sources: [],
  }
}

describe('pausing oral exam generation', () => {
  it('keeps the topics written up; continue writes only the remaining ones', async () => {
    const { projectId } = await seed()
    let run = createGenerationRun()
    let calls = 0
    const chatJSON = vi.fn(async () => {
      calls++
      if (calls === 1) run.requestPause()
      return { data: oralItem() }
    })
    const ai = { chatJSON, maxOutputTokens: 2048 } as unknown as AIService
    const service = new QuizService({ ai, db })
    const config = {
      mode: 'oral',
      count: 3,
      difficulty: 'adaptive',
      types: ['short_answer'],
    } as QuizConfig
    const paused = await service.generateQuiz(projectId, config, { control: run })
    expect(paused.status).toBe('paused')
    expect(chatJSON).toHaveBeenCalledTimes(1)
    expect(paused.questionIds).toHaveLength(2) // main + one follow-up
    expect(paused.oralResume?.remaining).toHaveLength(2)

    run = createGenerationRun()
    const ready = await service.continueQuiz(paused.id, { control: run })
    expect(chatJSON).toHaveBeenCalledTimes(3)
    expect(ready.status).toBe('ready')
    expect(ready.config.count).toBe(3)
    expect(ready.questionIds).toHaveLength(6)
    expect(ready.oralResume).toBeUndefined()
  })
})

describe('stopping an AI answer check', () => {
  it('cancels the submission: no attempt is recorded', async () => {
    const { projectId } = await seed()
    const run = createGenerationRun()
    const chatJSON = vi.fn(async (messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
      if (messages[0]!.content.includes('examiner at a university oral exam')) {
        return { data: oralItem() }
      }
      // The short-answer check: hangs until the student stops it.
      queueMicrotask(() => run.stopNow())
      await hangUntilAborted(options?.signal)
      return { data: {} }
    })
    const ai = { chatJSON, maxOutputTokens: 2048 } as unknown as AIService
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, {
      mode: 'oral',
      count: 1,
      difficulty: 'adaptive',
      types: ['short_answer'],
    } as QuizConfig)
    await service.startQuiz(quiz.id)
    await expect(
      service.submitAnswer(
        quiz.id,
        quiz.questionIds[0]!,
        'The joint has a capsule, a labrum and several ligaments around it.',
        { gradeShortAnswer: true, signal: run.signal },
      ),
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(await new QuestionAttemptRepository(db).listByQuiz(quiz.id)).toHaveLength(0)
  })
})
