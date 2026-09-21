import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import {
  type CreateDocumentInput,
  type Document,
  type DocumentBlobRow,
  type UpdateDocumentInput,
} from './types'
import { NotFoundError, StorageError, ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

function normalizeName(name: string): string {
  return name.trim()
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  // jsdom 25's Blob.prototype.arrayBuffer is a stub that returns an empty
  // buffer regardless of the underlying data. Use FileReader as a portable
  // fallback so tests work the same way as real browsers.
  const reader = new FileReader()
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsArrayBuffer(blob)
  })
}

export class DocumentRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async listByProject(projectId: string): Promise<Document[]> {
    try {
      return this.db.documents.where('projectId').equals(projectId).reverse().sortBy('uploadedAt')
    } catch (err) {
      logger.error('DocumentRepository.listByProject failed', { projectId }, err)
      throw new StorageError(t('storage.failedToListDocuments'), err)
    }
  }

  async listAll(): Promise<Document[]> {
    try {
      return this.db.documents.orderBy('uploadedAt').reverse().toArray()
    } catch (err) {
      throw new StorageError(t('storage.failedToListDocuments'), err)
    }
  }

  async get(id: string): Promise<Document> {
    const row = await this.db.documents.get(id)
    if (!row) throw new NotFoundError('Document', id)
    return row
  }

  async create(input: CreateDocumentInput): Promise<Document> {
    const name = normalizeName(input.name)
    if (!name) throw new ValidationError(t('errors.documentNameRequired'))
    if (input.sizeBytes < 0) throw new ValidationError(t('errors.invalidFileSize'))
    const now = Date.now()
    const document: Document = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      type: input.type,
      materialType: input.materialType ?? 'textbook',
      name,
      sizeBytes: input.sizeBytes,
      hasBlob: Boolean(input.blob),
      status: 'uploading',
      warnings: [],
      metadata: {},
      uploadedAt: now,
    }
    if (input.mimeType !== undefined) document.mimeType = input.mimeType
    if (input.sourceModifiedAt !== undefined) document.sourceModifiedAt = input.sourceModifiedAt

    // Read blob bytes OUTSIDE the transaction so Dexie's transaction scope
    // never has to wait on an async boundary (FileReader, fetch, etc.).
    let bytes: ArrayBuffer | null = null
    let detectedType: string | null = null
    if (input.blob instanceof ArrayBuffer) {
      bytes = input.blob
      detectedType = input.mimeType ?? 'application/octet-stream'
    } else if (input.blob) {
      bytes = await blobToArrayBuffer(input.blob)
      detectedType = input.blob.type || input.mimeType || 'application/octet-stream'
    }

    await this.db.transaction('rw', this.db.documents, this.db.documentBlobs, async () => {
      await this.db.documents.add(document)
      if (bytes && detectedType) {
        const row: DocumentBlobRow = {
          id: document.id,
          projectId: document.projectId,
          bytes,
          mimeType: detectedType,
        }
        await this.db.documentBlobs.add(row)
      }
    })
    logger.info('Document created', { id: document.id, projectId: document.projectId, type: document.type })
    return document
  }

  async update(id: string, patch: UpdateDocumentInput): Promise<Document> {
    const existing = await this.get(id)
    const next: Document = { ...existing }
    if (patch.name !== undefined) {
      const trimmed = normalizeName(patch.name)
      if (!trimmed) throw new ValidationError(t('errors.documentNameRequired'))
      next.name = trimmed
    }
    if (patch.status !== undefined) next.status = patch.status
    if (patch.errorMessage !== undefined) next.errorMessage = patch.errorMessage
    if (patch.warnings !== undefined) next.warnings = patch.warnings
    if (patch.metadata !== undefined) {
      next.metadata = { ...existing.metadata, ...patch.metadata }
    }
    if (patch.textLength !== undefined) next.textLength = patch.textLength
    if (patch.chunkCount !== undefined) next.chunkCount = patch.chunkCount
    if (patch.processedAt !== undefined) next.processedAt = patch.processedAt
    await this.db.documents.put(next)
    return next
  }

  async delete(id: string): Promise<void> {
    const doc = await this.get(id)
    const visualIds = await this.db.visualSources.where('documentId').equals(id).primaryKeys()
    const structures = await this.db.courseStructures
      .where('sourceDocumentId')
      .equals(id)
      .toArray()
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
      ],
      async () => {
        await this.db.documents.delete(id)
        await this.db.documentBlobs.delete(id)
        await this.db.chunks.where('documentId').equals(id).delete()
        await this.db.processingJobs.where('documentId').equals(id).delete()
        await this.db.visualSources.where('documentId').equals(id).delete()
        if (visualIds.length > 0) await this.db.visualSourceImages.bulkDelete(visualIds)
        for (const structure of structures) {
          await this.db.courseStructureNodes.where('structureId').equals(structure.id).delete()
          await this.db.courseStructures.delete(structure.id)
        }
      },
    )
    logger.warn('Document deleted', { id, projectId: doc.projectId })
  }

  async deleteByProject(projectId: string): Promise<number> {
    const ids = await this.db.documents
      .where('projectId')
      .equals(projectId)
      .primaryKeys()
    if (ids.length === 0) return 0
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
      ],
      async () => {
        await this.db.documents.where('projectId').equals(projectId).delete()
        await this.db.documentBlobs.where('projectId').equals(projectId).delete()
        await this.db.chunks.where('projectId').equals(projectId).delete()
        await this.db.processingJobs.where('projectId').equals(projectId).delete()
        await this.db.visualSources.where('projectId').equals(projectId).delete()
        await this.db.visualSourceImages.where('projectId').equals(projectId).delete()
        await this.db.courseStructureNodes.where('projectId').equals(projectId).delete()
        await this.db.courseStructures.where('projectId').equals(projectId).delete()
      },
    )
    logger.warn('Documents deleted by project', { projectId, count: ids.length })
    return ids.length
  }

  async getBlob(id: string): Promise<Blob | null> {
    const row = await this.db.documentBlobs.get(id)
    if (!row) return null
    return new Blob([row.bytes], { type: row.mimeType })
  }

  async getBytes(id: string): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
    const row = await this.db.documentBlobs.get(id)
    if (!row) return null
    return { bytes: row.bytes, mimeType: row.mimeType }
  }

  async countByProject(projectId: string): Promise<number> {
    return this.db.documents.where('projectId').equals(projectId).count()
  }
}