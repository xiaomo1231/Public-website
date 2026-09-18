import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { Quiz } from './types'

export class QuizRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async get(id: string): Promise<Quiz | undefined> {
    return this.db.table<Quiz, string>('quizzes').get(id)
  }

  async listByProject(projectId: string): Promise<Quiz[]> {
    return this.db.table<Quiz, string>('quizzes').where('projectId').equals(projectId).reverse().sortBy('startedAt')
  }

  async upsert(quiz: Quiz): Promise<Quiz> {
    await this.db.table<Quiz, string>('quizzes').put(quiz)
    return quiz
  }

  async delete(id: string): Promise<void> {
    await this.db.table<Quiz, string>('quizzes').delete(id)
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.db.table<Quiz, string>('quizzes').where('projectId').equals(projectId).delete()
  }
}