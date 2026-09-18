import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { MistakeRepository } from '@/entities/mistake/repository'
import { KnowledgeMasteryRepository } from '@/entities/knowledgeMastery/repository'
import type { Mistake } from '@/entities/mistake/types'

export interface WeaknessArea {
  knowledgePoint: string
  /** All mistakes recorded for this point. */
  mistakeCount: number
  /** Mistakes still in the active state. */
  activeMistakeCount: number
  /** Mistakes in the last 30 days. */
  recentMistakeCount: number
  /** Mastery estimate, when the student has practised this point. */
  mastery: number | null
  /** Higher = weaker. Used for ranking. */
  weaknessScore: number
  /** Neutral, non-judgemental description for the UI. */
  reason: string
}

export interface WeaknessReport {
  areas: WeaknessArea[]
  totalMistakes: number
  generatedAt: number
}

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Detects knowledge points that may benefit from review.
 *
 * The score blends mistake frequency (weighted toward recent and still-active
 * mistakes) with the mastery estimate. Language is deliberately neutral:
 * "Areas that may need review", never "You are bad at…".
 */
export class WeaknessService {
  private mistakes: MistakeRepository
  private mastery: KnowledgeMasteryRepository

  constructor(db?: AppDatabase) {
    const resolved = db ?? getDb()
    this.mistakes = new MistakeRepository(resolved)
    this.mastery = new KnowledgeMasteryRepository(resolved)
  }

  async analyze(projectId: string, opts: { limit?: number } = {}): Promise<WeaknessReport> {
    const [mistakes, masteryRows] = await Promise.all([
      this.mistakes.listByProject(projectId, { status: 'all' }),
      this.mastery.listByProject(projectId),
    ])
    return {
      areas: buildWeaknessAreas(mistakes, masteryRows, opts.limit),
      totalMistakes: mistakes.length,
      generatedAt: Date.now(),
    }
  }

  /** Knowledge point names ordered weakest-first. */
  async weakKnowledgePoints(projectId: string, limit = 5): Promise<string[]> {
    const report = await this.analyze(projectId, { limit })
    return report.areas.map((a) => a.knowledgePoint)
  }
}

export function buildWeaknessAreas(
  mistakes: Mistake[],
  masteryRows: Array<{ knowledgePoint: string; mastery: number; attempts: number }>,
  limit = 10,
): WeaknessArea[] {
  const now = Date.now()
  const byKp = new Map<string, Mistake[]>()
  for (const m of mistakes) {
    const list = byKp.get(m.knowledgePoint) ?? []
    list.push(m)
    byKp.set(m.knowledgePoint, list)
  }
  const masteryByKp = new Map(masteryRows.map((r) => [r.knowledgePoint, r]))
  const maxMistakes = Math.max(1, ...[...byKp.values()].map((list) => list.length))

  const areas: WeaknessArea[] = []
  for (const [knowledgePoint, list] of byKp) {
    const activeMistakeCount = list.filter((m) => m.status === 'active').length
    const recentMistakeCount = list.filter((m) => now - m.createdAt <= RECENT_WINDOW_MS).length
    const masteryRow = masteryByKp.get(knowledgePoint)
    const mastery = masteryRow ? masteryRow.mastery : null

    const mistakeWeight = list.length / maxMistakes
    const activeWeight = activeMistakeCount / Math.max(1, list.length)
    const recencyWeight = recentMistakeCount / Math.max(1, list.length)
    const masteryGap = mastery === null ? 0.5 : 1 - mastery

    const weaknessScore = clamp01(
      0.45 * mistakeWeight + 0.2 * activeWeight + 0.15 * recencyWeight + 0.2 * masteryGap,
    )

    const reasonParts: string[] = []
    reasonParts.push(`${list.length} recorded mistake${list.length === 1 ? '' : 's'}`)
    if (recentMistakeCount > 0) reasonParts.push(`${recentMistakeCount} in the last 30 days`)
    if (mastery !== null) reasonParts.push(`mastery estimate ${Math.round(mastery * 100)}%`)

    areas.push({
      knowledgePoint,
      mistakeCount: list.length,
      activeMistakeCount,
      recentMistakeCount,
      mastery,
      weaknessScore,
      reason: reasonParts.join(' · '),
    })
  }

  return areas
    .sort((a, b) => b.weaknessScore - a.weaknessScore || b.mistakeCount - a.mistakeCount)
    .slice(0, limit)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}