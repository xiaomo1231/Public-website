import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import {
  SyllabusService,
  clearPausedSyllabusMatchesForTesting,
  pausedSyllabusMatch,
} from '@/services/syllabusService'
import {
  InterviewService,
  clearPausedScenarioExtractionsForTesting,
} from '@/services/interviewService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { InterviewScenario } from '@/entities/interview/types'
import type { SyllabusData } from '@/entities/syllabus/types'
import { AbortedError } from '@/infrastructure/ai/errors'
import { createGenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  clearPausedSyllabusMatchesForTesting()
  clearPausedScenarioExtractionsForTesting()
})

afterEach(() => {
  db.close()
})

/** A model call that waits for the test, and rejects with ABORTED when its signal aborts. */
function deferredCall<T>(value: T, signal?: AbortSignal) {
  let release!: () => void
  const promise = new Promise<T>((resolve, reject) => {
    release = () => resolve(value)
    if (signal?.aborted) reject(new AbortedError())
    signal?.addEventListener('abort', () => reject(new AbortedError()))
  })
  return { promise, release }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// ---- syllabus matching ------------------------------------------------------

/** 90 exam topics in one scope → three batches of 40 / 40 / 10. */
async function seedSyllabus() {
  const project = await new ProjectService(db).create({ name: 'Anatomy', subject: 'medicine' })
  const docs = new DocumentRepository(db)
  const book = await docs.create({
    projectId: project.id,
    type: 'pdf',
    name: 'atlas.pdf',
    sizeBytes: 1,
    materialType: 'textbook',
  })
  const [chunk] = await new ChunkRepository(db).addMany([
    {
      documentId: book.id,
      projectId: project.id,
      materialType: 'textbook',
      contentType: 'paragraph' as const,
      text: 'The shoulder joint.',
      sourceReference: 'atlas',
      order: 0,
      pageNumber: 1,
    },
  ])
  await new CourseAnalysisRepository(db).reseedProject(
    project.id,
    {
      topics: [
        {
          id: 't-shoulder',
          name: 'Shoulder Joint',
          description: 'Rotator cuff',
          sourceRefs: [],
          sourceChunkIds: [chunk!.id],
        },
      ],
      concepts: [],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map(),
      documentIds: [book.id],
    },
    'en',
  )
  const doc = await docs.create({
    projectId: project.id,
    type: 'pdf',
    name: 'handbook.pdf',
    sizeBytes: 1,
    materialType: 'syllabus',
  })
  const syllabus: SyllabusData = {
    scopes: [
      {
        id: 's1',
        label: 'FINAL',
        kind: 'final',
        topics: Array.from({ length: 90 }, (_, i) => ({
          id: `x${i}`,
          text: `Exam topic ${i}`,
          order: i,
          source: 'local' as const,
        })),
      },
    ],
    extractedAt: 1,
    method: 'local',
  }
  await docs.update(doc.id, { status: 'ready', syllabus })
  await new ChunkRepository(db).addMany([
    {
      documentId: doc.id,
      projectId: project.id,
      materialType: 'syllabus',
      contentType: 'paragraph' as const,
      text: 'FINAL EXAM TOPICS\n1. Exam topic 0',
      sourceReference: 'handbook',
      order: 0,
      pageNumber: 1,
    },
  ])
  return { documentId: doc.id }
}

/** Matches every exam topic it is asked about to course topic t1, recording the topics asked. */
function matchingModel() {
  const asked: string[][] = []
  const chatJSON = vi.fn(async (messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
    const user = messages[1]!.content
    const ids = [...user.matchAll(/^(e\d+) \| (Exam topic \d+)$/gm)]
    asked.push(ids.map((match) => match[2]!))
    options?.signal?.throwIfAborted()
    return { data: { matches: ids.map((match) => ({ examTopicId: match[1], topicIds: ['t1'] })) } }
  })
  return { asked, chatJSON, ai: { chatJSON } as unknown as AIService }
}

describe('syllabus AI matching can be paused', () => {
  it('saves each finished batch and continues with only the rest', async () => {
    const { documentId } = await seedSyllabus()
    const service = new SyllabusService({ db })
    const model = matchingModel()
    const run = createGenerationRun()
    // Pause while the first batch is in flight: it finishes, no second batch starts.
    model.chatJSON.mockImplementationOnce(async (messages, options) => {
      run.requestPause()
      return matchingModel().chatJSON(messages, options)
    })
    const first = await service.matchWithAiRun(documentId, model.ai, { control: run })
    expect(first).toMatchObject({ paused: true, done: 40, total: 90, matched: 40 })
    expect(model.chatJSON).toHaveBeenCalledTimes(1)
    expect(run.finish()).toBe('paused')
    expect(pausedSyllabusMatch(documentId)).toEqual({ done: 40 })

    const saved = (await new DocumentRepository(db).get(documentId)).syllabus!.scopes[0]!.topics
    expect(saved.filter((topic) => topic.matchedBy === 'ai')).toHaveLength(40)

    // Continue: two more requests, none of them about the first 40 topics.
    const rest = await service.matchWithAiRun(documentId, model.ai, {
      control: createGenerationRun(),
      resume: true,
    })
    expect(rest).toMatchObject({ paused: false, done: 90, total: 90, matched: 90 })
    expect(model.chatJSON).toHaveBeenCalledTimes(3)
    const askedAfterResume = model.asked.flat()
    expect(askedAfterResume).toHaveLength(50)
    expect(askedAfterResume).not.toContain('Exam topic 0')
    expect(pausedSyllabusMatch(documentId)).toBeUndefined()
    const done = (await new DocumentRepository(db).get(documentId)).syllabus!.scopes[0]!.topics
    expect(done.every((topic) => topic.matchedBy === 'ai')).toBe(true)
  })

  it('stopNow aborts the batch in flight without losing saved batches or throwing', async () => {
    const { documentId } = await seedSyllabus()
    const service = new SyllabusService({ db })
    const run = createGenerationRun()
    let calls = 0
    const chatJSON = vi.fn(async (messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
      calls++
      const ids = [...messages[1]!.content.matchAll(/^(e\d+) \|/gm)].map((m) => m[1])
      const answer = { data: { matches: ids.map((id) => ({ examTopicId: id, topicIds: ['t1'] })) } }
      if (calls === 1) return answer
      const call = deferredCall(answer, options?.signal)
      setTimeout(() => run.stopNow(), 0)
      return call.promise
    })
    const result = await service.matchWithAiRun(documentId, { chatJSON } as unknown as AIService, {
      control: run,
    })
    expect(result).toMatchObject({ paused: true, done: 40, matched: 40 })
    expect(run.finish()).toBe('stopped')
    const saved = (await new DocumentRepository(db).get(documentId)).syllabus!.scopes[0]!.topics
    expect(saved.filter((topic) => topic.matchedBy === 'ai')).toHaveLength(40)
  })

  it('a stopped AI extraction saves nothing', async () => {
    const { documentId } = await seedSyllabus()
    const service = new SyllabusService({ db })
    const run = createGenerationRun()
    const chatJSON = vi.fn(async (_messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
      const call = deferredCall({ data: { scopes: [] } }, options?.signal)
      setTimeout(() => run.stopNow(), 0)
      return call.promise
    })
    await expect(
      service.extractWithAi(documentId, { chatJSON } as unknown as AIService, { control: run }),
    ).rejects.toMatchObject({ code: 'ABORTED' })
    const stored = (await new DocumentRepository(db).get(documentId)).syllabus!
    expect(stored.method).toBe('local')
    expect(stored.scopes[0]!.topics).toHaveLength(90)
  })
})

// ---- interview -------------------------------------------------------------

/** A scenario card passage of ~3,000 characters; three of them need two requests. */
function cardText(name: string): string {
  return [
    'Patient:',
    `Name, age: ${name}, 50`,
    'Complaint: cough',
    ...Array.from({ length: 6 }, (_, i) => `${i + 1}. question ${i}`),
    'x'.repeat(3_000),
  ].join('\n')
}

async function languageCourse(cards: string[]) {
  const project = await new ProjectService(db).create({ name: 'Magyar', subject: 'medicine' })
  await db.projects.update(project.id, {
    subject: 'language',
    targetLanguage: 'hu',
  } as Record<string, unknown>)
  const docs = new DocumentRepository(db)
  const doc = await docs.create({
    projectId: project.id,
    type: 'pdf',
    name: 'hu.pdf',
    sizeBytes: 1,
  })
  await docs.update(doc.id, { status: 'ready', materialType: 'textbook' } as Record<
    string,
    unknown
  >)
  const chunks = await new ChunkRepository(db).addMany(
    cards.map((text, i) => ({
      documentId: doc.id,
      projectId: project.id,
      contentType: 'paragraph' as const,
      text,
      sourceReference: `p${i + 1}`,
      order: i,
      pageNumber: i + 1,
    })),
  )
  return { project, chunks }
}

/** One valid card per request, grounded in the first passage it was given. */
function scenarioModel() {
  const chatJSON = vi.fn(async (messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
    options?.signal?.throwIfAborted()
    const chunkId = /chunkId[^\w]*([\w-]+)/.exec(messages[1]!.content)?.[1] ?? ''
    const name = /Name, age: (\w+)/.exec(messages[1]!.content)?.[1] ?? 'X'
    return {
      data: {
        scenarios: [
          {
            title: name,
            questions: [
              { id: 'a', label: 'Hogy hívják?', englishGloss: 'Name', sourceChunkId: chunkId },
            ],
            facts: [
              {
                id: 'f',
                fact: `Name, age: ${name}, 50`,
                englishGloss: `${name}, 50`,
                questionId: 'a',
                sourceChunkId: chunkId,
              },
            ],
          },
        ],
      },
    }
  })
  return { chatJSON, ai: { chatJSON } as unknown as AIService }
}

describe('interview scenario extraction can be paused', () => {
  it('keeps the requests already answered and continues with only the rest', async () => {
    const { project } = await languageCourse([
      cardText('Anna'),
      cardText('Bela'),
      cardText('Csilla'),
    ])
    const model = scenarioModel()
    const service = new InterviewService({ ai: model.ai, db })
    const run = createGenerationRun()
    const original = model.chatJSON.getMockImplementation()!
    model.chatJSON.mockImplementationOnce(async (messages, options) => {
      run.requestPause()
      return original(messages, options)
    })
    const first = await service.extractScenariosRun(project.id, { control: run })
    expect(first.paused).toBe(true)
    expect(first.total).toBe(2)
    expect(first.done).toBe(1)
    expect(model.chatJSON).toHaveBeenCalledTimes(1)
    const firstScenarios: InterviewScenario[] = first.scenarios
    expect(run.finish()).toBe('paused')

    const rest = await service.extractScenariosRun(project.id, {
      control: createGenerationRun(),
      resume: true,
    })
    expect(rest.paused).toBe(false)
    expect(rest.done).toBe(2)
    // Only the remaining request was sent.
    expect(model.chatJSON).toHaveBeenCalledTimes(2)
    expect(rest.scenarios.length).toBeGreaterThanOrEqual(firstScenarios.length)
  })

  it('a stopped request is not counted as a failure', async () => {
    const { project } = await languageCourse([
      cardText('Anna'),
      cardText('Bela'),
      cardText('Csilla'),
    ])
    const run = createGenerationRun()
    const chatJSON = vi.fn(async (_messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
      const call = deferredCall({ data: { scenarios: [] } }, options?.signal)
      setTimeout(() => run.stopNow(), 0)
      return call.promise
    })
    const service = new InterviewService({ ai: { chatJSON } as unknown as AIService, db })
    // Every request was stopped: no "all parts failed" error, just a paused run.
    const result = await service.extractScenariosRun(project.id, { control: run })
    expect(result).toMatchObject({ paused: true, scenarios: [], done: 0 })
    expect(chatJSON).toHaveBeenCalledTimes(1)
  })
})

describe('interview single requests can be stopped', () => {
  it('a stopped patient turn leaves the session unchanged', async () => {
    const { project } = await languageCourse([cardText('Anna')])
    const scenario: InterviewScenario = {
      source: 'textbook',
      title: 'Anna',
      questions: [{ id: 'q1', label: 'Hogy hívják?', englishGloss: 'Name' }],
      facts: [{ id: 'f1', fact: 'Anna vagyok.', englishGloss: 'Anna', questionId: 'q1' }],
    } as unknown as InterviewScenario
    const controller = new AbortController()
    const chatJSON = vi.fn(async (_messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
      const call = deferredCall(
        { data: { reply: 'Anna vagyok.', coveredQuestionIds: ['q1'] } },
        options?.signal,
      )
      return call.promise
    })
    const service = new InterviewService({ ai: { chatJSON } as unknown as AIService, db })
    const session = await service.start(project.id, scenario)
    const turn = service.ask(project.id, session.id, 'Hogy hívják?', { signal: controller.signal })
    await tick()
    controller.abort()
    await expect(turn).rejects.toMatchObject({ code: 'ABORTED' })
    const after = await service.get(project.id, session.id)
    expect(after.turns).toEqual([])
    expect(after.status).toBe('interviewing')
  })

  it('a stopped summary check grades nothing', async () => {
    const { project } = await languageCourse([cardText('Anna')])
    const scenario = {
      source: 'textbook',
      title: 'Anna',
      questions: [],
      facts: [{ id: 'f1', fact: 'Anna vagyok.', englishGloss: 'Anna' }],
    } as unknown as InterviewScenario
    const controller = new AbortController()
    const chatJSON = vi.fn(async (_messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
      controller.abort()
      options?.signal?.throwIfAborted()
      return { data: { facts: [] } }
    })
    const service = new InterviewService({ ai: { chatJSON } as unknown as AIService, db })
    const session = await service.start(project.id, scenario)
    await service.endInterview(session.id)
    await expect(
      service.grade(project.id, session.id, 'Her name is Anna.', { signal: controller.signal }),
    ).rejects.toBeTruthy()
    const after = await service.get(project.id, session.id)
    expect(after.status).toBe('summarizing')
    expect(after.results).toBeUndefined()
    // The student's draft is kept.
    expect(after.summary).toBe('Her name is Anna.')
  })
})
