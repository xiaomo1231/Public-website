import type { TranslationKey } from '@/i18n/types'
import type { SyllabusData } from '@/entities/syllabus/types'
import type { EvalRole } from '@/entities/evaluation/evalRole'
import type { MaterialSuggestion } from './materialSuggestion'

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
  | 'homework'
  /**
   * The professor's answer key for one homework assignment. It is course
   * *reference* material, never a knowledge source: it is excluded from course
   * analysis and never sent to the tutor as course context.
   */
  | 'homework_answer'
  /**
   * The course handbook / syllabus / exam-topic list. Processed like any other
   * file (extracted + chunked) so its exam topics can be read, but it has no
   * course content of its own: excluded from analysis, quizzes, tutor sources
   * and course vocabulary, exactly like a professor answer key.
   */
  | 'syllabus'
  /**
   * A walkthrough the student imported into one assignment's 完整讲解 (their
   * own or a classmate's write-up). Kept so the original can be opened again;
   * like an answer key it is reference only — never a knowledge source.
   */
  | 'walkthrough_import'
  /**
   * A past exam paper or mock paper (往年试卷 / 模拟卷). Its questions are
   * recognised like an assignment (stored as a `HomeworkSet` with
   * `kind: 'exam'`) for 模拟考试 and 题型与覆盖分析; like an answer key it is
   * reference only — never a knowledge source.
   */
  | 'past_exam'

export const LEARNING_MATERIAL_TYPES: readonly LearningMaterialType[] = [
  'textbook',
  'user_notes',
  'lecture_transcript',
  'professor_practice',
  'homework',
  'homework_answer',
  'syllabus',
  'walkthrough_import',
  'past_exam',
]

/**
 * Reference-only material: read for its own feature (answer matching, exam
 * topics) but never a knowledge source for analysis, quizzes, the tutor or
 * course vocabulary.
 */
export function isReferenceOnlyMaterial(value: unknown): boolean {
  const type = resolveMaterialType(value)
  return (
    type === 'homework_answer' ||
    type === 'syllabus' ||
    type === 'walkthrough_import' ||
    type === 'past_exam'
  )
}

/**
 * True for material that may ground a course analysis / tutor lesson.
 * A professor answer key and a syllabus are deliberately excluded: an answer
 * sheet and a list of exam topics are not something the tutor should teach from.
 */
export function isCourseMaterialType(value: unknown): boolean {
  return !isReferenceOnlyMaterial(value)
}

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
  'heading' | 'paragraph' | 'table' | 'list' | 'formula' | 'caption' | 'note' | 'ocr' | 'other'

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
  /**
   * Pages whose text was read by the student's vision model instead of local
   * OCR (`page-transcribe/v1`); 1 for an image file. Cleared on re-processing.
   */
  transcribedPages?: number[]
  /** Model that read them. */
  transcribedModel?: string
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
  /**
   * `syllabus` documents only: the exam topics read from the file (scopes →
   * topics, each with its exact source text, chunk and page), the user's edits
   * and the topic matches. Optional and stored on the row, so it is exported
   * and restored with the document.
   */
  syllabus?: SyllabusData
  /**
   * 留作检验 role (see `entities/evaluation/evalRole.ts`). `independent`
   * documents are excluded from every AI context; the role is copied onto the
   * chunks (`DocumentChunk.evalRole`) so chunk filters need no join.
   */
  evalRole?: EvalRole
  /**
   * Folder the file sits in, `/`-separated without leading or trailing slash
   * ("Week 3/Slides"). Kept from a folder upload (its relative path) and
   * editable on the files page; absent = not in a folder. Optional, no Dexie
   * bump; exported with the row. Nothing else depends on it except the
   * study plan's folder selection (a selected folder includes files added to
   * it later).
   */
  folderPath?: string
  /**
   * 资料类型按内容自动判断: the role the processed content reads like, when it
   * differs from `materialType` (see `materialSuggestion.ts`). Only shown as a
   * notice in the file list; the role is never changed without the student.
   * Optional, no Dexie bump; exported with the row.
   */
  suggestedMaterialType?: MaterialSuggestion
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
  /** Folder from a folder upload (see `Document.folderPath`). */
  folderPath?: string
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
  /** `null` removes the exam-topic list. */
  syllabus?: SyllabusData | null
  /** Move the file to a folder; `null` / `''` takes it out of any folder. */
  folderPath?: string | null
  /** `null` removes the content-based role suggestion. */
  suggestedMaterialType?: MaterialSuggestion | null
}
