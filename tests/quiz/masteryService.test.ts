import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { MasteryService } from '@/services/masteryService'
import { KnowledgeMasteryRepository } from '@/entities/knowledgeMastery/repository'
import { ProjectService } from '@/services/projectService'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'

function attempt(
  projectId: string,
  knowledgePoint: string,
  isCorrect: boolean | null,
  opts: { difficulty?: string; createdAt?: number } = {},
): QuestionAttempt {
  return {
    id: crypto.randomUUID(),
    projectId,
    questionId: 'q',
    knowledgePoint,
    questionType: 'short_answer',
    difficulty: opts.difficulty ?? 'basic',
    userAnswer: 'x',
    evaluation: { isCorrect, method: isCorrect === null ? 'unverified' : 'exact', confidence: 1 },
    hintsUsed: 0,
    createdAt: opts.createdAt ?? Date.now(),
  }
}

describe('MasteryService', () => {
  let db: AppDatabase
  let projects: ProjectService

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
  })

  it('creates a mastery row on first record', async () => {
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new MasteryService(db)
    const row = await svc.record(attempt(p.id, 'Derivative', true))
    expect(row.knowledgePoint).toBe('Derivative')
    expect(row.attempts).toBe(1)
    expect(row.correct).toBe(1)
    expect(row.mastery).toBeGreaterThan(0.5)
  })

  it('increases mastery with correct answers', async () => {
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new MasteryService(db)
    const first = await svc.record(attempt(p.id, 'KP', false))
    const second = await svc.record(attempt(p.id, 'KP', true, { createdAt: first.lastUpdated + 1 }))
    const third = await svc.record(attempt(p.id, 'KP', true, { createdAt: second.lastUpdated + 1 }))
    expect(third.mastery).toBeGreaterThan(first.mastery)
  })

  it('excludes unverified attempts from counters', async () => {
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new MasteryService(db)
    await svc.record(attempt(p.id, 'KP', true))
    const row = await svc.record(attempt(p.id, 'KP', null))
    expect(row.attempts).toBe(1)
    expect(row.correct).toBe(1)
  })

  it('keeps separate rows per knowledge point', async () => {
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new MasteryService(db)
    await svc.record(attempt(p.id, 'Derivative', true))
    await svc.record(attempt(p.id, 'Chain Rule', false))
    const rows = await svc.listByProject(p.id)
    expect(rows).toHaveLength(2)
  })

  it('isolates mastery between projects', async () => {
    const p1 = await projects.create({ name: 'P1', subject: 'cs' })
    const p2 = await projects.create({ name: 'P2', subject: 'cs' })
    const svc = new MasteryService(db)
    await svc.record(attempt(p1.id, 'KP', true))
    expect(await svc.listByProject(p1.id)).toHaveLength(1)
    expect(await svc.listByProject(p2.id)).toHaveLength(0)
  })

  it('lists weak knowledge points below the threshold', async () => {
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new MasteryService(db)
    await svc.record(attempt(p.id, 'Strong', true))
    await svc.record(attempt(p.id, 'Strong', true))
    await svc.record(attempt(p.id, 'Weak', false))
    await svc.record(attempt(p.id, 'Weak', false))
    const weak = await svc.weakKnowledgePoints(p.id, 0.6)
    expect(weak.map((w) => w.knowledgePoint)).toEqual(['Weak'])
  })

  it('rebuilds mastery from attempt history', async () => {
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new MasteryService(db)
    const rows = await svc.rebuild(p.id, [
      attempt(p.id, 'A', true, { createdAt: 1 }),
      attempt(p.id, 'A', true, { createdAt: 2 }),
      attempt(p.id, 'B', false, { createdAt: 3 }),
    ])
    expect(rows).toHaveLength(2)
    const a = rows.find((r) => r.knowledgePoint === 'A')!
    const b = rows.find((r) => r.knowledgePoint === 'B')!
    expect(a.mastery).toBeGreaterThan(b.mastery)
    expect(a.attempts).toBe(2)
  })

  it('persists mastery rows to the repository', async () => {
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new MasteryService(db)
    await svc.record(attempt(p.id, 'KP', true))
    const repo = new KnowledgeMasteryRepository(db)
    const stored = await repo.get(p.id, 'KP')
    expect(stored).toBeDefined()
    expect(stored!.correct).toBe(1)
  })

  it('looks up knowledge points case-insensitively', async () => {
    const p = await projects.create({ name: 'P', subject: 'cs' })
    const svc = new MasteryService(db)
    await svc.record(attempt(p.id, 'Derivative', true))
    const found = await svc.get(p.id, 'derivative')
    expect(found).toBeDefined()
  })
})