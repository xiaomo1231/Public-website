import type { DocumentType } from '@/entities/document/types'
import { ValidationError } from '@/infrastructure/errors/AppError'

export const MAX_FILE_BYTES = 100 * 1024 * 1024 // 100 MB
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

export function validateFile(file: File): DocumentType {
  if (file.size > MAX_FILE_BYTES) {
    throw new ValidationError(`File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`)
  }
  const type = detectDocumentType(file)
  if (!type) {
    throw new ValidationError(`Unsupported file type: ${file.name}`)
  }
  return type
}

export function validateTextInput(text: string): void {
  if (text.length > MAX_TEXT_BYTES) {
    throw new ValidationError(`Text is too long (max ${MAX_TEXT_BYTES / 1024} KB)`)
  }
}