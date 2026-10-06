import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ReviewCardService } from '@/services/reviewCardService'
import { MasteryService } from '@/services/masteryService'
import { DAY_MS, INITIAL_EASE, newCard, previewIntervals, scheduleReview, type ReviewCard } from '@/entities/reviewCard/types'
import type { Concept } from '@/entities/courseAnalysis/types'

const NOW = Date.UTC(2026, 9, 1)

function card(overrides: Partial<ReviewCard> = {}): ReviewCard {
  return { ...newCard({ projectId: 'p1', front: '三角肌 — 神经支配', back: '腋神经', source: 'manual', now: NOW }), ...overrides }
}

describe('spaced-repetition schedule', () => {
  it('graduates a new card through 1 and 3 days, then by its ease', () => {
    let c = card()
    c = scheduleReview(c, 'good', NOW)
    expect(c).toMatchObject({ interval: 1, reps: 1, due: NOW + DAY_MS })
    c = scheduleReview(c, 'good', NOW)
    expect(c).toMatchObject({ interval: 3, reps: 2 })
    c = scheduleReview(c, 'good', NOW)
    expect(c.interval).toBe(Math.round(3 * INITIAL_EASE))
  })

  it('relearns a forgotten card in ten minutes and lowers its ease', () => {
    const learned = card({ interval: 10, reps: 3 })
    const lapsed = scheduleReview(learned, 'again', NOW)
    expect(lapsed).toMatchObject({ interval: 0, reps: 0, lapses: 1, due: NOW + 10 * 60 * 1000 })
    expect(lapsed.ease).toBeCloseTo(INITIAL_EASE - 0.2)
    // A card that was never learned does not count as a lapse.
    expect(scheduleReview(card(), 'again', NOW).lapses).toBe(0)
  })

  it('never lets the ease fall below 1.3', () => {
    let c = card({ ease: 1.35, interval: 5, reps: 2 })
    for (let i = 0; i < 5; i++) c = scheduleReview(c, 'hard', NOW)
    expect(c.ease).toBeCloseTo(1.3)
  })

  it('orders the grade previews from sooner to later', () => {
    const p = previewIntervals(card({ interval: 4, reps: 2 }), NOW)
    expect(p.again).toBeLessThan(p.hard)
    expect(p.hard).toBeLessThan(p.good)
    expect(p.good).toBeLessThan(p.easy)
  })
})

describe('ReviewCardService', () => {
  let db: AppDatabase
  let service: ReviewCardService

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    service = new ReviewCardService(db)
  })

  it('adds cards by hand and refuses duplicates or empty sides', async () => {
    await service.addManual('p1', '三角肌 — 神经支配', '腋神经')
    await expect(service.addManual('p1', '  三角肌 —  神经支配 ', '腋神经')).rejects.toThrow()
    await expect(service.addManual('p1', '肱二头肌', '  ')).rejects.toThrow()
    expect(await service.list('p1')).toHaveLength(1)
    // Another course is separate.
    await service.addManual('p2', '三角肌 — 神经支配', '腋神经')
    expect(await service.list('p2')).toHaveLength(1)
  })

  it('generates one card per defined concept, once', async () => {
    const concept = (name: string, definition: string): Concept => ({
      id: crypto.randomUUID(),
      projectId: 'p1',
      name,
      definition,
      topicIds: ['t1'],
      sourceRefs: [],
      createdAt: NOW,
    })
    await db.table('concepts').bulkAdd([concept('阈电位', '能触发动作电位的临界膜电位'), concept('空概念', ' ')])
    expect(await service.generateFromConcepts('p1')).toBe(1)
    expect(await service.generateFromConcepts('p1')).toBe(0)
    const [only] = await service.list('p1')
    expect(only).toMatchObject({ front: '阈电位', source: 'concept', knowledgePoint: '阈电位', topicId: 't1' })
  })

  it('turns a relation table into row — column cards', async () => {
    const added = await service.addFromTable('p1', {
      columns: ['神经支配', '作用'],
      rows: [{ name: '三角肌', cells: ['腋神经', '肩关节外展'] }, { name: '肱二头肌', cells: ['肌皮神经', ''] }],
      topicId: 't1',
    })
    // The empty cell is skipped.
    expect(added).toBe(3)
    const fronts = (await service.list('p1')).map((c) => c.front).sort()
    expect(fronts).toEqual(['三角肌 — 作用', '三角肌 — 神经支配', '肱二头肌 — 神经支配'].sort())
  })

  it('lists due cards and counts the stats', async () => {
    await service.addManual('p1', 'A', '1')
    const b = await service.addManual('p1', 'B', '2')
    await service.review(b.id, 'good', Date.now())
    const due = await service.due('p1')
    expect(due.map((c) => c.front)).toEqual(['A'])
    expect(await service.stats('p1')).toMatchObject({ total: 2, due: 1, fresh: 1, mature: 0 })
  })

  it('feeds concept reviews into mastery at half weight', async () => {
    await service.addMany('p1', [{ front: '阈电位', back: '临界膜电位', source: 'concept', knowledgePoint: '阈电位' }])
    const [c] = await service.list('p1')
    await service.review(c!.id, 'good')
    const mastery = await new MasteryService(db).listByProject('p1')
    expect(mastery).toHaveLength(1)
    expect(mastery[0]!.knowledgePoint).toBe('阈电位')
    // A manual card without a concept leaves mastery alone.
    const manual = await service.addManual('p1', '手写', '内容')
    await service.review(manual.id, 'again')
    expect(await new MasteryService(db).listByProject('p1')).toHaveLength(1)
  })

  it('edits and deletes cards', async () => {
    const c = await service.addManual('p1', 'A', '1')
    const edited = await service.update(c.id, 'A2', '2')
    expect(edited).toMatchObject({ front: 'A2', back: '2' })
    await service.remove(c.id)
    expect(await service.list('p1')).toHaveLength(0)
    await expect(service.review(c.id, 'good')).rejects.toThrow()
  })
})

describe('first review of a new card', () => {
  it('keeps a hard first recall in learning, so every grade schedules differently', () => {
    const hard = scheduleReview(card(), 'hard', NOW)
    expect(hard).toMatchObject({ interval: 0, reps: 0, due: NOW + 6 * 60 * 60 * 1000 })
    const p = previewIntervals(card(), NOW)
    expect(new Set(Object.values(p)).size).toBe(4)
  })
})
