import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { HomeworkWalkthroughService } from '@/services/homeworkWalkthroughService'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { AIService } from '@/services/aiService'
import type { HomeworkQuestion } from '@/entities/homework/types'

function classify(system: string, user: string): { kind: string; id: string } {
  if (system.includes('opening and the closing')) return { kind: 'frame', id: 'frame' }
  if (system.includes('ONE sub-part')) {
    const match = user.match(/question (\S+), sub-part \((\w)\) only/)!
    return { kind: 'part', id: `${match[1]}${match[2]}` }
  }
  return { kind: 'question', id: user.match(/question (\S+)\./)?.[1] ?? '?' }
}

function stubAI(): AIService {
  const streamJSON = vi.fn(async (messages: Array<{ content: string }>) => {
    const call = classify(messages[0]!.content, messages[1]!.content)
    const data =
      call.kind === 'frame'
        ? { status: 'ready', overview: 'Tools.', summary: 'Summary.', suggestions: [] }
        : call.kind === 'part'
          ? {
              status: 'ready',
              heading: `Part ${call.id}`,
              conclusion: `(${call.id.slice(-1)}) result`,
              body: `Work ${call.id}.`,
              analysis: 'Analysis.',
            }
          : { status: 'ready', conclusion: `Done ${call.id}.`, body: `Worked ${call.id}.` }
    return { data, raw: {} }
  })
  return {
    streamJSON,
    chatJSON: streamJSON,
    maxOutputTokens: 8192,
    concurrency: 4,
  } as unknown as AIService
}

let db: AppDatabase

afterEach(() => {
  db?.close()
  setDbForTesting(null)
})

describe('完整讲解: saved sections survive a reload', () => {
  it('reads every written section (incl. a split question) from a freshly opened database', async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projectId = (
      await new ProjectService(db).create({ name: 'LA', subject: 'linear_algebra' })
    ).id
    const doc = await new DocumentRepository(db).create({
      projectId,
      type: 'text',
      materialType: 'homework',
      name: 'hw.pdf',
      sizeBytes: 0,
    })
    const repo = new HomeworkRepository(db)
    const setId = crypto.randomUUID()
    await repo.upsertSet({
      id: setId,
      projectId,
      documentId: doc.id,
      documentName: 'hw.pdf',
      title: 'HW',
      status: 'ready',
      language: 'en',
      questionCount: 2,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    })
    const prompts = ['Differentiate x^2.', '(a) Solve x+1=2. (b) Solve x+2=3. (c) Solve x+3=4.']
    for (const [index, prompt] of prompts.entries()) {
      const question: HomeworkQuestion = {
        id: `q${index + 1}`,
        projectId,
        setId,
        documentId: doc.id,
        documentName: 'hw.pdf',
        order: index,
        number: String(index + 1),
        prompt,
        sourceRefs: [],
        hints: [],
        generationStatus: 'ready',
        promptVersion: 'v1',
        draftText: '',
        revealedHints: 0,
        solutionRevealed: false,
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }
      await repo.upsertQuestion(question)
    }

    const ai = stubAI()
    const writer = new HomeworkWalkthroughService({
      ai,
      db,
      homework: new HomeworkService({ ai, db }),
    })
    expect(await writer.generate(setId)).toEqual({ generated: 4, failed: 0 })

    // "Refresh": close the database and open it again with new services.
    db.close()
    db = new AppDatabase()
    setDbForTesting(db)
    const state = await new HomeworkWalkthroughService({ ai: null, db }).state(setId)
    expect(state.plan.map((entry) => [entry.id, entry.section?.status, entry.needsWork])).toEqual([
      ['overview', 'ready', false],
      ['q:q1', 'ready', false],
      ['q:q2', 'ready', false],
      ['summary', 'ready', false],
    ])
    const split = state.plan.find((entry) => entry.id === 'q:q2')!.section!
    expect(split.parts?.map((part) => part.label)).toEqual(['a', 'b', 'c'])
    expect(split.parts?.map((part) => part.body)).toEqual(['Work 2a.', 'Work 2b.', 'Work 2c.'])
  })
})
