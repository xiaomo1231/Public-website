import type { Document, LearningMaterialType } from '@/entities/document/types'
import { resolveMaterialType } from '@/entities/document/types'
import { suggestMaterialType } from '@/entities/document/folders'
import {
  keepBothName,
  mergedPdfName,
  nameStem,
  splitSequence,
} from '@/entities/document/photoGroups'
import { DocumentRepository } from '@/entities/document/repository'
import { DocumentService, type DocumentDeleteImpact } from '@/services/documentService'
import { ProjectService } from '@/services/projectService'
import { getDb } from '@/infrastructure/db/database'
import type { PdfPagePreparer } from '@/infrastructure/files/photoPdf'
import { AppError, isAppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import { uploadDocument } from './uploadPipeline'

/**
 * 文件页批量操作「合并为一份试卷」: ≥2 photo documents of one course become one
 * PDF document (one photo per page, in number order) uploaded through the
 * normal pipeline, so it is read like the photos (local OCR, then 看图识别 for
 * a paper / homework / answer key). The new file keeps the first photo's
 * folder and exam selections are carried over. The originals are deleted only
 * when the student asks, and never when they hold student work.
 */

export interface PhotoMergeDeps {
  listByProject: (projectId: string) => Promise<Document[]>
  getBlob: (documentId: string) => Promise<Blob | null>
  getDeleteImpact: (id: string, projectId: string) => Promise<Pick<DocumentDeleteImpact, 'blocked'>>
  delete: (id: string, projectId: string) => Promise<void>
  /** Upload the merged PDF; returns the new document. */
  upload: (input: {
    projectId: string
    file: File
    name: string
    materialType: LearningMaterialType
    folderPath?: string
    photoPages: number
  }) => Promise<Document>
  /** Carry exam file selections of the originals over to the merged file. */
  carryExamSelections?: (projectId: string, from: string[], to: string) => Promise<void>
  /** Test seam: page preparation (browser-only by default). */
  prepare?: PdfPagePreparer
}

export interface PhotoMergeOptions {
  /** File name; defaults to the shared stem ("大题（带答案和评分）.pdf"). */
  name?: string
  deleteOriginals?: boolean
  deps?: PhotoMergeDeps
}

export interface PhotoMergeResult {
  document: Document
  /** Originals deleted. */
  deleted: Document[]
  /** Originals kept although deletion was asked, with the reason. */
  kept: Array<{ document: Document; reason: string }>
}

/** Pages in sequence order: shared stem + number, else natural name order. */
export function orderPhotoDocuments<T extends Pick<Document, 'name'>>(docs: readonly T[]): T[] {
  return docs.slice().sort((a, b) => {
    const sa = splitSequence(a.name)
    const sb = splitSequence(b.name)
    if (sa && sb) {
      const stem = sa.stem.localeCompare(sb.stem, undefined, { numeric: true })
      if (stem !== 0) return stem
      if (sa.number !== sb.number) return sa.number - sb.number
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
}

/** Default merged name: the stem the photos share, else the first photo's. */
export function defaultMergedName(docs: ReadonlyArray<Pick<Document, 'name' | 'folderPath'>>) {
  const ordered = orderPhotoDocuments(docs)
  const stems = new Set(
    ordered.map((d) => (splitSequence(d.name)?.stem ?? nameStem(d.name)).toLowerCase()),
  )
  const first = ordered[0]
  if (!first) return 'photos.pdf'
  const stem = splitSequence(first.name)?.stem ?? nameStem(first.name)
  return stems.size === 1
    ? mergedPdfName(stem, first.folderPath ?? '')
    : mergedPdfName(nameStem(first.name), first.folderPath ?? '')
}

/** Whether a selection can be merged: ≥2 stored photos, all in one course. */
export function canMergePhotos(docs: ReadonlyArray<Document>): boolean {
  return (
    docs.length >= 2 &&
    docs.every((d) => d.type === 'image' && d.hasBlob !== false) &&
    new Set(docs.map((d) => d.projectId)).size === 1
  )
}

function defaultDeps(): PhotoMergeDeps {
  const db = getDb()
  const documents = new DocumentRepository(db)
  const service = new DocumentService({ documents, projects: new ProjectService(db) })
  return {
    listByProject: (projectId) => documents.listByProject(projectId),
    getBlob: (id) => documents.getBlob(id),
    getDeleteImpact: (id, projectId) => service.getDeleteImpact(id, projectId),
    delete: (id, projectId) => service.delete(id, projectId),
    upload: (input) =>
      uploadDocument({
        projectId: input.projectId,
        type: 'pdf',
        materialType: input.materialType,
        file: input.file,
        name: input.name,
        photoPages: input.photoPages,
        ...(input.folderPath ? { folderPath: input.folderPath } : {}),
      }),
    carryExamSelections: async (projectId, from, to) => {
      const sources = new Set(from)
      await db.transaction('rw', db.exams, async () => {
        const exams = await db.exams.where('projectId').equals(projectId).toArray()
        for (const exam of exams) {
          const materials = exam.materials
          if (!materials) continue
          const ids = materials.documentIds ?? []
          const review = materials.reviewDocumentIds ?? []
          const hit = ids.some((id) => sources.has(id)) || review.some((id) => sources.has(id))
          if (!hit || ids.includes(to)) continue
          await db.exams.put({ ...exam, materials: { ...materials, documentIds: [...ids, to] } })
        }
      })
    },
  }
}

export async function mergePhotoDocuments(
  selected: readonly Document[],
  options: PhotoMergeOptions = {},
): Promise<PhotoMergeResult> {
  if (!canMergePhotos([...selected])) {
    throw new AppError(t('fileBatch.merge.needPhotos'), 'INVALID_INPUT')
  }
  const deps = options.deps ?? defaultDeps()
  const ordered = orderPhotoDocuments(selected)
  const first = ordered[0]!
  const projectId = first.projectId

  const blobs: Blob[] = []
  for (const doc of ordered) {
    const blob = await deps.getBlob(doc.id)
    if (!blob) throw new AppError(t('fileBatch.reason.noBlob'), 'INVALID_INPUT')
    blobs.push(blob.type ? blob : new Blob([blob], { type: doc.mimeType ?? 'image/jpeg' }))
  }

  const taken = (await deps.listByProject(projectId)).map((d) => d.name)
  const name = keepBothName(
    ensurePdfName(options.name?.trim() || defaultMergedName(ordered)),
    taken,
  )
  const { buildPhotoPdfFile } = await import('@/infrastructure/files/photoPdf')
  const file = await buildPhotoPdfFile(blobs, name, deps.prepare)

  // Role: the photos' shared role, else what the name suggests (大题 / 试卷 → 往年卷).
  const roles = new Set(ordered.map((d) => resolveMaterialType(d.materialType)))
  const shared = roles.size === 1 ? [...roles][0]! : 'textbook'
  const materialType: LearningMaterialType =
    shared !== 'textbook' ? shared : suggestMaterialType(name, first.folderPath ?? '')

  const document = await deps.upload({
    projectId,
    file,
    name,
    materialType,
    photoPages: ordered.length,
    ...(first.folderPath ? { folderPath: first.folderPath } : {}),
  })
  try {
    await deps.carryExamSelections?.(
      projectId,
      ordered.map((d) => d.id),
      document.id,
    )
  } catch (err) {
    logger.warn('Carrying exam selections to a merged paper failed', { error: String(err) })
  }

  const deleted: Document[] = []
  const kept: PhotoMergeResult['kept'] = []
  if (options.deleteOriginals) {
    for (const doc of ordered) {
      try {
        const impact = await deps.getDeleteImpact(doc.id, projectId)
        if (impact.blocked) {
          kept.push({ document: doc, reason: t('fileBatch.merge.keptHasWork') })
          continue
        }
        await deps.delete(doc.id, projectId)
        deleted.push(doc)
      } catch (err) {
        const reason =
          isAppError(err) && err.code === 'FILE_IN_USE'
            ? t('fileBatch.merge.keptHasWork')
            : err instanceof Error
              ? err.message
              : String(err)
        kept.push({ document: doc, reason })
      }
    }
  }
  return { document, deleted, kept }
}

function ensurePdfName(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name.replace(/\.[a-z0-9]+$/i, '')}.pdf`
}
