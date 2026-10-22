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

  get(id: string): Promise<QuestionAttempt | undefined> {
    return this.db.table<QuestionAttempt, string>('questionAttempts').get(id)
  }

  async update(attempt: QuestionAttempt): Promise<QuestionAttempt> {
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

  /**
   * Every attempt on one knowledge point of a project, newest first. Uses the
   * `knowledgePoint` index: going through `listByProject` capped the history
   * at the project's latest 500 attempts, so a mastery rebuild could miss an
   * older point's attempts entirely.
   */
  async listByKnowledgePoint(
    projectId: string,
    knowledgePoint: string,
  ): Promise<QuestionAttempt[]> {
    const rows = await this.db
      .table<QuestionAttempt, string>('questionAttempts')
      .where('knowledgePoint')
      .equals(knowledgePoint)
      .filter((a) => a.projectId === projectId)
      .toArray()
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db
      .table<QuestionAttempt, string>('questionAttempts')
      .where('projectId')
      .equals(projectId)
      .delete()
  }
}
