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
  type HomeworkAnswerImage,
} from '@/entities/homework/answerImages'
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

  list(questionId: string): Promise<HomeworkAnswerImage[]> {
    return this.repo.list(questionId)
  }

  /** Downscale, validate and append one image to the question's answer. */
  async add(
    questionId: string,
    file: Blob,
    source: HomeworkAnswerImage['source'] = 'upload',
  ): Promise<HomeworkAnswerImage> {
    const question = await this.db.homeworkQuestions.get(questionId)
    if (!question) throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
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
      })
    } catch (err) {
      if (isQuotaError(err))
        throw new AppError(t('homework.images.storageFull'), 'STORAGE_FULL', err)
      throw err
    }
  }

  remove(questionId: string, imageId: string): Promise<void> {
    return this.repo.remove(questionId, imageId)
  }

  /** Move one image earlier (`-1`) or later (`+1`). */
  async move(questionId: string, imageId: string, delta: number): Promise<void> {
    const ids = (await this.repo.list(questionId)).map((image) => image.id)
    await this.repo.reorder(questionId, moveId(ids, imageId, delta))
  }

  reorder(questionId: string, orderedIds: readonly string[]): Promise<void> {
    return this.repo.reorder(questionId, orderedIds)
  }
}
