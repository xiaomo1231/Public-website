import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { PracticeAttempt, PracticeQuestion, PracticeSet } from './types'

/** Persistence for the Professor Practice bank and its attempts. */
export class PracticeRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private sets() {
    return this.db.table<PracticeSet, string>('practiceSets')
  }
  private questions() {
    return this.db.table<PracticeQuestion, string>('practiceQuestions')
  }
  private attempts() {
    return this.db.table<PracticeAttempt, string>('practiceAttempts')
  }

  listSets(projectId: string): Promise<PracticeSet[]> {
    return this.sets().where('projectId').equals(projectId).reverse().sortBy('createdAt')
  }

  getSet(id: string): Promise<PracticeSet | undefined> {
    return this.sets().get(id)
  }

  async upsertSet(set: PracticeSet): Promise<PracticeSet> {
    await this.sets().put(set)
    return set
  }

  listQuestionsBySet(setId: string): Promise<PracticeQuestion[]> {
    return this.questions().where('setId').equals(setId).sortBy('order')
  }

  listQuestionsByProject(projectId: string): Promise<PracticeQuestion[]> {
    return this.questions().where('projectId').equals(projectId).sortBy('order')
  }

  getQuestion(id: string): Promise<PracticeQuestion | undefined> {
    return this.questions().get(id)
  }

  async addQuestions(questions: PracticeQuestion[]): Promise<PracticeQuestion[]> {
    if (questions.length === 0) return []
    await this.questions().bulkAdd(questions)
    return questions
  }

  async updateQuestion(id: string, patch: Partial<PracticeQuestion>): Promise<PracticeQuestion | undefined> {
    const existing = await this.getQuestion(id)
    if (!existing) return undefined
    const next = { ...existing, ...patch }
    await this.questions().put(next)
    return next
  }

  listAttemptsByQuestion(questionId: string): Promise<PracticeAttempt[]> {
    return this.attempts().where('questionId').equals(questionId).sortBy('submittedAt')
  }

  listAttemptsBySet(setId: string): Promise<PracticeAttempt[]> {
    return this.attempts().where('setId').equals(setId).sortBy('submittedAt')
  }

  async addAttempt(attempt: PracticeAttempt): Promise<PracticeAttempt> {
    await this.attempts().add(attempt)
    return attempt
  }

  async deleteByDocument(documentId: string): Promise<void> {
    const setIds = (await this.sets().where('documentId').equals(documentId).toArray()).map(
      (set) => set.id,
    )
    for (const setId of setIds) {
      const questionIds = (await this.listQuestionsBySet(setId)).map((q) => q.id)
      await this.questions().where('setId').equals(setId).delete()
      for (const questionId of questionIds) {
        await this.attempts().where('questionId').equals(questionId).delete()
      }
      await this.sets().delete(setId)
    }
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.sets().where('projectId').equals(projectId).delete()
    await this.questions().where('projectId').equals(projectId).delete()
    await this.attempts().where('projectId').equals(projectId).delete()
    return count
  }
}
