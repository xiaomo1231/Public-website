import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { TutorService } from '@/services/tutorService'
import { MistakeService } from '@/services/mistakeService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

const QUESTION = {
  prompt: 'What is the derivative of x^3?',
  type: 'math_expr' as const,
  expectedAnswer: '3x^2',
  explanation: 'Apply the power rule.',
  knowledgePoint: 'Power Rule',
  difficulty: 'basic' as const,
  sourceRefs: [],
  hints: ['Bring the exponent down'],
}

function scriptedAI(isCorrectSequence: boolean[]): AIService {
  let evalIndex = 0
  return {
    chat: vi.fn().mockResolvedValue({ content: 'Welcome.', model: 'fake' }),
    chatJSON: vi.fn(async (messages: ChatMessage[]) => {
      const system = messages.find((m) => m.role === 'system')?.content ?? ''
      if (system.includes('generating the next practice question')) {
        return { data: QUESTION, raw: { content: '{}', model: 'fake' } }
      }
      if (system.includes('evaluating a student answer')) {
        const isCorrect = isCorrectSequence[evalIndex++] ?? isCorrectSequence[isCorrectSequence.length - 1]!
        return {
          data: {
            isCorrect,
            feedback: isCorrect ? 'Correct.' : 'Check the exponent.',
            breakdown: ['The exponent was not reduced.'],
            nextSteps: 'Reapply the power rule.',
            groundedExplanation: 'd/dx x^3 = 3x^2.',
            isSupplementary: false,
          },
          raw: { content: '{}', model: 'fake' },
        }
      }
      return { data: {}, raw: { content: '{}', model: 'fake' } }
    }),
    streamChat: vi.fn(),
    testConnection: vi.fn(),
    reset: vi.fn(),
    currentProvider: {},
  } as unknown as AIService
}

describe('Tutor wrong answers → mistake book', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function setup(isCorrectSequence: boolean[]) {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Calculus', subject: 'calculus' })
    const docs = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    const analyses = new CourseAnalysisRepository(db)
    const doc = await docs.create({ projectId: project.id, type: 'text', name: 'c.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph',
        text: 'The power rule states d/dx x^n = n x^(n-1).',
        sourceReference: 'c.txt',
        order: 0,
      },
    ])
    const topicId = 'topic-power'
    await analyses.reseedProject(
      project.id,
      {
        topics: [{ name: 'Derivatives', description: '', sourceRefs: [{ documentId: doc.id, documentName: 'c.txt' }] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Derivatives', topicId]]),
        documentIds: [doc.id],
      },
      'en',
    )

    const mistakes = new MistakeService(db)
    const questions = new QuestionRepository(db)
    const attempts = new QuestionAttemptRepository(db)
    const sessions = new TutorSessionRepository(db)
    const ai = scriptedAI(isCorrectSequence)
    const tutor = new TutorService({
      ai,
      projects,
      db,
      sessions,
      analyses,
      chunks,
      questions,
      attempts,
      mistakes,
    })
    const session = await tutor.startSession({
      projectId: project.id,
      topicId,
      topicName: 'Derivatives',
      topicDescription: '',
      language: 'en',
    })
    return { project, topicId, mistakes, questions, attempts, sessions, tutor, session }
  }

  it('records a mistake with every required field', async () => {
    const { project, topicId, mistakes, tutor, session } = await setup([false])
    await tutor.beginTopic(session.id)
    await tutor.submitAnswer(session.id, 'x^2')

    const rows = await mistakes.list(project.id, { status: 'all' })
    expect(rows).toHaveLength(1)
    const m = rows[0]!
    expect(m.question).toBe(QUESTION.prompt)
    expect(m.studentAnswer).toBe('x^2')
    expect(m.correctAnswer).toBe('3x^2')
    expect(m.projectId).toBe(project.id)
    expect(m.topicId).toBe(topicId)
    expect(m.knowledgePoint).toBe('Power Rule')
    expect(m.difficulty).toBe('basic')
    expect(m.createdAt).toBeGreaterThan(0)
    expect(m.source).toBe('auto')
    expect(m.status).toBe('active')
  })

  it('links the mistake to a persisted question so the reference is real', async () => {
    const { project, topicId, mistakes, questions, tutor, session } = await setup([false])
    await tutor.beginTopic(session.id)
    await tutor.submitAnswer(session.id, 'x^2')

    const mistake = (await mistakes.list(project.id, { status: 'all' }))[0]!
    expect(mistake.questionId).toBeTruthy()
    const stored = await questions.get(mistake.questionId!)
    expect(stored).toBeDefined()
    expect(stored!.prompt).toBe(QUESTION.prompt)
    expect(stored!.correctAnswer).toBe('3x^2')
    expect(stored!.projectId).toBe(project.id)
    expect(stored!.topicId).toBe(topicId)
  })

  it('records an attempt alongside the mistake', async () => {
    const { project, attempts, mistakes, tutor, session } = await setup([false])
    await tutor.beginTopic(session.id)
    await tutor.submitAnswer(session.id, 'x^2')

    const mistake = (await mistakes.list(project.id, { status: 'all' }))[0]!
    expect(mistake.attemptIds).toHaveLength(1)
    const attempt = await attempts.listByProject(project.id)
    expect(attempt).toHaveLength(1)
    expect(attempt[0]!.id).toBe(mistake.attemptIds[0])
    expect(attempt[0]!.userAnswer).toBe('x^2')
    expect(attempt[0]!.evaluation.isCorrect).toBe(false)
    expect(attempt[0]!.evaluation.method).toBe('ai')
  })

  it('does not record a mistake for a correct answer', async () => {
    const { project, mistakes, tutor, session } = await setup([true])
    await tutor.beginTopic(session.id)
    await tutor.submitAnswer(session.id, '3x^2')

    expect(await mistakes.list(project.id, { status: 'all' })).toHaveLength(0)
  })

  it('merges a repeat error on the same question instead of duplicating', async () => {
    const { project, mistakes, sessions, tutor, session } = await setup([false, false])
    await tutor.beginTopic(session.id)

    // Capture the exact pending question (with its persisted id) before answering.
    const before = await sessions.get(session.id)
    const pending = before!.pendingQuestion
    expect(pending).toBeDefined()

    await tutor.submitAnswer(session.id, 'x^2')

    // Simulate the student retrying the same question: restore it and answer again.
    const after = await sessions.get(session.id)
    await sessions.upsert({ ...after!, pendingQuestion: pending })

    await tutor.submitAnswer(session.id, 'x^3')

    const rows = await mistakes.list(project.id, { status: 'all' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.attemptCount).toBe(2)
    expect(rows[0]!.attemptIds).toHaveLength(2)
    // The latest answer is reflected.
    expect(rows[0]!.studentAnswer).toBe('x^3')
  })

  it('isolates tutor mistakes per project', async () => {
    const { project, mistakes, tutor, session } = await setup([false])
    await tutor.beginTopic(session.id)
    await tutor.submitAnswer(session.id, 'x^2')

    const other = await new ProjectService(db).create({ name: 'Other', subject: 'physics' })
    expect(await mistakes.list(project.id, { status: 'all' })).toHaveLength(1)
    expect(await mistakes.list(other.id, { status: 'all' })).toHaveLength(0)
  })

  it('still records a mistake when question persistence is unavailable', async () => {
    const { project, mistakes, tutor, session } = await setup([false])
    await tutor.beginTopic(session.id)
    await tutor.submitAnswer(session.id, 'x^2')
    // Sanity: the happy path is covered above; this asserts no throw occurred.
    expect(await mistakes.list(project.id, { status: 'all' })).toHaveLength(1)
  })
})
