import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { HomeworkQuestion, HomeworkSet } from './types'

/**
 * Persistence for homework assignments and their questions.
 *
 * Every row carries `projectId` and every query is project- or set-scoped, so
 * one course can never read another's homework.
 */
export class HomeworkRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private sets() {
    return this.db.table<HomeworkSet, string>('homeworkSets')
  }

  private questions() {
    return this.db.table<HomeworkQuestion, string>('homeworkQuestions')
  }

  listSets(projectId: string): Promise<HomeworkSet[]> {
    return this.sets().where('projectId').equals(projectId).reverse().sortBy('createdAt')
  }

  getSet(id: string): Promise<HomeworkSet | undefined> {
    return this.sets().get(id)
  }

  async upsertSet(set: HomeworkSet): Promise<HomeworkSet> {
    await this.sets().put(set)
    return set
  }

  listQuestions(setId: string): Promise<HomeworkQuestion[]> {
    return this.questions().where('setId').equals(setId).sortBy('order')
  }

  getQuestion(id: string): Promise<HomeworkQuestion | undefined> {
    return this.questions().get(id)
  }

  async addQuestions(questions: HomeworkQuestion[]): Promise<HomeworkQuestion[]> {
    if (questions.length === 0) return questions
    await this.questions().bulkAdd(questions)
    return questions
  }

  async upsertQuestion(question: HomeworkQuestion): Promise<HomeworkQuestion> {
    await this.questions().put(question)
    return question
  }

  async updateQuestion(
    id: string,
    patch: Partial<HomeworkQuestion>,
  ): Promise<HomeworkQuestion | undefined> {
    const existing = await this.getQuestion(id)
    if (!existing) return undefined
    const next: HomeworkQuestion = { ...existing, ...patch, id, updatedAt: Date.now() }
    await this.questions().put(next)
    return next
  }

  /**
   * Write freshly generated hints + solution, atomically preserving every
   * student field on the CURRENT row and clamping the revealed-hint progress
   * to the new hint count. Reading inside the transaction means a draft or
   * message saved while the AI was running can never be overwritten.
   */
  async applyGeneratedContent(
    id: string,
    hints: string[],
    solution: string,
    promptVersion: string,
  ): Promise<HomeworkQuestion | undefined> {
    return this.db.transaction('rw', this.questions(), async () => {
      const existing = await this.questions().get(id)
      if (!existing) return undefined
      const next: HomeworkQuestion = {
        ...existing,
        hints,
        solution,
        generationStatus: 'ready',
        generationError: undefined,
        promptVersion,
        revealedHints: Math.min(existing.revealedHints, hints.length),
        updatedAt: Date.now(),
      }
      await this.questions().put(next)
      return next
    })
  }

  async deleteQuestion(id: string): Promise<void> {
    await this.questions().delete(id)
  }

  async deleteSet(setId: string): Promise<void> {
    await this.db.transaction('rw', this.sets(), this.questions(), async () => {
      await this.questions().where('setId').equals(setId).delete()
      await this.sets().delete(setId)
    })
  }

  async deleteQuestionsBySet(setId: string): Promise<number> {
    return this.questions().where('setId').equals(setId).delete()
  }

  async deleteByDocument(documentId: string): Promise<void> {
    const sets = await this.sets().where('documentId').equals(documentId).toArray()
    await this.db.transaction('rw', this.sets(), this.questions(), async () => {
      for (const set of sets) {
        await this.questions().where('setId').equals(set.id).delete()
        await this.sets().delete(set.id)
      }
    })
  }

  async deleteByProject(projectId: string): Promise<number> {
    const sets = await this.sets().where('projectId').equals(projectId).toArray()
    await this.db.transaction('rw', this.sets(), this.questions(), async () => {
      await this.questions().where('projectId').equals(projectId).delete()
      await this.sets().where('projectId').equals(projectId).delete()
    })
    return sets.length
  }
}
