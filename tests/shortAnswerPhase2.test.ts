import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { PracticeService } from '@/services/practiceService'
import { TutorService } from '@/services/tutorService'
import { MistakeService } from '@/services/mistakeService'
import { MasteryService } from '@/services/masteryService'
import { PracticeRepository } from '@/entities/practice/repository'
import { MistakeRepository } from '@/entities/mistake/repository'
import { KnowledgeMasteryRepository } from '@/entities/knowledgeMastery/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { normalizeTutorQuestion } from '@/infrastructure/ai/prompts/tutor/normalize'
import { normalizeRubricPoints } from '@/infrastructure/ai/prompts/rubric-extractor/v1'
import type { PracticeQuestion } from '@/entities/practice/types'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

const REFERENCE = 'Enzymes lower the activation energy. They are not consumed. Each acts on a specific substrate.'
const POINTS = ['Enzymes lower the activation energy.', 'Enzymes are not consumed.', 'Each enzyme acts on a specific substrate.']
const ANSWER = 'They make the activation energy lower, and they are not used up by the reaction.'

/** Routes each call by its system prompt, the way the real services call the AI. */
function routedAI(extra: (system: string) => unknown = () => undefined) {
  const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
    const system = messages[0]?.content ?? ''
    const routed = extra(system)
    if (routed !== undefined) return { data: routed, raw: { content: '{}', model: 'fake' } }
    if (system.includes('split a reference answer into scoring points')) {
      return { data: { points: POINTS }, raw: { content: '{}', model: 'fake' } }
    }
    if (system.includes('check ONE student short answer')) {
      return {
        data: {
          status: 'ready',
          points: [
            { id: 'p1', covered: true, evidence: 'make the activation energy lower' },
            { id: 'p2', covered: true, evidence: 'not used up by the reaction' },
            { id: 'p3', covered: false },
          ],
          contradictions: [],
          feedback: 'Mention substrate specificity.',
        },
        raw: { content: '{}', model: 'fake' },
      }
    }
    return { data: {}, raw: { content: '{}', model: 'fake' } }
  })
  const ai = {
    chatJSON,
    chat: vi.fn().mockResolvedValue({ content: 'Welcome.', model: 'fake' }),
    streamChat: vi.fn(),
    currentProvider: {},
  } as unknown as AIService
  return { ai, chatJSON }
}

const calls = (spy: ReturnType<typeof vi.fn>, marker: string) =>
  spy.mock.calls.filter(([messages]) => (messages as ChatMessage[])[0]!.content.includes(marker)).length

describe('professor practice short answers', () => {
  let db: AppDatabase
  let projectId: string
  let question: PracticeQuestion

  beforeEach(async () => {
    db = new AppDatabase()
    await db.delete()
    db = new AppDatabase()
    setDbForTesting(db)
    projectId = (await new ProjectService(db).create({ name: 'Biochem', subject: 'chemistry' })).id
    const practice = new PracticeRepository(db)
    await practice.upsertSet({
      id: 'set-1',
      projectId,
      documentId: 'doc-1',
      documentName: 'practice.pdf',
      name: 'Practice',
      questionCount: 1,
      sourceHash: 'h',
      createdAt: 1,
      updatedAt: 1,
    })
    question = {
      id: 'pq-1',
      projectId,
      setId: 'set-1',
      documentId: 'doc-1',
      documentName: 'practice.pdf',
      order: 0,
      type: 'short_answer',
      prompt: 'How do enzymes speed up reactions?',
      options: [],
      expectedAnswer: REFERENCE,
      answerSource: 'professor',
      confidence: 1,
      status: 'verified',
      createdAt: 1,
    }
    await practice.addQuestions([question])
  })

  function service(ai?: AIService) {
    return new PracticeService({
      db,
      ...(ai ? { ai } : {}),
      mistakes: new MistakeService(db),
      mastery: new MasteryService(db),
    })
  }

  it('splits the professor answer into points once and grades by coverage', async () => {
    const { ai, chatJSON } = routedAI()
    const feedback = await service(ai).recordAttempt(question.id, ANSWER)
    expect(feedback.evaluation?.score).toEqual({ earned: 2, total: 3 })
    expect(feedback.method).toBe('rubric')
    expect(feedback.isCorrect).toBe(false)

    const stored = await new PracticeRepository(db).getQuestion(question.id)
    expect(stored!.rubric!.map((point) => point.text)).toEqual(POINTS)

    // The cached points are reused for the next attempt.
    await service(ai).recordAttempt(question.id, ANSWER)
    expect(calls(chatJSON, 'split a reference answer')).toBe(1)
    expect(calls(chatJSON, 'check ONE student short answer')).toBe(2)
  })

  it('feeds the mistake book and mastery, and a dispute takes it back', async () => {
    const { ai } = routedAI()
    const feedback = await service(ai).recordAttempt(question.id, ANSWER)
    const mistakes = new MistakeRepository(db)
    expect(await mistakes.findByQuestion(projectId, question.id)).toBeDefined()
    const mastery = await new KnowledgeMasteryRepository(db).get(projectId, 'practice.pdf')
    expect(mastery?.attempts).toBe(1)

    const disputed = await service(ai).disputeAttempt(feedback.attemptId)
    expect(disputed.evaluation?.disputed).toBe(true)
    expect(await mistakes.findByQuestion(projectId, question.id)).toBeUndefined()
    expect((await new KnowledgeMasteryRepository(db).get(projectId, 'practice.pdf'))?.attempts).toBe(0)
  })

  it('does not grade without a reference answer or without AI', async () => {
    const offline = await service().recordAttempt(question.id, ANSWER)
    expect(offline.isCorrect).toBeUndefined()
    expect(offline.evaluation?.note).toMatch(/Connect an AI service/)

    await new PracticeRepository(db).updateQuestion(question.id, { expectedAnswer: undefined })
    const { ai, chatJSON } = routedAI()
    const noReference = await service(ai).recordAttempt(question.id, ANSWER)
    expect(noReference).toMatchObject({ method: 'none' })
    expect(noReference.evaluation).toBeUndefined()
    expect(chatJSON).not.toHaveBeenCalled()
  })

  it('regenerates the points when the professor answer changes', async () => {
    const { ai, chatJSON } = routedAI()
    await service(ai).recordAttempt(question.id, ANSWER)
    await new PracticeRepository(db).updateQuestion(question.id, { expectedAnswer: `${REFERENCE} Edited.` })
    await service(ai).recordAttempt(question.id, ANSWER)
    expect(calls(chatJSON, 'split a reference answer')).toBe(2)
  })

  it('keeps extracted points distinct and bounded', () => {
    expect(normalizeRubricPoints({ points: ['A', 'a', ' B ', 3, ''] })).toEqual(['A', 'B'])
    expect(normalizeRubricPoints({ points: [] })).toBeNull()
    expect(normalizeRubricPoints('nope')).toBeNull()
  })
})

