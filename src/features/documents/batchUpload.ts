import { classifyFile } from '@/infrastructure/files/validation'
import type { DocumentType } from '@/entities/document/types'
import { UploadCancelledError } from './uploadPipeline'

/**
 * Lifecycle of one item in the upload queue.
 *
 * `skipped` is a pre-flight outcome (unsupported / too large / duplicate): the
 * file is shown to the user but never uploaded. The remaining states mirror
 * the document processing pipeline rather than inventing a parallel one.
 */
export type UploadStatus =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export type FileIssue = 'unsupported' | 'too-large' | 'duplicate'

export interface UploadQueueItem {
  id: string
  kind: 'file' | 'text'
  /** Present for `kind === 'file'`. Never persisted to IndexedDB. */
  file?: File
  text?: string
  name: string
  sizeBytes: number
  type: DocumentType | null
  status: UploadStatus
  issue?: FileIssue
  /** Raw pipeline stage name while processing. */
  phase?: string
  /** Real progress from the processing pipeline only. */
  progress?: number
  error?: string
  documentId?: string
}

/** Local-first: PDF/OCR extraction is CPU heavy and IndexedDB is shared. */
export const MAX_CONCURRENT_UPLOADS = 2

/** Guards against accidental "select the whole folder" batches. */
export const MAX_BATCH_FILES = 50

export interface FileIdentity {
  name: string
  size: number
  modified?: number
}

export function identityOfFile(file: File): FileIdentity {
  return { name: file.name, size: file.size, modified: file.lastModified }
}

export function identityOfDocument(doc: {
  name: string
  sizeBytes: number
  sourceModifiedAt?: number
}): FileIdentity {
  return {
    name: doc.name,
    size: doc.sizeBytes,
    ...(doc.sourceModifiedAt !== undefined ? { modified: doc.sourceModifiedAt } : {}),
  }
}

/**
 * Duplicate identity: same name, same size, and — when both sides know it —
 * the same last-modified timestamp. If either side predates
 * `sourceModifiedAt`, name + size is treated as sufficient evidence.
 */
export function isSameFile(a: FileIdentity, b: FileIdentity): boolean {
  if (a.name.trim().toLowerCase() !== b.name.trim().toLowerCase()) return false
  if (a.size !== b.size) return false
  if (a.modified !== undefined && b.modified !== undefined) return a.modified === b.modified
  return true
}

/**
 * Validate every selected file independently and mark duplicates.
 *
 * Duplicates are detected both against documents already in the project and
 * against earlier files in the same selection.
 */
export function createFileQueueItems(
  files: File[],
  existing: FileIdentity[] = [],
): UploadQueueItem[] {
  const known = existing.slice()
  return files.map((file) => {
    const classification = classifyFile(file)
    const base: UploadQueueItem = {
      id: crypto.randomUUID(),
      kind: 'file',
      file,
      name: file.name,
      sizeBytes: file.size,
      type: classification.ok ? classification.type : null,
      status: 'queued',
    }
    if (!classification.ok) {
      return { ...base, status: 'skipped' as const, issue: classification.reason }
    }
    const identity = identityOfFile(file)
    if (known.some((k) => isSameFile(k, identity))) {
      return { ...base, status: 'skipped' as const, issue: 'duplicate' as const }
    }
    known.push(identity)
    return base
  })
}

export function createTextQueueItem(input: { text: string; name?: string }): UploadQueueItem {
  const text = input.text
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    text,
    name: input.name?.trim() || '',
    sizeBytes: new Blob([text]).size,
    type: 'text',
    status: 'queued',
  }
}

export interface BatchSummary {
  total: number
  /** Everything that is not pre-flight rejected. */
  uploadable: number
  queued: number
  duplicates: number
  unsupported: number
  tooLarge: number
  completed: number
  failed: number
  cancelled: number
  /** No item is queued/uploading/processing any more. */
  finished: boolean
  /** At least one item is actively running. */
  running: boolean
}

const RUNNING_STATUSES: readonly UploadStatus[] = ['queued', 'uploading', 'processing']

