export type DocumentType = 'pdf' | 'docx' | 'pptx' | 'image' | 'text'
export type ProcessingStatus = 'uploading' | 'processing' | 'ready' | 'failed'
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
  name: string
  sizeBytes: number
  mimeType?: string
  /** Either a Blob or pre-read ArrayBuffer. ArrayBuffer is preferred in
   *  environments where Blob.prototype.arrayBuffer is unreliable. */
  blob?: Blob | ArrayBuffer
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