describe('tutor short answers', () => {
  let db: AppDatabase

  beforeEach(async () => {
    db = new AppDatabase()
    await db.delete()
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('rejects a short-answer question without enough scoring points', () => {
    const base = { prompt: 'Explain.', expectedAnswer: 'Because.', type: 'short_answer' }
    expect(() => normalizeTutorQuestion({ ...base, rubric: ['only one'] })).toThrow()
    const question = normalizeTutorQuestion({ ...base, rubric: ['first', 'second'] })
    expect(question.rubric).toEqual([
      { id: 'p1', text: 'first' },
      { id: 'p2', text: 'second' },
    ])
  })

  it('grades by scoring points, keeps 2/3 neutral for difficulty, and records the mistake', async () => {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Biology', subject: 'chemistry' })
    const docs = new DocumentRepository(db)
    const chunks = new ChunkRepository(db)
    const analyses = new CourseAnalysisRepository(db)
    const doc = await docs.create({ projectId: project.id, type: 'text', name: 'b.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    await chunks.addMany([
      { documentId: doc.id, projectId: project.id, contentType: 'paragraph', text: REFERENCE, sourceReference: 'b.txt', order: 0 },
    ])
    await analyses.reseedProject(
      project.id,
      {
        topics: [{ name: 'Enzymes', description: '', sourceRefs: [{ documentId: doc.id, documentName: 'b.txt' }] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Enzymes', 'topic-enzymes']]),
        documentIds: [doc.id],
      },
      'en',
    )
    const { ai, chatJSON } = routedAI((system) =>
      system.includes('generating the next practice question')
        ? {
            prompt: 'How do enzymes speed up reactions?',
            type: 'short_answer',
            expectedAnswer: REFERENCE,
            rubric: POINTS,
            knowledgePoint: 'Enzymes',
            difficulty: 'basic',
            hints: ['Think about energy.'],
          }
        : undefined,
    )
    const mistakes = new MistakeService(db)
    const tutor = new TutorService({
      ai,
      projects,
      db,
      sessions: new TutorSessionRepository(db),
      analyses,
      chunks,
      questions: new QuestionRepository(db),
      attempts: new QuestionAttemptRepository(db),
      mistakes,
    })
    const session = await tutor.startSession({
      projectId: project.id,
      topicId: 'topic-enzymes',
      topicName: 'Enzymes',
      topicDescription: '',
      language: 'en',
    })
    await tutor.beginTopic(session.id)
    const result = await tutor.submitAnswer(session.id, ANSWER)

    const evaluation = result.turn.evaluation!
    expect(evaluation.scoring).toMatchObject({ earned: 2, total: 3 })
    expect(evaluation.partialCredit).toBe('2/3')
    // The tutor's own right/wrong evaluator was never asked.
    expect(calls(chatJSON, 'evaluating a student answer')).toBe(0)
    // 2/3 ≥ 60%: neither streak moves.
    expect(result.session.streakCorrect).toBe(0)
    expect(result.session.streakWrong).toBe(0)
    const rows = await mistakes.list(project.id, { status: 'all' })
    expect(rows).toHaveLength(1)
  })
})
