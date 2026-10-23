import type { DocumentRepository } from '@/entities/document/repository'
import type { ProjectService } from './projectService'
import {
  resolveMaterialType,
  type CreateDocumentInput,
  type Document,
  type LearningMaterialType,
  type UpdateDocumentInput,
} from '@/entities/document/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { localSyllabus } from '@/entities/syllabus/parse'
import { CourseContentService } from './courseContentService'
import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { ChunkRepository } from '@/entities/chunk/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { AnswerImageRepository } from '@/entities/homework/answerImageRepository'
import { PracticeRepository } from '@/entities/practice/repository'
import { hasStudentWork } from '@/entities/homework/matching'
import { AppError, NotFoundError, ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

/**
 * What deleting one document would touch. Shown to the user before they
 * confirm, so a file-level delete is never a blind "are you sure?".
 *
 * `studentWork` is a hard guard: homework drafts/messages and practice answers
 * are the learner's own work and are never silently cascaded away. When any is
 * present the delete is blocked and the caller must resolve it first.
 */
export interface DocumentDeleteImpact {
  document: Document
  removes: {
    chunks: number
    visualSources: number
    courseStructures: number
    homeworkSets: number
    homeworkQuestions: number
    practiceSets: number
    practiceQuestions: number
    /** Cached per-slide lessons + their Q&A for a presentation. */
    slideLessons: number
  }
  studentWork: {
    homeworkAnswers: number
    practiceAttempts: number
  }
  blocked: boolean
}

interface StudentWork {
  homeworkSets: number
  homeworkQuestions: number
  homeworkAnswers: number
  practiceSets: number
  practiceQuestions: number
  practiceAttempts: number
}

export class DocumentService {
  private repo: DocumentRepository
  private projects: ProjectService
  private db: AppDatabase
  private chunks: ChunkRepository
  private homework: HomeworkRepository
  private practice: PracticeRepository
  private content: CourseContentService

  constructor(deps: {
    documents: DocumentRepository
    projects: ProjectService
    db?: AppDatabase
    chunks?: ChunkRepository
    homework?: HomeworkRepository
    practice?: PracticeRepository
    content?: CourseContentService
  }) {
    const db = deps.db ?? getDb()
    this.db = db
    this.repo = deps.documents
    this.projects = deps.projects
    this.chunks = deps.chunks ?? new ChunkRepository(db)
    this.homework = deps.homework ?? new HomeworkRepository(db)
    this.practice = deps.practice ?? new PracticeRepository(db)
    this.content = deps.content ?? new CourseContentService()
  }

  listByProject(projectId: string): Promise<Document[]> {
    return this.repo.listByProject(projectId)
  }

  get(id: string): Promise<Document> {
    return this.repo.get(id)
  }

  async create(input: CreateDocumentInput): Promise<Document> {
    await this.projects.get(input.projectId) // verify project exists
    return this.repo.create(input)
  }

  async rename(id: string, name: string): Promise<Document> {
    if (!name.trim()) throw new ValidationError(t('errors.documentNameRequired'))
    return this.repo.update(id, { name: name.trim() })
  }

  /** Move a file to a folder (`''` = out of any folder). Only the label changes. */
  moveToFolder(id: string, folderPath: string): Promise<Document> {
    return this.repo.update(id, { folderPath: folderPath || null })
  }

  update(id: string, patch: UpdateDocumentInput): Promise<Document> {
    return this.repo.update(id, patch)
  }

  /**
   * Change a processed file's learning-material role (课件 → 往年试卷 …).
   * The chunks follow the new role in the same transaction; what was derived
   * from the old role is cleaned up like a delete would: homework / exam sets,
   * professor-practice sets, an answer-key link, the textbook structure (and
   * the chunks' chapter fields that pointed into it). A syllabus reads its
   * exam topics locally. Student work blocks the change (`FILE_IN_USE`),
   * re-checked inside the transaction. Becoming a textbook needs the
   * structure detected from the file, so `needsReprocess` is set when the
   * stored bytes allow it; the caller reprocesses.
   */
  async changeMaterialType(
    id: string,
    materialType: LearningMaterialType,
    projectId?: string,
  ): Promise<{ document: Document; changed: boolean; needsReprocess: boolean }> {
    const document = await this.repo.get(id)
    if (projectId && document.projectId !== projectId) throw new NotFoundError('Document', id)
    const from = resolveMaterialType(document.materialType)
    if (from === materialType) return { document, changed: false, needsReprocess: false }
    if (document.status === 'processing' || document.status === 'uploading') {
      throw new AppError(t('fileBatch.reason.busy'), 'FILE_BUSY')
    }
    const structures = new CourseStructureRepository(this.db)
    await this.db.transaction(
      'rw',
      [
        this.db.documents,
        this.db.chunks,
        this.db.courseStructures,
        this.db.courseStructureNodes,
        this.db.homeworkSets,
        this.db.homeworkQuestions,
        this.db.homeworkWalkthroughs,
        this.db.walkthroughNotes,
        this.db.homeworkAnswerImages,
        this.db.practiceSets,
        this.db.practiceQuestions,
        this.db.practiceAttempts,
      ],
      async () => {
        const work = await this.studentWorkFor(id)
        if (work.homeworkAnswers > 0 || work.practiceAttempts > 0) {
          throw new AppError(t('fileBatch.reason.typeHasWork'), 'FILE_IN_USE')
        }
        const current = await this.db.documents.get(id)
        if (!current) throw new NotFoundError('Document', id)
        if (from === 'homework' || from === 'past_exam') await this.homework.deleteByDocument(id)
        if (from === 'professor_practice') await this.practice.deleteByDocument(id)
        if (from === 'homework_answer') {
          const linked = (await this.db.homeworkSets.toArray()).filter(
            (set) => set.answerDocumentId === id,
          )
          for (const set of linked) {
            await this.homework.clearAnswerLinks(set.id)
            await this.db.homeworkSets.update(set.id, {
              answerDocumentId: undefined,
              answerEntries: undefined,
            })
          }
        }
        const leavesTextbook = from === 'textbook'
        if (leavesTextbook) await structures.deleteByDocument(id)
        const chunks = await this.db.chunks.where('documentId').equals(id).toArray()
        const nextChunks = chunks.map((chunk) => {
          const next: DocumentChunk = { ...chunk, materialType }
          if (leavesTextbook) {
            delete next.chapterId
            delete next.sectionId
            delete next.chapterNumber
            delete next.sectionNumber
            delete next.chapterTitle
            delete next.sectionTitle
          }
          return next
        })
        await this.db.chunks.bulkPut(nextChunks)
        const next: Document = { ...current, materialType }
        // The student chose a role: an earlier content-based suggestion is settled.
        delete next.suggestedMaterialType
        if (materialType === 'syllabus' && !current.syllabus?.editedAt) {
          next.syllabus = localSyllabus(
            [...nextChunks]
              .sort((a, b) => a.order - b.order)
              .map((chunk) => ({
                id: chunk.id,
                text: chunk.text,
                contentType: chunk.contentType,
                ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
              })),
          )
        }
        await this.db.documents.put(next)
      },
    )
    try {
      await this.content.markStale(document.projectId, 'material-type-changed')
    } catch (err) {
      logger.debug('markStale after a material-type change failed', { error: String(err) })
    }
    const updated = await this.repo.get(id)
    logger.info('Document material type changed', { id, from, to: materialType })
    return {
      document: updated,
      changed: true,
      needsReprocess:
        materialType === 'textbook' && document.hasBlob && document.status === 'ready',
    }
  }

  /**
   * Read-only summary of what deleting a file would remove or invalidate.
   * Scoped to the project so a guessed id from another project reports
   * `not-found` instead of exposing its dependencies.
   */
  async getDeleteImpact(id: string, projectId?: string): Promise<DocumentDeleteImpact> {
    const document = await this.repo.get(id)
    if (projectId && document.projectId !== projectId) throw new NotFoundError('Document', id)
    const work = await this.studentWorkFor(id)
    const chunks = await this.chunks.countByDocument(id)
    const visualSources = await this.db.visualSources.where('documentId').equals(id).count()
    const courseStructures = await this.db.courseStructures
      .where('sourceDocumentId')
      .equals(id)
      .count()
    const slideLessons = await this.db.slideLessons.where('documentId').equals(id).count()
    return {
      document,
      removes: {
        chunks,
        visualSources,
        courseStructures,
        homeworkSets: work.homeworkSets,
        homeworkQuestions: work.homeworkQuestions,
        practiceSets: work.practiceSets,
        practiceQuestions: work.practiceQuestions,
        slideLessons,
      },
      studentWork: {
        homeworkAnswers: work.homeworkAnswers,
        practiceAttempts: work.practiceAttempts,
      },
      blocked: work.homeworkAnswers > 0 || work.practiceAttempts > 0,
    }
  }

  /**
   * Delete one file and everything derived from it, atomically.
   *
   * - The document's own rows (blob, chunks, jobs, visuals, book structure)
   *   are removed with the repository's single-transaction cleanup.
   * - A linked homework set / practice set is removed too — but only when it
   *   holds no student work. Student drafts, hints, messages and practice
   *   answers are never cascaded away; when any exist the whole delete is
   *   refused with an actionable error and nothing changes.
   * - Afterwards the project's course analysis is marked stale, so the old
   *   result is never treated as still coming from the current files.
   *
   * The guard is re-checked inside the transaction, so a draft saved while the
   * confirm dialog was open still blocks the delete.
   */
  async delete(id: string, projectId?: string): Promise<void> {
    const document = await this.repo.get(id)
    if (projectId && document.projectId !== projectId) throw new NotFoundError('Document', id)

    await this.db.transaction(
      'rw',
      [
        this.db.documents,
        this.db.documentBlobs,
        this.db.chunks,
        this.db.processingJobs,
        this.db.visualSources,
        this.db.visualSourceImages,
        this.db.courseStructures,
        this.db.courseStructureNodes,
        this.db.homeworkSets,
        this.db.homeworkQuestions,
        this.db.homeworkWalkthroughs,
        this.db.walkthroughNotes,
        this.db.homeworkAnswerImages,
        this.db.slideLessons,
        this.db.practiceSets,
        this.db.practiceQuestions,
        this.db.practiceAttempts,
      ],
      async () => {
        const work = await this.studentWorkFor(id)
        if (work.homeworkAnswers > 0 || work.practiceAttempts > 0) {
          const described = [
            work.homeworkAnswers > 0 ? t('files.deleteBlockedHomework') : null,
            work.practiceAttempts > 0 ? t('files.deleteBlockedPractice') : null,
          ]
            .filter(Boolean)
            .join(' · ')
          throw new AppError(t('files.deleteBlockedBody', { work: described }), 'FILE_IN_USE')
        }
        await this.homework.deleteByDocument(id)
        await this.practice.deleteByDocument(id)
        await this.db.slideLessons.where('documentId').equals(id).delete()
        // If this file was a professor answer key, unlink it from its
        // assignment (and clear the per-question answers) rather than leaving a
        // dangling reference. The assignment's own rows and student work stay.
        const linkedSets = (await this.db.homeworkSets.toArray()).filter(
          (set) => set.answerDocumentId === id,
        )
        for (const set of linkedSets) {
          await this.homework.clearAnswerLinks(set.id)
          await this.db.homeworkSets.update(set.id, {
            answerDocumentId: undefined,
            answerEntries: undefined,
          })
        }
        await this.repo.delete(id)
      },
    )

    // The analysis is now derived from fewer sources. Marking it stale explains
    // the change; freshness itself already flips because the source hash moved.
    try {
      await this.content.markStale(document.projectId, 'source-removed')
    } catch (err) {
      logger.warn('Failed to mark the course analysis stale after a document delete', {
        projectId: document.projectId,
      })
      logger.debug('markStale after delete error', { error: String(err) })
    }

    logger.info('Document removed via service', { id, projectId: document.projectId })
  }

  async deleteByProject(projectId: string): Promise<number> {
    const n = await this.repo.deleteByProject(projectId)
    logger.warn('All documents removed by project', { projectId, count: n })
    return n
  }

  getBlob(id: string): Promise<Blob | null> {
    return this.repo.getBlob(id)
  }

  async existsInProject(id: string, projectId: string): Promise<boolean> {
    try {
      const doc = await this.repo.get(id)
      return doc.projectId === projectId
    } catch (err) {
      if (err instanceof NotFoundError) return false
      throw err
    }
  }

  countByProject(projectId: string): Promise<number> {
    return this.repo.countByProject(projectId)
  }

  /**
   * Count the learner's own work attached to a document's derived sets.
   * Read inside the delete transaction so a concurrent save is seen.
   */
  private async studentWorkFor(documentId: string): Promise<StudentWork> {
    let homeworkQuestions = 0
    let homeworkAnswers = 0
    const hwSets = await this.homework.listSetsByDocument(documentId)
    for (const set of hwSets) {
      const questions = await this.homework.listQuestions(set.id)
      homeworkQuestions += questions.length
      // Attached answer images (photos / pen-board pages) are student work too.
      const withImages = await new AnswerImageRepository(this.db).questionIdsWithImages(set.id)
      homeworkAnswers += questions.filter(
        (question) => hasStudentWork(question) || withImages.has(question.id),
      ).length
      // Questions saved about the walkthrough are student work too.
      homeworkAnswers += await this.db.walkthroughNotes
        .where('[setId+updatedAt]')
        .between([set.id, -Infinity], [set.id, Infinity])
        .count()
    }

    let practiceQuestions = 0
    let practiceAttempts = 0
    const practiceSets = await this.practice.listSetsByDocument(documentId)
    for (const set of practiceSets) {
      const questions = await this.practice.listQuestionsBySet(set.id)
      practiceQuestions += questions.length
      const attempts = await this.practice.listAttemptsBySet(set.id)
      practiceAttempts += attempts.length
    }

    return {
      homeworkSets: hwSets.length,
      homeworkQuestions,
      homeworkAnswers,
      practiceSets: practiceSets.length,
      practiceQuestions,
      practiceAttempts,
    }
  }
}
