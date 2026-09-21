import type { TranslationKey } from '@/i18n/types'

export type DocumentType = 'pdf' | 'docx' | 'pptx' | 'image' | 'text'

/**
 * What a piece of learning material *is* in the tutor's world.
 *
 * The three roles are genuinely different and must not be merged:
 *   - `textbook`           — the primary source of course facts
 *   - `user_notes`         — the learner's own supplementary context
 *   - `lecture_transcript` — the professor's teaching style + class coverage
 */
export type LearningMaterialType =
  | 'textbook'
  | 'user_notes'
  | 'lecture_transcript'
  | 'professor_practice'

export const LEARNING_MATERIAL_TYPES: readonly LearningMaterialType[] = [
  'textbook',
  'user_notes',
  'lecture_transcript',
  'professor_practice',
]

export function isLearningMaterialType(value: unknown): value is LearningMaterialType {
  return typeof value === 'string' && (LEARNING_MATERIAL_TYPES as readonly string[]).includes(value)
}

/** Material type with the backward-compatible default (`textbook`). */
export function resolveMaterialType(value: unknown): LearningMaterialType {
  return isLearningMaterialType(value) ? value : 'textbook'
}

export type ProcessingStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export const PROCESSING_STATUS_LABEL_KEYS: Record<ProcessingStatus, TranslationKey> = {
  uploading: 'docStatus.uploading',
  processing: 'docStatus.processing',
  ready: 'docStatus.ready',
  failed: 'docStatus.failed',
}
export type ChunkContentType =
  | 'heading'
  | 'paragraph'
  | 'table'
  | 'list'
  | 'formula'
  | 'caption'
  | 'note'
  | 'ocr'
  | 'other'

export interface DocumentMetadata {
  pageCount?: number
  slideCount?: number
  author?: string
  title?: string
  subject?: string
  producer?: string
  creator?: string
  createdAt?: number
  modifiedAt?: number
  language?: 'zh' | 'en' | 'mixed' | 'unknown'
  ocrConfidence?: number
}

export interface Document {
  id: string
  projectId: string
  type: DocumentType
  /** Role in the tutor. Older rows without it are treated as `textbook`. */
  materialType?: LearningMaterialType
  name: string
  /** Original file size in bytes. 0 for text-only documents. */
  sizeBytes: number
  mimeType?: string
  /**
   * True when the raw bytes live in IndexedDB (Blob). We keep them co-located
   * with the metadata row so a single transaction can hydrate a document.
   * OPFS migration can come later without changing this interface.
   */
  hasBlob: boolean
  status: ProcessingStatus
  errorMessage?: string
  warnings: string[]
  metadata: DocumentMetadata
  textLength?: number
  chunkCount?: number
  uploadedAt: number
  processedAt?: number
  /**
   * `File.lastModified` of the original upload, when there was one.
   * Used together with name + size to detect duplicate uploads. Absent for
   * pasted text and for documents created before this field existed.
   */
  sourceModifiedAt?: number
}

export interface DocumentBlobRow {
  id: string
  projectId: string
  bytes: ArrayBuffer
  mimeType: string
}

export interface CreateDocumentInput {
  projectId: string
  type: DocumentType
  /** Defaults to `textbook` so existing callers keep working. */
  materialType?: LearningMaterialType
  name: string
  sizeBytes: number
  mimeType?: string
  /** Either a Blob or pre-read ArrayBuffer. ArrayBuffer is preferred in
   *  environments where Blob.prototype.arrayBuffer is unreliable. */
  blob?: Blob | ArrayBuffer
  /** `File.lastModified`, forwarded for duplicate detection. */
  sourceModifiedAt?: number
}

export interface UpdateDocumentInput {
  name?: string
  status?: ProcessingStatus
  errorMessage?: string
  warnings?: string[]
  metadata?: Partial<DocumentMetadata>
  textLength?: number
  chunkCount?: number
  processedAt?: number
}