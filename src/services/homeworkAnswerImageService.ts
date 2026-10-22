import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { AppError } from '@/infrastructure/errors/AppError'
import { ensureStorageFor, isQuotaError } from '@/infrastructure/files/storageSpace'
import {
  ImagePrepareError,
  isConvertibleImageType,
  prepareAnswerImage,
  type PreparedImage,
} from '@/infrastructure/files/imageDownscale'
import { AnswerImageRepository } from '@/entities/homework/answerImageRepository'
import {
  isAnswerImageMimeType,
  MAX_ANSWER_IMAGE_BYTES,
  moveId,
  type AnswerImageExtras,
  type AnswerImageMimeType,
  type HomeworkAnswerImage,
} from '@/entities/homework/answerImages'
import type { StoredStrokePage } from '@/entities/handwriting/strokes'
import { t } from '@/i18n'

export type ImagePreparer = (file: Blob) => Promise<PreparedImage>

/**
 * Images of handwritten working attached to one homework question's answer:
 * uploaded photos and pen-board pages. Stored locally only; they leave the
 * device only when the student asks the AI to check / discuss THIS question.
 */
export class HomeworkAnswerImageService {
  private db: AppDatabase
  private repo: AnswerImageRepository
  private prepare: ImagePreparer

  constructor(deps: { db?: AppDatabase; prepare?: ImagePreparer } = {}) {
    this.db = deps.db ?? getDb()
    this.repo = new AnswerImageRepository(this.db)
    this.prepare = deps.prepare ?? prepareAnswerImage
  }

  /**
   * The question's homework answer images, or — with `attemptId` — the images
   * written in that mock exam attempt.
   */
  list(questionId: string, attemptId?: string): Promise<HomeworkAnswerImage[]> {
    return attemptId ? this.repo.listForAttempt(questionId, attemptId) : this.repo.list(questionId)
  }

  /** Downscale, validate and append one image to the question's answer. */
  async add(
    questionId: string,
    file: Blob,
    source: HomeworkAnswerImage['source'] = 'upload',
    extras: AnswerImageExtras = {},
  ): Promise<HomeworkAnswerImage> {
    const question = await this.db.homeworkQuestions.get(questionId)
    if (!question) throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
    const prepared = await this.prepareImage(file)
    try {
      return await this.repo.add({
        id: crypto.randomUUID(),
        projectId: question.projectId,
        setId: question.setId,
        questionId,
        mimeType: prepared.mimeType,
        bytes: prepared.bytes,
        source,
        width: prepared.width,
        height: prepared.height,
        createdAt: Date.now(),
        ...extras,
      })
    } catch (err) {
      if (isQuotaError(err))
        throw new AppError(t('homework.images.storageFull'), 'STORAGE_FULL', err)
      throw err
    }
  }

  /**
   * Save a tablet writing area of one question in one mock exam attempt: one
   * image per page with ink (rendered PNG + its strokes), replacing the
   * area's previous pages in one transaction.
   */
  async replaceWritingArea(
    questionId: string,
    attemptId: string,
    pages: ReadonlyArray<{ image: Blob; strokes: StoredStrokePage; page: number }>,
  ): Promise<HomeworkAnswerImage[]> {
    const question = await this.db.homeworkQuestions.get(questionId)
    if (!question) throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
    const rows = []
    for (const page of pages) {
      const prepared = await this.prepareImage(page.image)
      rows.push({
        id: crypto.randomUUID(),
        projectId: question.projectId,
        setId: question.setId,
        questionId,
        mimeType: prepared.mimeType,
        bytes: prepared.bytes,
        source: 'pen' as const,
        width: prepared.width,
        height: prepared.height,
        createdAt: Date.now(),
        examAttemptId: attemptId,
        writingPage: page.page,
        strokes: page.strokes,
      })
    }
    try {
      return await this.repo.replaceWritingArea(questionId, attemptId, rows)
    } catch (err) {
      if (isQuotaError(err))
        throw new AppError(t('homework.images.storageFull'), 'STORAGE_FULL', err)
      throw err
    }
  }

  private async prepareImage(
    file: Blob,
  ): Promise<{ mimeType: AnswerImageMimeType; bytes: ArrayBuffer; width: number; height: number }> {
    if (!isConvertibleImageType(file.type))
      throw new AppError(t('homework.images.badType'), 'VALIDATION_ERROR')
    let prepared: PreparedImage
    try {
      prepared = await this.prepare(file)
    } catch (err) {
      if (err instanceof ImagePrepareError) {
        throw new AppError(
          t(
            err.reason === 'type'
              ? 'homework.images.badType'
              : err.reason === 'size'
                ? 'homework.images.tooLarge'
                : 'homework.images.unreadable',
            { mb: MAX_ANSWER_IMAGE_BYTES / (1024 * 1024) },
          ),
          'VALIDATION_ERROR',
          err,
        )
      }
      throw err
    }
    if (
      prepared.bytes.byteLength > MAX_ANSWER_IMAGE_BYTES ||
      !isAnswerImageMimeType(prepared.mimeType)
    )
      throw new AppError(
        t('homework.images.tooLarge', { mb: MAX_ANSWER_IMAGE_BYTES / (1024 * 1024) }),
        'VALIDATION_ERROR',
      )
    await ensureStorageFor(prepared.bytes.byteLength)
    return {
      mimeType: prepared.mimeType,
      bytes: prepared.bytes,
      width: prepared.width,
      height: prepared.height,
    }
  }

  remove(questionId: string, imageId: string): Promise<void> {
    return this.repo.remove(questionId, imageId)
  }

  /** Move one image earlier (`-1`) or later (`+1`) within its scope (homework or one attempt). */
  async move(
    questionId: string,
    imageId: string,
    delta: number,
    attemptId?: string,
  ): Promise<void> {
    const ids = (await this.list(questionId, attemptId)).map((image) => image.id)
    await this.repo.reorder(questionId, moveId(ids, imageId, delta), attemptId)
  }

  reorder(questionId: string, orderedIds: readonly string[], attemptId?: string): Promise<void> {
    return this.repo.reorder(questionId, orderedIds, attemptId)
  }
}
