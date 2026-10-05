import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { HomeOverviewService, isQuestionWorked } from '@/services/homeOverviewService'
import type { Project } from '@/entities/project/types'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'

function project(id: string, updatedAt = 1): Project {
  return { id, name: `Course ${id}`, subject: 'calculus', description: '', createdAt: 1, updatedAt }
}

function homeworkSet(id: string, projectId: string, updatedAt: number): HomeworkSet {
  return {
    id,
    projectId,
    documentId: `doc-${id}`,
    documentName: 'hw.pdf',
    title: `Sheet ${id}`,
    status: 'ready',
    language: 'en',
    questionCount: 0,
    promptVersion: 'v1',
    createdAt: updatedAt,
    updatedAt,
  }
}

function question(
  setId: string,
  projectId: string,
  order: number,
  patch: Partial<HomeworkQuestion> = {},
): HomeworkQuestion {
  return {
    id: crypto.randomUUID(),
    projectId,
    setId,
    documentId: `doc-${setId}`,
    documentName: 'hw.pdf',
    order,
    prompt: 'Solve it.',
    sourceRefs: [],
    hints: ['h'],
    solution: 's',
    generationStatus: 'ready',
    promptVersion: 'v1',
    draftText: '',
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

describe('HomeOverviewService', () => {
  let db: AppDatabase
  let service: HomeOverviewService

  beforeEach(async () => {
    db = new AppDatabase()
    await db.delete()
    db = new AppDatabase()
    setDbForTesting(db)
    service = new HomeOverviewService(db)
  })

  async function addMaterial(projectId: string, status: 'ready' | 'processing' = 'ready') {
    const documents = new DocumentRepository(db)
    const doc = await documents.create({ projectId, type: 'text', name: 'book.txt', sizeBytes: 0 })
    await documents.update(doc.id, { status })
  }

  async function markAnalysed(projectId: string) {
    await db.table('courseAnalyses').put({
      id: `a-${projectId}`,
      projectId,
      status: 'ready',
      language: 'en',
      progress: 1,
      documentIds: [],
      topicCount: 0,
      formulaCount: 0,
      symbolCount: 0,
      startedAt: 1,
      promptVersion: 'v1',
    })
  }

  it('asks an empty course for material first, with nothing to resume', async () => {
    const overview = await service.load([project('p1')])
    expect(overview.resume).toBeNull()
    expect(overview.courses[0]!.nextStep).toEqual({ kind: 'upload' })
    expect(overview.courses[0]!.materials.total).toBe(0)
  })

  it('suggests analysis once material is ready, and waits while it is processing', async () => {
    await addMaterial('p1', 'processing')
    let overview = await service.load([project('p1')])
    expect(overview.courses[0]!.nextStep).toEqual({ kind: 'processing' })

    await addMaterial('p2')
    overview = await service.load([project('p2')])
    expect(overview.courses[0]!.nextStep).toEqual({ kind: 'analyze' })
  })

  it('counts homework progress and resumes the unfinished assignment', async () => {
    await addMaterial('p1')
    await markAnalysed('p1')
    const homework = new HomeworkRepository(db)
    await homework.upsertSet(homeworkSet('s1', 'p1', 10))
    await homework.addQuestions([
      question('s1', 'p1', 0, { draftText: 'my attempt', updatedAt: 50 }),
      question('s1', 'p1', 1),
      question('s1', 'p1', 2),
      // Retired questions are not part of the assignment any more.
      question('s1', 'p1', 3, { retired: true }),
    ])

    const overview = await service.load([project('p1')])
    const course = overview.courses[0]!
    expect(course.homework).toEqual({ questions: 3, worked: 1 })
    expect(course.nextStep).toEqual({ kind: 'homework', setId: 's1', title: 'Sheet s1', remaining: 2 })
    expect(overview.resume).toMatchObject({ kind: 'homework', setId: 's1', remaining: 2, at: 50 })
  })

  it('points at active mistakes when there is no open homework', async () => {
    await addMaterial('p1')
    await markAnalysed('p1')
    await db.table('mistakes').bulkPut([
      { id: 'm1', projectId: 'p1', status: 'active', mistakeType: 'sign', knowledgePoint: 'limits' },
      { id: 'm2', projectId: 'p1', status: 'understood', mistakeType: 'sign', knowledgePoint: 'limits' },
    ])
    const overview = await service.load([project('p1')])
    expect(overview.courses[0]!.nextStep).toEqual({ kind: 'mistakes', count: 1 })
    expect(overview.courses[0]!.activeMistakes).toBe(1)
  })

  it('resumes the newest tutor session across courses and orders courses by activity', async () => {
    for (const id of ['p1', 'p2']) {
      await addMaterial(id)
      await markAnalysed(id)
    }
    await db.table('tutorSessions').bulkPut([
      { id: 't1', projectId: 'p1', topicId: 'topic-a', topicName: 'Limits', status: 'active', updatedAt: 100 },
      { id: 't2', projectId: 'p2', topicId: 'topic-b', topicName: 'Vectors', status: 'active', updatedAt: 300 },
    ])
    const overview = await service.load([project('p1', 5), project('p2', 5)])
    expect(overview.resume).toMatchObject({ kind: 'tutor', projectId: 'p2', topicName: 'Vectors' })
    expect(overview.courses.map((c) => c.project.id)).toEqual(['p2', 'p1'])
    expect(overview.courses[1]!.nextStep).toEqual({
      kind: 'tutor',
      topicId: 'topic-a',
      topicName: 'Limits',
    })
  })

  it('lists only practised, low-mastery knowledge points, weakest first', async () => {
    await db.table('knowledgeMastery').bulkPut([
      { id: 'k1', projectId: 'p1', knowledgePoint: 'chain rule', mastery: 0.5, attempts: 3, correct: 1, observations: [], lastUpdated: 1 },
      { id: 'k2', projectId: 'p1', knowledgePoint: 'limits', mastery: 0.2, attempts: 4, correct: 1, observations: [], lastUpdated: 1 },
      // One attempt is not enough evidence.
      { id: 'k3', projectId: 'p1', knowledgePoint: 'series', mastery: 0.1, attempts: 1, correct: 0, observations: [], lastUpdated: 1 },
      { id: 'k4', projectId: 'p1', knowledgePoint: 'derivatives', mastery: 0.9, attempts: 5, correct: 5, observations: [], lastUpdated: 1 },
    ])
    const overview = await service.load([project('p1')])
    expect(overview.courses[0]!.weakPoints.map((w) => w.knowledgePoint)).toEqual([
      'limits',
      'chain rule',
    ])
  })
})

describe('isQuestionWorked', () => {
  it('treats any student action as work', () => {
    expect(isQuestionWorked(question('s', 'p', 0))).toBe(false)
    expect(isQuestionWorked(question('s', 'p', 0, { draftText: '  ' }))).toBe(false)
    expect(isQuestionWorked(question('s', 'p', 0, { revealedHints: 1 }))).toBe(true)
    expect(isQuestionWorked(question('s', 'p', 0, { solutionRevealed: true }))).toBe(true)
  })
})
