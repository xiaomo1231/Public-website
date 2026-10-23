import { DocumentService } from '@/services/documentService'
import { ProcessingService } from '@/services/processingService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { ProjectService } from '@/services/projectService'
import { getDb } from '@/infrastructure/db/database'
import { validateFile, validateTextInput } from '@/infrastructure/files/validation'
import { ensureStorageFor, isQuotaError } from '@/infrastructure/files/storageSpace'
import { ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import type { Document, DocumentType, LearningMaterialType } from '@/entities/document/types'

export interface UploadDocumentInput {
  projectId: string
  type: DocumentType
  /** Role in the tutor. Defaults to `textbook`. */
  materialType?: LearningMaterialType
  file?: File
  text?: string
  name?: string
  /** Folder of a folder upload (`Document.folderPath`). */
  folderPath?: string
}

/** Coarse phases of a single upload. `processing` is driven by the pipeline. */
export type UploadPhase = 'validating' | 'saving' | 'processing'

export interface UploadStage {
  phase: UploadPhase
  /** Only set while `phase === 'processing'`, where the value is real. */
  progress?: number
  message?: string
}

export interface UploadDocumentOptions {
  onStage?: (stage: UploadStage) => void
  /**
   * Fired as soon as the document row exists, before processing starts. Lets a
   * caller remember the id so a later retry can re-process the same document
   * instead of creating a second one.
   */
  onDocumentCreated?: (documentId: string) => void
  /**
   * Cooperative cancellation. The underlying extractors are not interruptible,
   * so this is checked *between* phases rather than mid-extraction.
   */
  isCancelled?: () => boolean
}

/** Thrown when an upload stops because the caller cancelled it. */
export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled')
    this.name = 'UploadCancelledError'
  }
}

function isCancelled(options: UploadDocumentOptions): boolean {
  return options.isCancelled?.() ?? false
}

function buildServices(): {
  documents: DocumentRepository
  documentService: DocumentService
  processing: ProcessingService
} {
  const db = getDb()
  const documents = new DocumentRepository(db)
  const projects = new ProjectService(db)
  return {
    documents,
    documentService: new DocumentService({ documents, projects }),
    processing: new ProcessingService({
      documents,
      chunks: new ChunkRepository(db),
      jobs: new ProcessingJobRepository(db),
      projects,
    }),
  }
}

/**
 * Persist one document and run it through the existing processing pipeline.
 *
 * This is the single entry point shared by the one-file path and the batch
 * queue — a batch is simply N independent calls to this function.
 */
export async function uploadDocument(
  input: UploadDocumentInput,
  options: UploadDocumentOptions = {},
): Promise<Document> {
  const { onStage } = options
  const { documentService, processing } = buildServices()

  onStage?.({ phase: 'validating' })

  let blob: Blob | undefined
  let name: string
  let mimeType: string | undefined
  let sizeBytes: number
  let type: DocumentType
  let sourceModifiedAt: number | undefined

  if (input.type === 'text') {
    const text = input.text ?? ''
    validateTextInput(text)
    blob = new Blob([text], { type: 'text/plain' })
    const stamp = new Date().toISOString().slice(0, 10)
    name = input.name?.trim() || `${t('upload.pastedNote', { date: stamp })}.txt`
    mimeType = 'text/plain'
    sizeBytes = blob.size
    type = 'text'
  } else {
    if (!input.file) throw new Error(t('upload.noFile'))
    type = validateFile(input.file)
    blob = input.file
    name = input.file.name
    mimeType = input.file.type
    sizeBytes = input.file.size
    sourceModifiedAt = input.file.lastModified
  }

  await ensureStorageFor(sizeBytes)

  if (isCancelled(options)) throw new UploadCancelledError()

  onStage?.({ phase: 'saving' })
  let document: Document
  try {
    document = await documentService.create({
      projectId: input.projectId,
      type,
      materialType: input.materialType ?? 'textbook',
      name,
      sizeBytes,
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(sourceModifiedAt !== undefined ? { sourceModifiedAt } : {}),
      ...(input.folderPath ? { folderPath: input.folderPath } : {}),
      ...(blob ? { blob } : {}),
    })
  } catch (err) {
    // The save is one transaction, so a full quota leaves nothing behind.
    if (isQuotaError(err)) throw new ValidationError(t('errors.storageFull'))
    throw err
  }
  options.onDocumentCreated?.(document.id)

  // Cancelled between saving and processing: remove the half-created document
  // so the project is not left with an orphan row.
  if (isCancelled(options)) {
    await documentService.delete(document.id).catch((err: unknown) => {
      logger.warn('Failed to clean up a cancelled upload', { id: document.id })
      logger.debug('Cancelled upload cleanup error', { error: String(err) })
    })
    throw new UploadCancelledError()
  }

  onStage?.({ phase: 'processing', progress: 0 })
  await processing.process(document.id, {
    onProgress: (p) => onStage?.({ phase: 'processing', progress: p.progress, message: p.stage }),
  })

  // A photographed exam / homework page: read it with the vision model when
  // the settings allow (local OCR text stays when that is not possible).
  if (type === 'image') {
    const { autoTranscribeAfterUpload } = await import('@/services/pageTranscriptionService')
    await autoTranscribeAfterUpload(document.id)
  }
  startMaterialCheck(document.id)

  return document
}

/**
 * 资料类型按内容自动判断: a close call is checked by the light model in the
 * background (one small request, only when AI is configured). Never awaited:
 * the upload is complete without it.
 */
function startMaterialCheck(documentId: string): void {
  void import('@/services/materialTypeService')
    .then(({ autoCheckMaterialType }) => autoCheckMaterialType(documentId))
    .catch((err: unknown) => {
      logger.debug('Material type check not started', { error: String(err) })
    })
}

/**
 * Re-run the processing pipeline for a document that already exists.
 *
 * Used by "Retry Failed": the failed upload already created its document row,
 * so retrying must re-process it rather than create a duplicate.
 */
export async function reprocessDocument(
  documentId: string,
  options: UploadDocumentOptions = {},
): Promise<Document> {
  const { documents, processing } = buildServices()
  await documents.get(documentId)

  if (isCancelled(options)) throw new UploadCancelledError()

  options.onStage?.({ phase: 'processing', progress: 0 })
  await processing.process(documentId, {
    onProgress: (p) =>
      options.onStage?.({ phase: 'processing', progress: p.progress, message: p.stage }),
  })
  startMaterialCheck(documentId)

  return documents.get(documentId)
}
