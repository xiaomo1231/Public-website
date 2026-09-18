import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { AddMistakeInput, Mistake, MistakeFilter, MistakeStats, MistakeType } from './types'
import { MISTAKE_TYPES } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { NotFoundError, StorageError } from '@/infrastructure/errors/AppError'

export class MistakeRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async get(id: string): Promise<Mistake | undefined> {
    return this.db.table<Mistake, string>('mistakes').get(id)
  }

  async listByProject(projectId: string, filter: MistakeFilter = {}): Promise<Mistake[]> {
    const rows = await this.db
      .table<Mistake, string>('mistakes')
      .where('projectId')
      .equals(projectId)
      .reverse()
      .sortBy('createdAt')
    return applyFilter(rows, filter)
  }

  async listByQuiz(quizId: string): Promise<Mistake[]> {
    return this.db.table<Mistake, string>('mistakes').where('quizId').equals(quizId).toArray()
  }

  async add(input: AddMistakeInput): Promise<Mistake> {
    const now = Date.now()
    const row: Mistake = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      ...(input.questionId ? { questionId: input.questionId } : {}),
      ...(input.quizId ? { quizId: input.quizId } : {}),
      ...(input.topicId ? { topicId: input.topicId } : {}),
      knowledgePoint: input.knowledgePoint,
      difficulty: input.difficulty,
      questionType: input.questionType,
      question: input.question,
      ...(input.options ? { options: input.options } : {}),
      studentAnswer: input.studentAnswer,
      correctAnswer: input.correctAnswer,
      ...(input.solution ? { solution: input.solution } : {}),
      mistakeType: input.mistakeType ?? 'unknown',
      analysisStatus: 'pending',
      status: 'active',
      source: input.questionId ? 'auto' : 'manual',
      attemptIds: input.attemptIds ?? [],
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await this.db.table<Mistake, string>('mistakes').add(row)
      logger.debug('Mistake recorded', { id: row.id, kp: row.knowledgePoint })
      return row
    } catch (err) {
      throw new StorageError('Failed to save mistake', err)
    }
  }

  async update(id: string, patch: Partial<Mistake>): Promise<Mistake> {
    const existing = await this.get(id)
    if (!existing) throw new NotFoundError('Mistake', id)
    const next: Mistake = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() }
    await this.db.table<Mistake, string>('mistakes').put(next)
    return next
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) throw new NotFoundError('Mistake', id)
    await this.db.table<Mistake, string>('mistakes').delete(id)
    logger.warn('Mistake removed', { id })
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db.table<Mistake, string>('mistakes').where('projectId').equals(projectId).delete()
  }

  /** Find an existing active mistake for the same question. */
  async findByQuestion(projectId: string, questionId: string): Promise<Mistake | undefined> {
    const rows = await this.db
      .table<Mistake, string>('mistakes')
      .where('projectId')
      .equals(projectId)
      .filter((m) => m.questionId === questionId && m.status !== 'archived')
      .toArray()
    return rows[0]
  }

  async stats(projectId: string): Promise<MistakeStats> {
    const rows = await this.db.table<Mistake, string>('mistakes').where('projectId').equals(projectId).toArray()
    const byType = Object.fromEntries(MISTAKE_TYPES.map((t) => [t, 0])) as Record<MistakeType, number>
    const kpCounts = new Map<string, number>()
    let active = 0
    let understood = 0
    let archived = 0
    for (const row of rows) {
      byType[row.mistakeType] = (byType[row.mistakeType] ?? 0) + 1
      kpCounts.set(row.knowledgePoint, (kpCounts.get(row.knowledgePoint) ?? 0) + 1)
      if (row.status === 'active') active++
      else if (row.status === 'understood') understood++
      else archived++
    }
    return {
      total: rows.length,
      active,
      understood,
      archived,
      byType,
      byKnowledgePoint: [...kpCounts.entries()]
        .map(([knowledgePoint, count]) => ({ knowledgePoint, count }))
        .sort((a, b) => b.count - a.count),
    }
  }
}

function applyFilter(rows: Mistake[], filter: MistakeFilter): Mistake[] {
  const q = filter.query?.trim().toLowerCase()
  return rows.filter((m) => {
    if (filter.status && filter.status !== 'all' && m.status !== filter.status) return false
    if (filter.knowledgePoint && m.knowledgePoint !== filter.knowledgePoint) return false
    if (filter.mistakeType && m.mistakeType !== filter.mistakeType) return false
    if (filter.quizId && m.quizId !== filter.quizId) return false
    if (q && !m.question.toLowerCase().includes(q) && !m.knowledgePoint.toLowerCase().includes(q)) return false
    return true
  })
}