import type { DocumentType } from '@/entities/document/types'
import { ValidationError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

/**
 * Not a product limit: the most a browser can reliably read into memory as one
 * ArrayBuffer. Whether a file actually fits is decided by the free storage
 * space at upload time (`ensureStorageFor`).
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
export const MAX_TEXT_BYTES = 1 * 1024 * 1024 // 1 MB pasted text

export const ACCEPTED_TYPES: ReadonlyArray<{ type: DocumentType; mime: string[]; ext: string[] }> = [
  { type: 'pdf', mime: ['application/pdf'], ext: ['pdf'] },
  { type: 'docx', mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ext: ['docx'] },
  { type: 'pptx', mime: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], ext: ['pptx'] },
  { type: 'image', mime: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'], ext: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
]

export function detectDocumentType(file: File): DocumentType | null {
  const name = file.name.toLowerCase()
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  for (const entry of ACCEPTED_TYPES) {
    if (entry.mime.includes(file.type)) return entry.type
    if (ext && entry.ext.includes(ext)) return entry.type
  }
  return null
}

/**
 * Reason a file cannot be accepted. Used by the batch uploader so it can report
 * every rejected file individually instead of failing the whole selection.
 */
export type FileRejection = 'unsupported' | 'too-large'

export type FileClassification =
  | { ok: true; type: DocumentType }
  | { ok: false; reason: FileRejection }

/**
 * Non-throwing counterpart of `validateFile`. Both share the same rules, so a
 * file accepted here is always accepted by `validateFile`.
 */
export function classifyFile(file: File): FileClassification {
  const type = detectDocumentType(file)
  if (!type) return { ok: false, reason: 'unsupported' }
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'too-large' }
  return { ok: true, type }
}

export function validateFile(file: File): DocumentType {
  const result = classifyFile(file)
  if (!result.ok) {
    if (result.reason === 'too-large') {
      throw new ValidationError(t('errors.fileTooLarge', { max: `${MAX_FILE_BYTES / 1024 ** 3} GB` }))
    }
    throw new ValidationError(t('errors.unsupportedFileType', { name: file.name }))
  }
  return result.type
}

export function validateTextInput(text: string): void {
  if (text.length > MAX_TEXT_BYTES) {
    throw new ValidationError(t('errors.textTooLong', { max: MAX_TEXT_BYTES / 1024 }))
  }
}