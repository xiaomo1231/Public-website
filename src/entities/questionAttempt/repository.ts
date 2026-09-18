import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { QuestionAttempt } from './types'

export class QuestionAttemptRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async add(attempt: QuestionAttempt): Promise<QuestionAttempt> {
    await this.db.table<QuestionAttempt, string>('questionAttempts').put(attempt)
    return attempt
  }

  async listByProject(projectId: string, limit = 500): Promise<QuestionAttempt[]> {
    const rows = await this.db
      .table<QuestionAttempt, string>('questionAttempts')
      .where('projectId')
      .equals(projectId)
      .reverse()
      .sortBy('createdAt')
    return rows.slice(0, limit)
  }

  async listByQuiz(quizId: string): Promise<QuestionAttempt[]> {
    return this.db
      .table<QuestionAttempt, string>('questionAttempts')
      .where('quizId')
      .equals(quizId)
      .sortBy('createdAt')
  }

  async listByKnowledgePoint(projectId: string, knowledgePoint: string): Promise<QuestionAttempt[]> {
    const rows = await this.listByProject(projectId)
    return rows.filter((a) => a.knowledgePoint === knowledgePoint)
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db.table<QuestionAttempt, string>('questionAttempts').where('projectId').equals(projectId).delete()
  }
}