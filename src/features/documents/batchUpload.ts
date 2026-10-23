import { classifyFile } from '@/infrastructure/files/validation'
import type { DocumentType, LearningMaterialType } from '@/entities/document/types'
import { detectPhotoGroups, keepBothName, type PhotoGroup } from '@/entities/document/photoGroups'
import { UploadCancelledError } from './uploadPipeline'

/**
 * Lifecycle of one item in the upload queue.
 *
 * `skipped` is a pre-flight outcome (unsupported / too large / duplicate): the
 * file is shown to the user but never uploaded. The remaining states mirror
 * the document processing pipeline rather than inventing a parallel one.
 */
export type UploadStatus =
  'queued' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped'

export type FileIssue = 'unsupported' | 'too-large' | 'duplicate'

/**
 * What to do with a duplicate (上传重复文件可选): `skip` (default), `replace`
 * the stored file (same document id; only for a duplicate of a stored
 * document) or `keep` both (the new one saved as "name (2).ext").
 */
export type DuplicateChoice = 'skip' | 'replace' | 'keep'

/** How a duplicate actually ended up (shown after the upload). */
export type DuplicateOutcome = 'replaced' | 'kept-both' | 'fallback-kept-both'

export interface UploadQueueItem {
  id: string
  kind: 'file' | 'text'
  /** Present for `kind === 'file'`. Never persisted to IndexedDB. */
  file?: File
  text?: string
  name: string
  sizeBytes: number
  type: DocumentType | null
  /** Role in the tutor; carried into the document row. */
  materialType?: LearningMaterialType
  /** Folder of a folder upload; carried into `Document.folderPath`. */
  folderPath?: string
  status: UploadStatus
  issue?: FileIssue
  /** Raw pipeline stage name while processing. */
  phase?: string
  /** Real progress from the processing pipeline only. */
  progress?: number
  error?: string
  documentId?: string
  /**
   * When `issue === 'duplicate'`, the document already in this project that
   * matched. Lets the prompt point the user at the existing file instead of
   * only saying "already uploaded".
   */
  duplicateOf?: { documentId: string; name: string }
  /** The student's choice for a duplicate (`skip` when absent). */
  duplicateChoice?: DuplicateChoice
  /** "保留两份": the name the new copy is saved under. */
  saveAs?: string
  /** How a duplicate ended up, once uploaded. */
  outcome?: DuplicateOutcome
  /**
   * 考卷照片合并: this item is one PDF built from these photos (page order) at
   * upload time; `mergeKey` is the photo group's key, `mergeNames` their names.
   */
  mergeFiles?: File[]
  mergeNames?: string[]
  mergeKey?: string
  /** Queue ids of the photos merged into this item. */
  mergeIds?: string[]
}

/** Local-first: PDF/OCR extraction is CPU heavy and IndexedDB is shared. */
export const MAX_CONCURRENT_UPLOADS = 2

/** Guards against accidental "select the whole folder" batches. */
export const MAX_BATCH_FILES = 50

export interface FileIdentity {
  name: string
  size: number
  modified?: number
  /** Present when the identity came from a stored document. */
  id?: string
}

export function identityOfFile(file: File): FileIdentity {
  return { name: file.name, size: file.size, modified: file.lastModified }
}

export function identityOfDocument(doc: {
  id: string
  name: string
  sizeBytes: number
  sourceModifiedAt?: number
}): FileIdentity {
  return {
    id: doc.id,
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

/** Per-file folder and role (a folder upload with role suggestions). */
export interface FileQueueOptions {
  folderOf?: (file: File) => string | undefined
  roleOf?: (file: File) => LearningMaterialType | undefined
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
  materialType: LearningMaterialType = 'textbook',
  options: FileQueueOptions = {},
): UploadQueueItem[] {
  const known = existing.slice()
  return files.map((file) => {
    const classification = classifyFile(file)
    const folderPath = options.folderOf?.(file)
    const base: UploadQueueItem = {
      id: crypto.randomUUID(),
      kind: 'file',
      file,
      name: file.name,
      sizeBytes: file.size,
      type: classification.ok ? classification.type : null,
      materialType: options.roleOf?.(file) ?? materialType,
      ...(folderPath ? { folderPath } : {}),
      status: 'queued',
    }
    if (!classification.ok) {
      return { ...base, status: 'skipped' as const, issue: classification.reason }
    }
    const identity = identityOfFile(file)
    const match = known.find((k) => isSameFile(k, identity))
    if (match) {
      return {
        ...base,
        status: 'skipped' as const,
        issue: 'duplicate' as const,
        // Only a *stored* document (with an id) can be linked to. A duplicate
        // of an earlier file in the same selection has nothing to point at yet.
        ...(match.id ? { duplicateOf: { documentId: match.id, name: match.name } } : {}),
      }
    }
    known.push(identity)
    return base
  })
}

export function createTextQueueItem(input: {
  text: string
  name?: string
  materialType?: LearningMaterialType
}): UploadQueueItem {
  const text = input.text
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    text,
    name: input.name?.trim() || '',
    sizeBytes: new Blob([text]).size,
    type: 'text',
    materialType: input.materialType ?? 'textbook',
    status: 'queued',
  }
}

/** Ids that a planned merged item stands for (itself otherwise). */
export function sourceIdsOf(item: UploadQueueItem): string[] {
  return item.mergeIds && item.mergeIds.length > 0 ? item.mergeIds : [item.id]
}

export interface QueuePlanOptions {
  /** Photo groups the student chose not to merge (by group key). */
  mergeOff?: ReadonlySet<string>
  /** Duplicate choices by (planned) item id. */
  choices?: Readonly<Record<string, DuplicateChoice>>
  /** Documents already in the project (merged PDFs are matched by name). */
  existing?: ReadonlyArray<{ id: string; name: string }>
}

function notStarted(item: UploadQueueItem): boolean {
  return item.status === 'queued' || (item.status === 'skipped' && item.issue === 'duplicate')
}

/** Photo groups among the queued photos (for the 「合并成一份试卷」 notices). */
export function queuePhotoGroups(raw: ReadonlyArray<UploadQueueItem>): PhotoGroup[] {
  return detectPhotoGroups(
    raw
      .filter(
        (item) =>
          item.kind === 'file' &&
          item.file &&
          item.type === 'image' &&
          !item.documentId &&
          !item.mergeKey &&
          notStarted(item),
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        ...(item.folderPath ? { folderPath: item.folderPath } : {}),
      })),
  )
}

