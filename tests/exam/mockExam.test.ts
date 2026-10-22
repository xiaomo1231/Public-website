import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { HomeworkService } from '@/services/homeworkService'
import { MockExamService } from '@/services/mockExamService'
import { CHECKED_ANSWER_TYPE } from '@/services/masteryService'
import { QuestionHabitsService } from '@/services/questionHabitsService'
import type { AIService } from '@/services/aiService'
import type { HomeworkSet } from '@/entities/homework/types'

type StubHandler = (system: string, user: string) => unknown

function stubAI(handler: StubHandler): AIService {
  const respond = async (messages: Array<{ content: string }>) => ({
    data: await handler(messages[0]?.content ?? '', messages[1]?.content ?? ''),
    raw: {},
  })
  return {
    chatJSON: respond,
    streamJSON: respond,
    chat: async () => ({ content: 'hint' }),
    maxOutputTokens: 8192,
  } as unknown as AIService
}

const PROMPTS = [
  'Calculate 2 + 3. (2 marks)',
  'Explain why the velocity of a falling ball increases. (4 marks)',
  'Calculate 10 / 2. (2 marks)',
]

describe('past exam → mock exam', () => {
  let db: AppDatabase
  let projectId: string
  let documentId: string
  let topicDoc: string
  let checks: number

  const handler: StubHandler = (system, user) => {
    if (system.includes('extract the individual questions')) {
      const ids = [...user.matchAll(/\[c:([^ ·\]]+)/g)].map((m) => m[1]!)
      return {
        questions: ids.map((id, i) => ({
          number: String(i + 1),
          prompt: PROMPTS[i],
          sourceChunkIds: [id],
        })),
      }
    }
    if (system.includes('Assess ONE student homework answer')) {
      checks += 1
      return {
        status: 'ready',
        similarityPercent: 40,
        verdict: 'partial',
        feedback: 'Gravity is mentioned, acceleration is missing.',
        matchedPoints: ['gravity'],
        missingPoints: ['acceleration'],
      }
    }
    return { hints: ['h'], solution: 'Reference solution.' }
  }

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    checks = 0
    const project = await new ProjectService(db).create({ name: 'Physics', subject: 'physics' })
    projectId = project.id
    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'text',
      materialType: 'past_exam',
      name: 'Midterm 2023.pdf',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready' })
    documentId = doc.id
    await new ChunkRepository(db).addMany(
      PROMPTS.map((text, order) => ({
        documentId: doc.id,
        projectId,
        materialType: 'past_exam' as const,
        pageNumber: 1,
        contentType: 'paragraph' as const,
        text: order === 0 ? `Time allowed: 1 hour\n${text}` : text,
        sourceReference: 'Midterm 2023.pdf · Page 1',
        order,
      })),
    )
    // A lecture document and a course topic about falling bodies.
    const lecture = await documents.create({
      projectId,
      type: 'text',
      materialType: 'textbook',
      name: 'Lecture 3.pdf',
      sizeBytes: 0,
    })
    topicDoc = lecture.id
    await new CourseAnalysisRepository(db).addTopics([
      {
        id: 't-fall',
        projectId,
        name: 'Velocity of a falling ball',
        description: 'free fall, velocity increases under gravity',
        order: 0,
        sourceRefs: [{ documentId: lecture.id, documentName: 'Lecture 3.pdf', page: 7 }],
        createdAt: Date.now(),
      },
    ])
  })

  async function recognise(): Promise<{ set: HomeworkSet; homework: HomeworkService }> {
    const homework = new HomeworkService({ db, ai: stubAI(handler) })
    const set = await homework.createFromDocument(documentId)
    return { set, homework }
  }

  it('recognises a past paper as an exam set with the stated time', async () => {
    const { set } = await recognise()
    expect(set.kind).toBe('exam')
    expect(set.status).toBe('ready')
    expect((await new HomeworkRepository(db).getSet(set.id))?.exam?.detectedMinutes).toBe(60)
  })

  it('runs a timed mock exam, checks after submitting and records estimates apart from the paper marks', async () => {
    const { set, homework } = await recognise()
    const repo = new HomeworkRepository(db)
    const questions = (await repo.listQuestions(set.id)).sort((a, b) => a.order - b.order)
    expect(questions.map((q) => q.prompt)).toEqual(PROMPTS)
    // The professor's answer key for Q1 (with a marking scheme line).
    await repo.updateQuestion(questions[0]!.id, {
      answerText: '5 B1',
      answerStatus: 'matched',
    })

    const service = new MockExamService({ homework, db })
    const state = await service.state(set.id)
    expect(state.defaultMinutes).toBe(60)
    expect(state.questions.map((view) => view.marks.total)).toEqual([2, 4, 2])
    expect(state.questions[0]!.scheme).toEqual(['5 B1'])

    const attempt = await service.start(set.id, 30)
    expect(attempt.durationMinutes).toBe(30)
    expect(attempt.endsAt - attempt.startedAt).toBe(30 * 60_000)
    // Starting again returns the attempt in progress.
    expect((await service.start(set.id, 90)).id).toBe(attempt.id)

    await service.saveAnswer(set.id, questions[0]!.id, '5')
    await service.saveAnswer(set.id, questions[1]!.id, 'Because gravity pulls it.')
    // Checking before submitting is refused.
    await expect(service.check(set.id, 'en')).rejects.toThrow()
    await service.submit(set.id)
    // Answers are frozen once submitted.
    await service.saveAnswer(set.id, questions[0]!.id, 'changed')

    const done = await service.check(set.id, 'en')
    expect(done.checkedAt).toBeDefined()
    expect(done.answers[questions[0]!.id]).toBe('5')
    const byId = new Map(done.results!.map((result) => [result.questionId, result]))
    expect(byId.get(questions[0]!.id)).toMatchObject({
      status: 'checked',
      method: 'local',
      verdict: 'correct',
      estimatedMarks: 2,
    })
    expect(byId.get(questions[1]!.id)).toMatchObject({
      status: 'checked',
      method: 'ai',
      verdict: 'partial',
      marks: 4,
      estimatedMarks: 1.5,
    })
    expect(byId.get(questions[2]!.id)).toMatchObject({ status: 'unanswered', estimatedMarks: 0 })
    expect(checks).toBe(1)

    // The attempt moved into the history.
    const stored = await repo.getSet(set.id)
    expect(stored?.exam?.current).toBeUndefined()
    expect(stored?.exam?.attempts?.[0]?.id).toBe(attempt.id)

    // The partly right answer is in the mistake book with the lecture page of
    // its course topic, and its first re-test is scheduled for tomorrow.
    const mistakes = await db.mistakes.where('projectId').equals(projectId).toArray()
    expect(mistakes).toHaveLength(1)
    const mistake = mistakes[0]!
    expect(mistake).toMatchObject({
      origin: 'mock_exam',
      homeworkSetId: set.id,
      knowledgePoint: 'Velocity of a falling ball',
      topicId: 't-fall',
    })
    expect(mistake.sourceRefs?.[0]).toMatchObject({ documentId: topicDoc, page: 7 })
    expect(mistake.followUp?.stage).toBe(0)
    expect(mistake.followUp!.dueAt - Date.now()).toBeGreaterThan(23 * 3600_000)

    // Mastery: one observation per decided answer, AI readings at half weight.
    const mastery = await db.knowledgeMastery.where('projectId').equals(projectId).toArray()
    const observations = mastery.flatMap((row) => row.observations)
    expect(observations).toHaveLength(2)
    expect(observations.every((o) => o.questionType === CHECKED_ANSWER_TYPE)).toBe(true)
    const ai = observations.find((o) => o.weight === 0.5)
    expect(ai?.credit).toBeCloseTo(0.4)
  })

  it('skips already checked questions when checking continues', async () => {
    const { set, homework } = await recognise()
    const service = new MockExamService({ homework, db })
    const questions = (await new HomeworkRepository(db).listQuestions(set.id)).sort(
      (a, b) => a.order - b.order,
    )
    await service.start(set.id, 30)
    await service.saveAnswer(set.id, questions[1]!.id, 'Gravity.')
    await service.submit(set.id)
    // Stop before anything is checked.
    const stopped = await service.check(set.id, 'en', {
      control: { signal: new AbortController().signal, shouldContinue: () => false },
    })
    expect(stopped.checkedAt).toBeUndefined()
    expect(checks).toBe(0)
    await service.check(set.id, 'en')
    expect(checks).toBe(1)
  })

  it('feeds exam questions to the habits collector as exam sources, unless held out', async () => {
    const { set } = await recognise()
    const habits = new QuestionHabitsService({ ai: null, db })
    const docs = await habits.collectDocuments(projectId)
    expect(docs.find((doc) => doc.documentId === documentId)?.kind).toBe('exam')
    await db.homeworkSets.update(set.id, { evalRole: 'independent' } as Partial<HomeworkSet>)
    expect(
      (await habits.collectDocuments(projectId)).some((doc) => doc.documentId === documentId),
    ).toBe(false)
  })

  it('keeps past papers out of course analysis inputs', async () => {
    const doc = await new DocumentRepository(db).get(documentId)
    const { isReferenceOnlyMaterial } = await import('@/entities/document/types')
    expect(isReferenceOnlyMaterial(doc.materialType)).toBe(true)
  })
})
