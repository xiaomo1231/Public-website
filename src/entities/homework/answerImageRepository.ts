import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { AppError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'
import { MAX_ANSWER_IMAGES_PER_QUESTION, type HomeworkAnswerImage } from './answerImages'

/**
 * Persistence for the images attached to homework answers. Every row carries
 * `projectId`, `setId` and `questionId`; queries are question- or set-scoped.
 * The delete helpers run inside the assignment / document / project delete
 * transactions.
 */
export class AnswerImageRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private images() {
    return this.db.table<HomeworkAnswerImage, string>('homeworkAnswerImages')
  }

  /**
   * A question's homework answer images in their display order. Images
   * written in a mock exam attempt are not part of it (see `listForAttempt`).
   */
  async list(questionId: string): Promise<HomeworkAnswerImage[]> {
    return (await this.listAll(questionId)).filter((image) => !image.examAttemptId)
  }

  /** Every image of a question (homework and mock exam), in display order. */
  listAll(questionId: string): Promise<HomeworkAnswerImage[]> {
    return this.images()
      .where('[questionId+order]')
      .between([questionId, -Infinity], [questionId, Infinity])
      .toArray()
  }

  /** A question's images written in one mock exam attempt, in display order. */
  async listForAttempt(questionId: string, attemptId: string): Promise<HomeworkAnswerImage[]> {
    return (await this.listAll(questionId)).filter((image) => image.examAttemptId === attemptId)
  }

  /** Same scope as `image`: its attempt's images, or the homework images. */
  private listScope(questionId: string, attemptId: string | undefined) {
    return attemptId ? this.listForAttempt(questionId, attemptId) : this.list(questionId)
  }

  /**
   * Replace the tablet writing-area pages of one question in one attempt:
   * the previous pen pages of that attempt are removed and `pages` added, in
   * one transaction (a reload never sees half of the area).
   */
  async replaceWritingArea(
    questionId: string,
    attemptId: string,
    pages: ReadonlyArray<Omit<HomeworkAnswerImage, 'order'>>,
  ): Promise<HomeworkAnswerImage[]> {
    return this.db.transaction('rw', [this.images(), this.db.homeworkQuestions], async () => {
      const current = await this.listForAttempt(questionId, attemptId)
      for (const row of current)
        if (row.writingPage !== undefined) await this.images().delete(row.id)
      const rest = current.filter((row) => row.writingPage === undefined)
      if (rest.length + pages.length > MAX_ANSWER_IMAGES_PER_QUESTION)
        throw new AppError(
          t('homework.images.tooMany', { max: MAX_ANSWER_IMAGES_PER_QUESTION }),
          'VALIDATION_ERROR',
        )
      const out: HomeworkAnswerImage[] = []
      const base = rest.reduce((max, row) => Math.max(max, row.order + 1), 0)
      for (const [index, page] of pages.entries()) {
        const row: HomeworkAnswerImage = { ...page, order: base + index }
        await this.images().add(row)
        out.push(row)
      }
      return out
    })
  }

  get(id: string): Promise<HomeworkAnswerImage | undefined> {
    return this.images().get(id)
  }

  /**
   * Append an image to its question. Checked inside the transaction: the
   * question must still exist in the same assignment and project, and the
   * per-question limit holds even when two uploads land together.
   */
  async add(image: Omit<HomeworkAnswerImage, 'order'>): Promise<HomeworkAnswerImage> {
    return this.db.transaction('rw', [this.images(), this.db.homeworkQuestions], async () => {
      const question = await this.db.homeworkQuestions.get(image.questionId)
      if (!question || question.setId !== image.setId || question.projectId !== image.projectId)
        throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
      const existing = await this.listScope(image.questionId, image.examAttemptId)
      if (existing.length >= MAX_ANSWER_IMAGES_PER_QUESTION)
        throw new AppError(
          t('homework.images.tooMany', { max: MAX_ANSWER_IMAGES_PER_QUESTION }),
          'VALIDATION_ERROR',
        )
      const order = existing.reduce((max, row) => Math.max(max, row.order + 1), 0)
      const row: HomeworkAnswerImage = { ...image, order }
      await this.images().add(row)
      return row
    })
  }

  /** Remove one image of a question and close the gap in the order. */
  async remove(questionId: string, id: string): Promise<void> {
    await this.db.transaction('rw', this.images(), async () => {
      const row = await this.images().get(id)
      if (!row || row.questionId !== questionId) return
      await this.images().delete(id)
      const rest = await this.listScope(questionId, row.examAttemptId)
      await this.writeOrder(rest.map((image) => image.id))
    })
  }

  /**
   * Put the question's images in `orderedIds` order. Ids that are not this
   * question's images are ignored; images missing from the list keep their
   * relative order after the listed ones.
   */
  async reorder(
    questionId: string,
    orderedIds: readonly string[],
    attemptId?: string,
  ): Promise<void> {
    await this.db.transaction('rw', this.images(), async () => {
      const current = await this.listScope(questionId, attemptId)
      const known = new Set(current.map((image) => image.id))
      const listed = orderedIds.filter(
        (id, index) => known.has(id) && orderedIds.indexOf(id) === index,
      )
      const rest = current.map((image) => image.id).filter((id) => !listed.includes(id))
      await this.writeOrder([...listed, ...rest])
    })
  }

  /**
   * Whole-row puts rather than `update()`: Dexie's partial update clones the
   * row in JS, which is not guaranteed to keep the ArrayBuffer; a put hands
   * it to IndexedDB's own structured clone.
   */
  private async writeOrder(ids: readonly string[]): Promise<void> {
    for (const [order, id] of ids.entries()) {
      const row = await this.images().get(id)
      if (row && row.order !== order) await this.images().put({ ...row, order })
    }
  }

  countBySet(setId: string): Promise<number> {
    return this.images().where('setId').equals(setId).count()
  }

  /** Ids of a set's questions that have at least one answer image. */
  async questionIdsWithImages(setId: string): Promise<Set<string>> {
    const rows = await this.images().where('setId').equals(setId).toArray()
    return new Set(rows.map((row) => row.questionId))
  }

  async deleteByQuestion(questionId: string): Promise<void> {
    await this.images().where('questionId').equals(questionId).delete()
  }

  async deleteBySet(setId: string): Promise<void> {
    await this.images().where('setId').equals(setId).delete()
  }

  async deleteByProject(projectId: string): Promise<void> {
    await this.images().where('projectId').equals(projectId).delete()
  }
}
