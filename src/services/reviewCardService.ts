import { ReviewCardRepository } from '@/entities/reviewCard/repository'
import { newCard, scheduleReview, type ReviewCard, type ReviewGrade } from '@/entities/reviewCard/types'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { ValidationError } from '@/infrastructure/errors/AppError'
import { MasteryService } from './masteryService'
import { t } from '@/i18n'

export interface ReviewStats {
  total: number
  due: number
  /** Never reviewed successfully. */
  fresh: number
  /** Interval of three weeks or more. */
  mature: number
}

const MAX_FIELD = 600
const clean = (text: string) => text.replace(/\s+/g, ' ').trim()
const key = (front: string) => clean(front).toLowerCase()

/**
 * Term flashcards: creation (from course concepts, anatomy tables or by
 * hand), spaced-repetition review, and a light link to mastery — a review of
 * a card tied to a concept counts as a half-weight observation.
 */
export class ReviewCardService {
  private repo: ReviewCardRepository
  private analyses: CourseAnalysisRepository
  private mastery: MasteryService

  constructor(db: AppDatabase = getDb()) {
    this.repo = new ReviewCardRepository(db)
    this.analyses = new CourseAnalysisRepository(db)
    this.mastery = new MasteryService(db)
  }

  list(projectId: string): Promise<ReviewCard[]> {
    return this.repo.listByProject(projectId)
  }

  due(projectId: string, now = Date.now()): Promise<ReviewCard[]> {
    return this.repo.listDue(projectId, now)
  }

  async stats(projectId: string, now = Date.now()): Promise<ReviewStats> {
    const cards = await this.repo.listByProject(projectId)
    return {
      total: cards.length,
      due: cards.filter((card) => card.due <= now).length,
      fresh: cards.filter((card) => card.reps === 0 && !card.lastReviewedAt).length,
      mature: cards.filter((card) => card.interval >= 21).length,
    }
  }

  /** Add cards, skipping fronts the project already has. Returns how many were added. */
  async addMany(
    projectId: string,
    items: Array<{ front: string; back: string; source: ReviewCard['source']; topicId?: string; knowledgePoint?: string }>,
  ): Promise<number> {
    const existing = new Set((await this.repo.listByProject(projectId)).map((card) => key(card.front)))
    const now = Date.now()
    const cards: ReviewCard[] = []
    for (const item of items) {
      const front = clean(item.front).slice(0, MAX_FIELD)
      const back = item.back.trim().slice(0, MAX_FIELD * 2)
      if (!front || !back || existing.has(key(front))) continue
      existing.add(key(front))
      cards.push(
        newCard({
          projectId,
          front,
          back,
          source: item.source,
          now,
          ...(item.topicId ? { topicId: item.topicId } : {}),
          ...(item.knowledgePoint ? { knowledgePoint: item.knowledgePoint } : {}),
        }),
      )
    }
    await this.repo.bulkAdd(cards)
    return cards.length
  }

  async addManual(projectId: string, front: string, back: string): Promise<ReviewCard> {
    if (!clean(front) || !back.trim()) throw new ValidationError(t('cards.emptyFields'))
    const added = await this.addMany(projectId, [{ front, back, source: 'manual' }])
    if (added === 0) throw new ValidationError(t('cards.duplicate'))
    const cards = await this.repo.listByProject(projectId)
    return cards.find((card) => key(card.front) === key(front))!
  }

  /** One card per course concept with a definition ("名词解释"). */
  async generateFromConcepts(projectId: string): Promise<number> {
    const concepts = await this.analyses.listConcepts(projectId)
    return this.addMany(
      projectId,
      concepts
        .filter((concept) => concept.definition.trim())
        .map((concept) => ({
          front: concept.name,
          back: concept.definition,
          source: 'concept' as const,
          knowledgePoint: concept.name,
          ...(concept.topicIds[0] ? { topicId: concept.topicIds[0] } : {}),
        })),
    )
  }

  /** Cards from a relation table: "<row> — <column>" → cell. */
  async addFromTable(
    projectId: string,
    table: { columns: string[]; rows: Array<{ name: string; cells: string[] }>; topicId?: string },
  ): Promise<number> {
    const items = table.rows.flatMap((row) =>
      table.columns.map((column, i) => ({
        front: `${row.name} — ${column}`,
        back: row.cells[i] ?? '',
        source: 'table' as const,
        knowledgePoint: row.name,
        ...(table.topicId ? { topicId: table.topicId } : {}),
      })),
    )
    return this.addMany(projectId, items)
  }

  async update(id: string, front: string, back: string): Promise<ReviewCard> {
    const card = await this.repo.get(id)
    if (!card) throw new ValidationError(t('cards.notFound'))
    if (!clean(front) || !back.trim()) throw new ValidationError(t('cards.emptyFields'))
    return this.repo.put({ ...card, front: clean(front).slice(0, MAX_FIELD), back: back.trim().slice(0, MAX_FIELD * 2), updatedAt: Date.now() })
  }

  remove(id: string): Promise<void> {
    return this.repo.delete(id)
  }

  /** Rate a review and reschedule the card. */
  async review(id: string, grade: ReviewGrade, now = Date.now()): Promise<ReviewCard> {
    const card = await this.repo.get(id)
    if (!card) throw new ValidationError(t('cards.notFound'))
    const next = await this.repo.put(scheduleReview(card, grade, now))
    if (card.knowledgePoint) {
      await this.mastery.recordObservation(card.projectId, card.knowledgePoint, card.topicId, {
        at: now,
        isCorrect: grade !== 'again',
        difficulty: 'basic',
        questionType: 'flashcard',
        credit: grade === 'again' ? 0 : grade === 'hard' ? 0.6 : 1,
        // Recalling a term is weaker evidence than answering a question.
        weight: 0.5,
      })
    }
    return next
  }
}