/**
 * The queue as it will be uploaded: photo groups merged into one PDF item
 * each (unless switched off), duplicate choices applied (status `queued` for
 * replace / keep, `skipped` for skip) and "保留两份" names assigned. Pure; the
 * hook shows this view and commits it when the upload starts.
 */
export function planQueue(
  raw: ReadonlyArray<UploadQueueItem>,
  options: QueuePlanOptions = {},
): UploadQueueItem[] {
  const mergeOff = options.mergeOff ?? new Set<string>()
  const choices = options.choices ?? {}
  const existing = options.existing ?? []

  // 1. Photo groups among files not uploaded yet.
  const groups = queuePhotoGroups(raw).filter((group) => !mergeOff.has(group.key))
  const byId = new Map(raw.map((item) => [item.id, item]))
  const groupOf = new Map<string, PhotoGroup>()
  for (const group of groups) for (const id of group.ids) groupOf.set(id, group)

  let planned: UploadQueueItem[] = []
  const emitted = new Set<string>()
  for (const item of raw) {
    const group = groupOf.get(item.id)
    if (!group) {
      planned.push(item)
      continue
    }
    if (emitted.has(group.key)) continue
    emitted.add(group.key)
    const members = group.ids
      .map((id) => byId.get(id))
      .filter((m): m is UploadQueueItem => Boolean(m?.file))
    const roles = new Set(members.map((m) => m.materialType ?? 'textbook'))
    planned.push({
      id: `merge:${group.key}`,
      kind: 'file',
      name: group.name,
      sizeBytes: members.reduce((sum, m) => sum + m.sizeBytes, 0),
      type: 'pdf',
      materialType: roles.size === 1 ? [...roles][0]! : (members[0]?.materialType ?? 'textbook'),
      ...(group.folderPath ? { folderPath: group.folderPath } : {}),
      status: 'queued',
      mergeFiles: members.map((m) => m.file!),
      mergeNames: members.map((m) => m.name),
      mergeKey: group.key,
      mergeIds: members.map((m) => m.id),
    })
  }

  // 2. A merged PDF named like a stored file (or another queued file) is a duplicate.
  const seen = new Set<string>()
  planned = planned.map((item) => {
    const key = item.name.trim().toLowerCase()
    if (item.mergeKey && item.status === 'queued' && !item.issue && !item.documentId) {
      const stored = existing.find((doc) => doc.name.trim().toLowerCase() === key)
      if (stored || seen.has(key)) {
        return {
          ...item,
          status: 'skipped' as const,
          issue: 'duplicate' as const,
          ...(stored ? { duplicateOf: { documentId: stored.id, name: stored.name } } : {}),
        }
      }
    }
    if (item.status !== 'skipped') seen.add(key)
    return item
  })

  // 3. Duplicate choices.
  planned = planned.map((item) => {
    if (item.issue !== 'duplicate' || !notStarted(item) || item.documentId) return item
    let choice: DuplicateChoice = choices[item.id] ?? 'skip'
    if (choice === 'replace' && !item.duplicateOf) choice = 'skip'
    const next: UploadQueueItem = {
      ...item,
      duplicateChoice: choice,
      status: choice === 'skip' ? 'skipped' : 'queued',
    }
    delete next.saveAs
    return next
  })

  // 4. "保留两份" names, unique against stored files and everything queued.
  const taken = new Set<string>(existing.map((doc) => doc.name.trim().toLowerCase()))
  for (const item of planned) {
    if (item.status !== 'skipped' && item.duplicateChoice !== 'keep')
      taken.add(item.name.trim().toLowerCase())
  }
  return planned.map((item) => {
    if (item.duplicateChoice !== 'keep' || item.status !== 'queued' || item.documentId) return item
    const saveAs = keepBothName(item.name, taken)
    taken.add(saveAs.toLowerCase())
    return { ...item, saveAs }
  })
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
    // Duplicates the student still skips (replace / keep ones are uploadable).
    duplicates: count((i) => i.issue === 'duplicate' && i.status === 'skipped'),
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
  /** Record extra facts about the item (e.g. how a duplicate ended up). */
  patch: (patch: Partial<UploadQueueItem>) => void
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
        patch: (patch) => onUpdate(item.id, patch),
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
          onUpdate(item.id, {
            status: 'cancelled',
            error: undefined,
            phase: undefined,
            progress: undefined,
          })
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
      ? {
          ...item,
          status: 'queued' as const,
          error: undefined,
          progress: undefined,
          phase: undefined,
        }
      : item,
  )
}
