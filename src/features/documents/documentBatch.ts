import type { Document, LearningMaterialType } from '@/entities/document/types'
import type { EvalRole } from '@/entities/evaluation/evalRole'
import { normalizeFolderPath } from '@/entities/document/folders'
import { DocumentService } from '@/services/documentService'
import { ProjectService } from '@/services/projectService'
import { HomeworkProofreadService } from '@/services/homeworkProofreadService'
import { DocumentRepository } from '@/entities/document/repository'
import { CourseContentService, pausedCourseAnalysis } from '@/services/courseContentService'
import { isAppError } from '@/infrastructure/errors/AppError'
import { getDb } from '@/infrastructure/db/database'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import { reprocessDocument } from './uploadPipeline'

/**
 * Batch file operations (2o): one action over many files, one file at a time.
 * Each file goes through the same path as its single-file action (the
 * document service's delete with its protection, the role change, the folder
 * label, reprocessing, the 检验用途 write), so each keeps its own transaction
 * and a failure or a protected file never stops the others. Stopping takes
 * effect before the next file; the file in progress finishes.
 */

export type DocumentBatchAction =
  | { kind: 'delete' }
  | { kind: 'materialType'; materialType: LearningMaterialType }
  | { kind: 'folder'; folderPath: string }
  | { kind: 'reprocess' }
  | { kind: 'evalRole'; evalRole: EvalRole | undefined }

export type DocumentBatchStatus = 'done' | 'skipped' | 'failed' | 'not-run'

export interface DocumentBatchOutcome {
  document: Document
  status: DocumentBatchStatus
  /** Why it was skipped / failed, ready to show. */
  reason?: string
}

export interface DocumentBatchResult {
  action: DocumentBatchAction
  outcomes: DocumentBatchOutcome[]
  done: number
  skipped: number
  failed: number
  /** Stopped before every file ran (the rest are `not-run`). */
  stopped: boolean
  /** Courses whose files changed (refresh their lists). */
  projectIds: string[]
}

export interface DocumentBatchProgress {
  /** Files finished (any status). */
  completed: number
  total: number
  current?: Document
}

export interface DocumentBatchDeps {
  documents: Pick<
    DocumentService,
    'getDeleteImpact' | 'delete' | 'changeMaterialType' | 'moveToFolder'
  >
  reprocess: (documentId: string) => Promise<unknown>
  setEvalRole: (documentId: string, role: EvalRole | undefined) => Promise<void>
  /** After the batch: start the course analysis for reprocessed courses. */
  analyze?: (projectId: string) => void
}

export interface DocumentBatchOptions {
  deps?: DocumentBatchDeps
  shouldContinue?: () => boolean
  onProgress?: (progress: DocumentBatchProgress) => void
}

function defaultDeps(): DocumentBatchDeps {
  const db = getDb()
  return {
    documents: new DocumentService({
      documents: new DocumentRepository(db),
      projects: new ProjectService(db),
    }),
    reprocess: (id) => reprocessDocument(id),
    setEvalRole: (id, role) => new HomeworkProofreadService().setDocumentEvalRole(id, role),
    analyze: (projectId) => {
      if (pausedCourseAnalysis(projectId)) return
      void new CourseContentService().ensureAnalyzed(projectId).catch((err: unknown) => {
        logger.debug('Automatic course analysis skipped', { error: String(err) })
      })
    },
  }
}

const isBusy = (doc: Document): boolean => doc.status === 'processing' || doc.status === 'uploading'

function deleteBlockedReason(impact: {
  studentWork: { homeworkAnswers: number; practiceAttempts: number }
}): string {
  const work = [
    impact.studentWork.homeworkAnswers > 0 ? t('files.deleteBlockedHomework') : null,
    impact.studentWork.practiceAttempts > 0 ? t('files.deleteBlockedPractice') : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return t('fileBatch.reason.hasWork', { work })
}

/** Run one file; returns its outcome (never throws). */
async function runOne(
  doc: Document,
  action: DocumentBatchAction,
  deps: DocumentBatchDeps,
  reprocessed: Set<string>,
): Promise<DocumentBatchOutcome> {
  try {
    switch (action.kind) {
      case 'delete': {
        const impact = await deps.documents.getDeleteImpact(doc.id, doc.projectId)
        if (impact.blocked)
          return { document: doc, status: 'skipped', reason: deleteBlockedReason(impact) }
        await deps.documents.delete(doc.id, doc.projectId)
        return { document: doc, status: 'done' }
      }
      case 'materialType': {
        if (isBusy(doc))
          return { document: doc, status: 'skipped', reason: t('fileBatch.reason.busy') }
        const result = await deps.documents.changeMaterialType(
          doc.id,
          action.materialType,
          doc.projectId,
        )
        if (result.needsReprocess) {
          await deps.reprocess(doc.id)
          reprocessed.add(doc.projectId)
        }
        return { document: result.document, status: 'done' }
      }
      case 'folder': {
        const updated = await deps.documents.moveToFolder(
          doc.id,
          normalizeFolderPath(action.folderPath),
        )
        return { document: updated, status: 'done' }
      }
      case 'reprocess': {
        if (doc.hasBlob === false) {
          return { document: doc, status: 'skipped', reason: t('fileBatch.reason.noBlob') }
        }
        if (isBusy(doc))
          return { document: doc, status: 'skipped', reason: t('fileBatch.reason.busy') }
        await deps.reprocess(doc.id)
        reprocessed.add(doc.projectId)
        return { document: doc, status: 'done' }
      }
      case 'evalRole': {
        await deps.setEvalRole(doc.id, action.evalRole)
        return { document: doc, status: 'done' }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The protection re-checked inside the transaction (work saved while the
    // confirmation was open) is a skip, not a failure.
    if (isAppError(err) && (err.code === 'FILE_IN_USE' || err.code === 'FILE_BUSY')) {
      return { document: doc, status: 'skipped', reason: message }
    }
    logger.warn('Batch file action failed', { id: doc.id, action: action.kind })
    return { document: doc, status: 'failed', reason: message }
  }
}

export async function runDocumentBatch(
  documents: readonly Document[],
  action: DocumentBatchAction,
  options: DocumentBatchOptions = {},
): Promise<DocumentBatchResult> {
  const deps = options.deps ?? defaultDeps()
  const outcomes: DocumentBatchOutcome[] = []
  const reprocessed = new Set<string>()
  const projectIds = new Set<string>()
  let stopped = false
  for (const doc of documents) {
    if (stopped || (options.shouldContinue && !options.shouldContinue())) {
      stopped = true
      outcomes.push({ document: doc, status: 'not-run' })
      continue
    }
    options.onProgress?.({ completed: outcomes.length, total: documents.length, current: doc })
    const outcome = await runOne(doc, action, deps, reprocessed)
    outcomes.push(outcome)
    if (outcome.status !== 'not-run') projectIds.add(doc.projectId)
  }
  options.onProgress?.({ completed: outcomes.length, total: documents.length })
  for (const projectId of reprocessed) deps.analyze?.(projectId)
  const count = (status: DocumentBatchStatus) => outcomes.filter((o) => o.status === status).length
  return {
    action,
    outcomes,
    done: count('done'),
    skipped: count('skipped'),
    failed: count('failed'),
    stopped,
    projectIds: [...projectIds],
  }
}
