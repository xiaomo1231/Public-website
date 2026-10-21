import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { KnowledgeMasteryRepository } from '@/entities/knowledgeMastery/repository'
import type { KnowledgeMastery, MasteryObservation } from '@/entities/knowledgeMastery/types'
import { masteryId } from '@/entities/knowledgeMastery/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import { computeMastery } from './adaptiveDifficulty'
import { logger } from '@/infrastructure/logger/logger'

const MAX_OBSERVATIONS = 40
/** `questionType` of a review-card observation (see ReviewCardService.review). */
export const FLASHCARD_TYPE = 'flashcard'

/**
 * Maintains the per-knowledge-point mastery estimate.
 *
 * Mastery is deliberately described as an *estimate* in the UI: it is
 * derived from weighted practice history, not a measurement of true ability.
 */
export class MasteryService {
  private repo: KnowledgeMasteryRepository
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
    this.repo = new KnowledgeMasteryRepository(this.db)
  }

  listByProject(projectId: string): Promise<KnowledgeMastery[]> {
    return this.repo.listByProject(projectId)
  }

  get(projectId: string, knowledgePoint: string): Promise<KnowledgeMastery | undefined> {
    return this.repo.get(projectId, knowledgePoint)
  }

  /** Record an attempt and update the estimate. Returns the new row. */
  async record(attempt: QuestionAttempt): Promise<KnowledgeMastery> {
    return this.recordObservation(
      attempt.projectId,
      attempt.knowledgePoint,
      attempt.topicId,
      observationFromAttempt(attempt),
    )
  }

  /**
   * Add one observation (a quiz attempt, or a flashcard review) to a
   * knowledge point and recompute its estimate. The read-modify-write runs in
   * one transaction so two answers recorded at once cannot drop each other.
   * An unverified observation (`isCorrect: null`) says nothing about mastery
   * and is not stored, so it never pushes graded work out of the window.
   */
  async recordObservation(
    projectId: string,
    knowledgePoint: string,
    topicId: string | undefined,
    observation: MasteryObservation,
  ): Promise<KnowledgeMastery> {
    const attempt = { projectId, knowledgePoint, ...(topicId ? { topicId } : {}) }
    const row = await this.db.transaction('rw', this.db.knowledgeMastery, async () => {
      const existing = await this.repo.get(attempt.projectId, attempt.knowledgePoint)
      if (observation.isCorrect === null) return existing ?? null
      const observations = [...(existing?.observations ?? []), observation].slice(-MAX_OBSERVATIONS)
      const mastery = computeMastery(observations)
      const graded = observations.filter((o) => o.isCorrect !== null)
      const correct = graded.filter((o) => o.isCorrect).length

      const next: KnowledgeMastery = {
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
      await this.repo.upsert(next)
      return next
    })
    if (!row) {
      // Nothing graded yet: an empty, unsaved estimate.
      return {
        id: masteryId(projectId, knowledgePoint),
        projectId,
        knowledgePoint,
        ...(topicId ? { topicId } : {}),
        mastery: computeMastery([]),
        attempts: 0,
        correct: 0,
        observations: [],
        lastUpdated: Date.now(),
      }
    }
    logger.debug('Mastery updated', { kp: attempt.knowledgePoint, mastery: row.mastery.toFixed(3) })
    return row
  }

  /**
   * Rebuild the mastery rows of the knowledge points in `attempts`. Pass every
   * source for a point (quiz and practice attempts): rows are replaced, not
   * merged. Disputed attempts no longer count; flashcard reviews already on a
   * row are kept, since they are stored nowhere else.
   */
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
      const existing = await this.repo.get(projectId, kp)
      const reviews = (existing?.observations ?? []).filter(
        (o) => o.questionType === FLASHCARD_TYPE,
      )
      const observations: MasteryObservation[] = [
        ...sorted.filter((a) => a.evaluation.disputed !== true).map(observationFromAttempt),
        ...reviews,
      ]
        .filter((o) => o.isCorrect !== null)
        .sort((a, b) => a.at - b.at)
        .slice(-MAX_OBSERVATIONS)
      const graded = observations.filter((o) => o.isCorrect !== null)
      rows.push({
        id: masteryId(projectId, kp),
        projectId,
        knowledgePoint: kp,
        ...(sorted[sorted.length - 1]?.topicId
          ? { topicId: sorted[sorted.length - 1]!.topicId }
          : {}),
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
  async weakKnowledgePoints(
    projectId: string,
    threshold = 0.6,
    limit = 5,
  ): Promise<KnowledgeMastery[]> {
    const rows = await this.repo.listByProject(projectId)
    return rows
      .filter((r) => r.attempts > 0 && r.mastery < threshold)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, limit)
  }
}
/**
 * One mastery observation per attempt. A short answer carries partial credit
 * (points covered / total) and half weight, because its grade comes from an AI
 * reading rather than a deterministic check; a disputed one is ungraded.
 */
export function observationFromAttempt(attempt: QuestionAttempt): MasteryObservation {
  const { evaluation } = attempt
  const disputed = evaluation.disputed === true
  const score = evaluation.score
  return {
    at: attempt.createdAt,
    isCorrect: disputed ? null : evaluation.isCorrect,
    difficulty: attempt.difficulty as MasteryObservation['difficulty'],
    questionType: attempt.questionType,
    ...(!disputed && score && score.total > 0 ? { credit: score.earned / score.total } : {}),
    ...(attempt.questionType === 'short_answer' ? { weight: 0.5 } : {}),
  }
}
