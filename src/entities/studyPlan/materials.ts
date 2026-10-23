import { isInFolder, normalizeFolderPath } from '@/entities/document/folders'
import { resolveMaterialType, type Document } from '@/entities/document/types'
import type { PlannedExamMaterials } from './types'

/**
 * The files an exam's materials stand for. Files are picked one by one
 * (`documentIds`, plus the older `reviewDocumentIds`) or by folder
 * (`folderPaths`): a folder includes every file in it and below it, so a file
 * uploaded to that folder later belongs to the exam too. Pure.
 */

/** Materials of a stored row with the fields older rows lack. */
export function normalizeMaterials(
  materials: Partial<PlannedExamMaterials> | undefined,
): PlannedExamMaterials {
  return {
    pastExamSetIds: materials?.pastExamSetIds ?? [],
    reviewDocumentIds: materials?.reviewDocumentIds ?? [],
    practiceSetIds: materials?.practiceSetIds ?? [],
    homeworkSetIds: materials?.homeworkSetIds ?? [],
    documentIds: materials?.documentIds ?? [],
    folderPaths: (materials?.folderPaths ?? []).map(normalizeFolderPath).filter(Boolean),
  }
}

export interface ExamMaterialDocument {
  document: Document
  /** The picked folder that brought it in (absent when picked on its own). */
  viaFolder?: string
}

/** The exam's files, in course order (picked ones first, then by folder). */
export function resolveExamDocuments(
  materials: Partial<PlannedExamMaterials> | undefined,
  documents: readonly Document[],
): ExamMaterialDocument[] {
  const m = normalizeMaterials(materials)
  const picked = new Set([...(m.documentIds ?? []), ...m.reviewDocumentIds])
  const out: ExamMaterialDocument[] = []
  const seen = new Set<string>()
  for (const document of documents) {
    if (picked.has(document.id)) {
      out.push({ document })
      seen.add(document.id)
    }
  }
  for (const folder of m.folderPaths ?? []) {
    for (const document of documents) {
      if (seen.has(document.id) || !isInFolder(document.folderPath, folder)) continue
      out.push({ document, viaFolder: folder })
      seen.add(document.id)
    }
  }
  return out
}

/** Roles read through their own recognised set (a mock exam, a homework, a practice set). */
export function isSetMaterial(document: Pick<Document, 'materialType'>): boolean {
  const type = resolveMaterialType(document.materialType)
  return type === 'past_exam' || type === 'homework' || type === 'professor_practice'
}

/** Roles that are read as review material (one 复习资料 task each). */
export function isReviewMaterial(document: Pick<Document, 'materialType' | 'status'>): boolean {
  if (document.status !== 'ready') return false
  const type = resolveMaterialType(document.materialType)
  return type === 'textbook' || type === 'user_notes' || type === 'lecture_transcript'
}

export const REVIEW_MATERIAL_MIN_MINUTES = 10
export const REVIEW_MATERIAL_MAX_MINUTES = 60

/**
 * Reading time of a review file: about 3 minutes a page, 1.5 a slide, 20
 * minutes when the length is unknown; 10–60 minutes (a long book is read over
 * several 学习 tasks anyway).
 */
export function reviewMaterialMinutes(document: Pick<Document, 'metadata' | 'textLength'>): number {
  const pages = document.metadata?.pageCount
  const slides = document.metadata?.slideCount
  let minutes: number
  if (pages && pages > 0) minutes = pages * 3
  else if (slides && slides > 0) minutes = slides * 1.5
  else if (document.textLength && document.textLength > 0)
    minutes = document.textLength / 600 // ~ 600 characters a minute
  else minutes = 20
  const rounded = Math.round(minutes / 5) * 5
  return Math.max(REVIEW_MATERIAL_MIN_MINUTES, Math.min(REVIEW_MATERIAL_MAX_MINUTES, rounded))
}

/** Toggle one id in a list (the picker's checkboxes). */
export function toggleIn(list: readonly string[] | undefined, id: string): string[] {
  const current = list ?? []
  return current.includes(id) ? current.filter((each) => each !== id) : [...current, id]
}
