import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { WeaknessService, buildWeaknessAreas } from '@/services/weaknessService'
import { MistakeService } from '@/services/mistakeService'
import { MasteryService } from '@/services/masteryService'
import { ProjectService } from '@/services/projectService'
import type { Mistake } from '@/entities/mistake/types'

function mistake(knowledgePoint: string, opts: { status?: Mistake['status']; createdAt?: number } = {}): Mistake {
  const now = opts.createdAt ?? Date.now()
  return {
    id: crypto.randomUUID(),
    projectId: 'p1',
    knowledgePoint,
    difficulty: 'basic',
    questionType: 'numeric',
    question: 'Q',
    studentAnswer: 'a',
    correctAnswer: 'b',
    mistakeType: 'unknown',
    analysisStatus: 'pending',
    status: opts.status ?? 'active',
    source: 'auto',
    attemptIds: [],
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  }
}

describe('buildWeaknessAreas', () => {
  it('returns an empty list with no mistakes', () => {
    expect(buildWeaknessAreas([], [])).toEqual([])
  })

  it('ranks knowledge points by mistake count', () => {
    const areas = buildWeaknessAreas(
      [mistake('Chain Rule'), mistake('Chain Rule'), mistake('Chain Rule'), mistake('Integration'), mistake('Integration'), mistake('Limits')],
      [],
    )
    expect(areas[0]!.knowledgePoint).toBe('Chain Rule')
    expect(areas[0]!.mistakeCount).toBe(3)
    expect(areas[1]!.knowledgePoint).toBe('Integration')
    expect(areas[2]!.knowledgePoint).toBe('Limits')
  })

  it('weights active mistakes more than understood ones', () => {
    const areas = buildWeaknessAreas(
      [mistake('A', { status: 'active' }), mistake('A', { status: 'active' }), mistake('B', { status: 'understood' }), mistake('B', { status: 'understood' })],
      [],
    )
    const a = areas.find((x) => x.knowledgePoint === 'A')!
    const b = areas.find((x) => x.knowledgePoint === 'B')!
    expect(a.activeMistakeCount).toBe(2)
    expect(b.activeMistakeCount).toBe(0)
    expect(a.weaknessScore).toBeGreaterThan(b.weaknessScore)
  })

  it('weights recent mistakes more than old ones', () => {
    const now = Date.now()
    const old = now - 90 * 24 * 60 * 60 * 1000
    const areas = buildWeaknessAreas(
      [mistake('Recent', { createdAt: now }), mistake('Old', { createdAt: old })],
      [],
    )
    const recent = areas.find((x) => x.knowledgePoint === 'Recent')!
    const stale = areas.find((x) => x.knowledgePoint === 'Old')!
    expect(recent.recentMistakeCount).toBe(1)
    expect(stale.recentMistakeCount).toBe(0)
    expect(recent.weaknessScore).toBeGreaterThan(stale.weaknessScore)
  })

  it('incorporates mastery estimates', () => {
    const areas = buildWeaknessAreas(
      [mistake('LowMastery'), mistake('HighMastery')],
      [
        { knowledgePoint: 'LowMastery', mastery: 0.2, attempts: 5 },
        { knowledgePoint: 'HighMastery', mastery: 0.95, attempts: 5 },
      ],
    )
    const low = areas.find((x) => x.knowledgePoint === 'LowMastery')!
    const high = areas.find((x) => x.knowledgePoint === 'HighMastery')!
    expect(low.mastery).toBe(0.2)
    expect(low.weaknessScore).toBeGreaterThan(high.weaknessScore)
  })

  it('describes each area neutrally', () => {
    const areas = buildWeaknessAreas([mistake('Chain Rule'), mistake('Chain Rule')], [{ knowledgePoint: 'Chain Rule', mastery: 0.4, attempts: 3 }])
    expect(areas[0]!.reason).toContain('2 recorded mistakes')
    expect(areas[0]!.reason).toContain('mastery estimate 40%')
    expect(areas[0]!.reason.toLowerCase()).not.toContain('bad')
    expect(areas[0]!.reason.toLowerCase()).not.toContain('weak at')
  })

  it('respects the limit', () => {
    const areas = buildWeaknessAreas(
      Array.from({ length: 10 }, (_, i) => mistake(`KP${i}`)),
      [],
      3,
    )
    expect(areas).toHaveLength(3)
  })
})

describe('WeaknessService', () => {
  let db: AppDatabase
  let projects: ProjectService
  let mistakes: MistakeService
  let mastery: MasteryService
  let service: WeaknessService

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
    mistakes = new MistakeService(db)
    mastery = new MasteryService(db)
    service = new WeaknessService(db)
  })

  it('analyses a project end to end', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    await mistakes.addManual({ projectId: p.id, question: 'Q1', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await mistakes.addManual({ projectId: p.id, question: 'Q2', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await mistakes.addManual({ projectId: p.id, question: 'Q3', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Limits' })
    await mastery.record({
      id: 'x',
      projectId: p.id,
      questionId: 'q',
      knowledgePoint: 'Chain Rule',
      questionType: 'numeric',
      difficulty: 'basic',
      userAnswer: 'a',
      evaluation: { isCorrect: false, method: 'exact', confidence: 1 },
      hintsUsed: 0,
      createdAt: Date.now(),
    })

    const report = await service.analyze(p.id)
    expect(report.totalMistakes).toBe(3)
    expect(report.areas[0]!.knowledgePoint).toBe('Chain Rule')
    expect(report.areas[0]!.mastery).not.toBeNull()
  })

  it('returns weak knowledge points weakest-first', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    await mistakes.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Chain Rule' })
    await mistakes.addManual({ projectId: p.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'Limits' })
    const weak = await service.weakKnowledgePoints(p.id)
    expect(weak).toContain('Chain Rule')
    expect(weak).toContain('Limits')
  })

  it('returns an empty report for a project with no mistakes', async () => {
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const report = await service.analyze(p.id)
    expect(report.areas).toEqual([])
    expect(report.totalMistakes).toBe(0)
  })

  it('isolates weakness data between projects', async () => {
    const p1 = await projects.create({ name: 'P1', subject: 'calculus' })
    const p2 = await projects.create({ name: 'P2', subject: 'physics' })
    await mistakes.addManual({ projectId: p1.id, question: 'Q', studentAnswer: 'a', correctAnswer: 'b', knowledgePoint: 'KP' })
    expect((await service.analyze(p1.id)).totalMistakes).toBe(1)
    expect((await service.analyze(p2.id)).totalMistakes).toBe(0)
  })
})