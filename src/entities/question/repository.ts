import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { NewQuestionInput, Question } from './types'
import { normalizeQuestionOptions } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError, ValidationError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

export class QuestionRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async get(id: string): Promise<Question | undefined> {
    return this.db.table<Question, string>('questions').get(id)
  }

  async listByIds(ids: string[]): Promise<Question[]> {
    if (ids.length === 0) return []
    const rows = await this.db.table<Question, string>('questions').bulkGet(ids)
    const byId = new Map<string, Question>()
    for (const row of rows) if (row) byId.set(row.id, row)
    return ids.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q))
  }

  async listByProject(projectId: string): Promise<Question[]> {
    return this.db.table<Question, string>('questions').where('projectId').equals(projectId).reverse().sortBy('createdAt')
  }

  async listByTopic(projectId: string, topicId: string): Promise<Question[]> {
    const all = await this.listByProject(projectId)
    return all.filter((q) => q.topicId === topicId)
  }

  async addMany(inputs: NewQuestionInput[]): Promise<Question[]> {
    if (inputs.length === 0) return []
    const now = Date.now()
    const rows: Question[] = inputs.map((input) => {
      if (!input.prompt.trim()) throw new ValidationError(t('errors.questionPromptRequired'))
      if (!input.correctAnswer.trim()) throw new ValidationError(t('errors.questionAnswerRequired'))
      const options = normalizeQuestionOptions(input.options)
      return {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        ...(input.topicId ? { topicId: input.topicId } : {}),
        knowledgePoint: input.knowledgePoint,
        type: input.type,
        difficulty: input.difficulty,
        prompt: input.prompt,
        ...(options ? { options } : {}),
        correctAnswer: input.correctAnswer,
        ...(input.solution ? { solution: input.solution } : {}),
        hints: input.hints ?? [],
        sourceRefs: input.sourceRefs ?? [],
        promptVersion: input.promptVersion ?? 'v1',
        createdAt: now,
      }
    })
    try {
      await this.db.table<Question, string>('questions').bulkPut(rows)
      logger.debug('Questions added', { count: rows.length, projectId: inputs[0]?.projectId })
      return rows
    } catch (err) {
      throw new StorageError(t('storage.failedToSaveQuestions'), err)
    }
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db.table<Question, string>('questions').where('projectId').equals(projectId).delete()
  }

  async countByProject(projectId: string): Promise<number> {
    return this.db.table<Question, string>('questions').where('projectId').equals(projectId).count()
  }
}