export function summarizeBatch(items: UploadQueueItem[]): BatchSummary {
  const count = (predicate: (item: UploadQueueItem) => boolean) => items.filter(predicate).length
  const skipped = count((i) => i.status === 'skipped')
  return {
    total: items.length,
    uploadable: items.length - skipped,
    queued: count((i) => i.status === 'queued'),
    duplicates: count((i) => i.issue === 'duplicate'),
    unsupported: count((i) => i.issue === 'unsupported'),
    tooLarge: count((i) => i.issue === 'too-large'),
    completed: count((i) => i.status === 'completed'),
    failed: count((i) => i.status === 'failed'),
    cancelled: count((i) => i.status === 'cancelled'),
    finished: items.length > 0 && !items.some((i) => RUNNING_STATUSES.includes(i.status)),
    running: items.some((i) => i.status === 'uploading' || i.status === 'processing'),
  }
}

export interface ReportedStage {
  phase: 'validating' | 'saving' | 'processing'
  progress?: number
  message?: string
}

export type StageReporter = (stage: ReportedStage) => void

export interface WorkerContext {
  report: StageReporter
  /**
   * Records the document id as soon as the row exists. Called before
   * processing, so a failure still leaves the id available for a retry.
   */
  setDocumentId: (documentId: string) => void
}

export type BatchWorker = (item: UploadQueueItem, context: WorkerContext) => Promise<void>

export interface RunBatchOptions {
  concurrency?: number
  onUpdate: (id: string, patch: Partial<UploadQueueItem>) => void
  worker: BatchWorker
  /** Cooperative cancellation — checked before each item starts. */
  isCancelled: () => boolean
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return String(err)
}

/**
 * Run the queued items with bounded concurrency.
 *
 * Guarantees:
 *   - at most `concurrency` items are in flight at once
 *   - one item failing never aborts the others
 *   - cancellation only prevents items that have not started yet
 *   - the returned promise always resolves (individual failures are captured
 *     on the item, never rethrown)
 */
export async function runBatchQueue(
  items: UploadQueueItem[],
  options: RunBatchOptions,
): Promise<void> {
  const { onUpdate, worker, isCancelled } = options
  const concurrency = Math.max(1, options.concurrency ?? MAX_CONCURRENT_UPLOADS)
  const pending = items.filter((item) => item.status === 'queued')
  let cursor = 0

  async function lane(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= pending.length) return
      const item = pending[index]
      if (!item) return

      if (isCancelled()) {
        onUpdate(item.id, { status: 'cancelled', progress: undefined, phase: undefined })
        continue
      }

      onUpdate(item.id, { status: 'uploading', error: undefined, progress: undefined })

      const report: StageReporter = (stage) => {
        const patch: Partial<UploadQueueItem> = {
          status: stage.phase === 'processing' ? 'processing' : 'uploading',
          phase: stage.message ?? stage.phase,
        }
        if (stage.progress !== undefined) patch.progress = stage.progress
        onUpdate(item.id, patch)
      }

      const context: WorkerContext = {
        report,
        setDocumentId: (documentId) => onUpdate(item.id, { documentId }),
      }

      try {
        await worker(item, context)
        onUpdate(item.id, {
          status: 'completed',
          error: undefined,
          progress: 100,
          phase: undefined,
        })
      } catch (err) {
        if (err instanceof UploadCancelledError) {
          onUpdate(item.id, { status: 'cancelled', error: undefined, phase: undefined, progress: undefined })
        } else {
          onUpdate(item.id, {
            status: 'failed',
            error: errorMessage(err),
            phase: undefined,
            progress: undefined,
          })
        }
      }
    }
  }

  const lanes = Math.min(concurrency, pending.length)
  await Promise.all(Array.from({ length: lanes }, () => lane()))
}

/** Reset failed items back to `queued` so a retry run picks them up. */
export function retryableItems(items: UploadQueueItem[]): UploadQueueItem[] {
  return items.map((item) =>
    item.status === 'failed'
      ? { ...item, status: 'queued' as const, error: undefined, progress: undefined, phase: undefined }
      : item,
  )
}
