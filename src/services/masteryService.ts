import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { KnowledgeMasteryRepository } from '@/entities/knowledgeMastery/repository'
import type { KnowledgeMastery, MasteryObservation } from '@/entities/knowledgeMastery/types'
import { masteryId } from '@/entities/knowledgeMastery/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import { computeMastery } from './adaptiveDifficulty'
import { logger } from '@/infrastructure/logger/logger'

const MAX_OBSERVATIONS = 40

/**
 * Maintains the per-knowledge-point mastery estimate.
 *
 * Mastery is deliberately described as an *estimate* in the UI: it is
 * derived from weighted practice history, not a measurement of true ability.
 */
export class MasteryService {
  private repo: KnowledgeMasteryRepository

  constructor(db?: AppDatabase) {
    this.repo = new KnowledgeMasteryRepository(db ?? getDb())
  }

  listByProject(projectId: string): Promise<KnowledgeMastery[]> {
    return this.repo.listByProject(projectId)
  }

  get(projectId: string, knowledgePoint: string): Promise<KnowledgeMastery | undefined> {
    return this.repo.get(projectId, knowledgePoint)
  }

  /** Record an attempt and update the estimate. Returns the new row. */
  async record(attempt: QuestionAttempt): Promise<KnowledgeMastery> {
    const existing = await this.repo.get(attempt.projectId, attempt.knowledgePoint)
    const observation: MasteryObservation = {
      at: attempt.createdAt,
      isCorrect: attempt.evaluation.isCorrect,
      difficulty: attempt.difficulty as MasteryObservation['difficulty'],
      questionType: attempt.questionType,
    }
    const observations = [...(existing?.observations ?? []), observation].slice(-MAX_OBSERVATIONS)
    const mastery = computeMastery(observations)
    const graded = observations.filter((o) => o.isCorrect !== null)
    const correct = graded.filter((o) => o.isCorrect).length

    const row: KnowledgeMastery = {
      id: masteryId(attempt.projectId, attempt.knowledgePoint),
      projectId: attempt.projectId,
      knowledgePoint: attempt.knowledgePoint,
      ...(attempt.topicId ? { topicId: attempt.topicId } : {}),
      mastery,
      attempts: graded.length,
      correct,
      observations,
      lastUpdated: Date.now(),
    }
    await this.repo.upsert(row)
    logger.debug('Mastery updated', { kp: attempt.knowledgePoint, mastery: mastery.toFixed(3) })
    return row
  }

  /** Rebuild all mastery rows for a project from its attempt history. */
  async rebuild(projectId: string, attempts: QuestionAttempt[]): Promise<KnowledgeMastery[]> {
    const byKp = new Map<string, QuestionAttempt[]>()
    for (const a of attempts) {
      const list = byKp.get(a.knowledgePoint) ?? []
      list.push(a)
      byKp.set(a.knowledgePoint, list)
    }
    const rows: KnowledgeMastery[] = []
    for (const [kp, list] of byKp) {
      const sorted = list.slice().sort((a, b) => a.createdAt - b.createdAt)
      const observations: MasteryObservation[] = sorted
        .map((a) => ({
          at: a.createdAt,
          isCorrect: a.evaluation.isCorrect,
          difficulty: a.difficulty as MasteryObservation['difficulty'],
          questionType: a.questionType,
        }))
        .slice(-MAX_OBSERVATIONS)
      const graded = observations.filter((o) => o.isCorrect !== null)
      rows.push({
        id: masteryId(projectId, kp),
        projectId,
        knowledgePoint: kp,
        ...(sorted[sorted.length - 1]?.topicId ? { topicId: sorted[sorted.length - 1]!.topicId } : {}),
        mastery: computeMastery(observations),
        attempts: graded.length,
        correct: graded.filter((o) => o.isCorrect).length,
        observations,
        lastUpdated: Date.now(),
      })
    }
    await this.repo.upsertMany(rows)
    return rows
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.repo.deleteByProject(projectId)
  }

  /** Knowledge points whose estimate is below the threshold. */
  async weakKnowledgePoints(projectId: string, threshold = 0.6, limit = 5): Promise<KnowledgeMastery[]> {
    const rows = await this.repo.listByProject(projectId)
    return rows
      .filter((r) => r.attempts > 0 && r.mastery < threshold)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, limit)
  }
}