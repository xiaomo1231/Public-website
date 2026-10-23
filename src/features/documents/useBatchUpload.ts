import { useCallback, useMemo, useRef, useState } from 'react'
import { DocumentRepository } from '@/entities/document/repository'
import type { LearningMaterialType } from '@/entities/document/types'
import { getDb } from '@/infrastructure/db/database'
import { CourseContentService, pausedCourseAnalysis } from '@/services/courseContentService'
import { logger } from '@/infrastructure/logger/logger'
import { toast } from '@/features/toast/toastStore'
import { t } from '@/i18n'
import { useDocumentsStore } from './documentsStore'
import {
  createFileQueueItems,
  createTextQueueItem,
  identityOfDocument,
  identityOfFile,
  MAX_BATCH_FILES,
  planQueue,
  queuePhotoGroups,
  retryableItems,
  runBatchQueue,
  sourceIdsOf,
  summarizeBatch,
  type DuplicateChoice,
  type FileQueueOptions,
  type UploadQueueItem,
} from './batchUpload'
import type { PhotoGroup } from '@/entities/document/photoGroups'
import { replaceDocumentFile, reprocessDocument, uploadDocument } from './uploadPipeline'

/** A photo group the queue can merge, with the student's on / off choice. */
export interface QueuePhotoGroup extends PhotoGroup {
  merge: boolean
}

export interface UseBatchUploadResult {
  /** The queue as it will be uploaded (photo groups merged, choices applied). */
  items: UploadQueueItem[]
  /** Photo groups (≥2 numbered photos with one stem) and whether each is merged. */
  photoGroups: QueuePhotoGroup[]
  /** 「合并成一份试卷」 on / off for one group. */
  setMergeGroup: (key: string, merge: boolean) => void
  /** 跳过 / 覆盖 / 保留两份 for duplicates (planned ids). */
  setDuplicateChoice: (ids: string[], choice: DuplicateChoice) => void
  /** 全部跳过 / 全部覆盖: every duplicate (覆盖 only where a stored file exists). */
  setAllDuplicates: (choice: DuplicateChoice) => void
  summary: ReturnType<typeof summarizeBatch>
  running: boolean
  addFiles: (
    files: File[],
    materialType?: LearningMaterialType,
    options?: FileQueueOptions & { limit?: number },
  ) => Promise<UploadQueueItem[]>
  addText: (input: {
    text: string
    name?: string
    materialType?: LearningMaterialType
  }) => UploadQueueItem
  /** Paste-text path: enqueue and immediately run, as a batch of one. */
  addTextAndStart: (input: {
    text: string
    name?: string
    materialType?: LearningMaterialType
  }) => Promise<void>
  removeItem: (id: string) => void
  /** Change the role of queued items (e.g. the student accepts "this is a syllabus"). */
  setMaterial: (ids: string[], materialType: LearningMaterialType) => void
  start: () => Promise<void>
  retryFailed: () => Promise<void>
  cancelRemaining: () => void
  clearFinished: () => void
  reset: () => void
}

/**
 * Queue-based batch uploader.
 *
 * The queue is transient UI state — raw `File` objects are never persisted.
 * Each item is handed to the shared `uploadDocument` pipeline, so a batch of
 * five files produces five independent documents.
 */
export function useBatchUpload(projectId: string): UseBatchUploadResult {
  // Raw queue: one row per picked file until the upload starts, when the plan
  // (merged photo groups, duplicate choices) is committed into it.
  const [items, setItems] = useState<UploadQueueItem[]>([])
  const [mergeOff, setMergeOff] = useState<ReadonlySet<string>>(() => new Set())
  const [choices, setChoices] = useState<Readonly<Record<string, DuplicateChoice>>>({})
  const [existing, setExisting] = useState<ReadonlyArray<{ id: string; name: string }>>([])
  const [running, setRunning] = useState(false)
  // The run in progress. Each run owns its cancel flag, so closing the dialog
  // (reset) detaches a run that is still finishing its current file: its late
  // updates and its `finally` can no longer touch a reopened dialog, and a new
  // run cannot "un-cancel" the old one's remaining items.
  const runRef = useRef<{ cancelled: boolean } | null>(null)
  const refresh = useDocumentsStore((s) => s.refresh)

  // Mirror of `items` so event handlers always read the latest queue.
  const itemsRef = useRef(items)
  itemsRef.current = items

  const update = useCallback((id: string, patch: Partial<UploadQueueItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const addFiles = useCallback(
    async (
      files: File[],
      materialType: LearningMaterialType = 'textbook',
      options: FileQueueOptions & { limit?: number } = {},
    ): Promise<UploadQueueItem[]> => {
      if (files.length === 0) return []

      let accepted = files
      const max = options.limit ?? MAX_BATCH_FILES
      const remaining = max - itemsRef.current.length
      if (remaining <= 0) {
        toast({ variant: 'error', title: t('batch.tooMany', { max }) })
        return []
      }
      if (files.length > remaining) {
        accepted = files.slice(0, remaining)
        toast({ variant: 'info', title: t('batch.tooMany', { max }) })
      }

      const documents = await new DocumentRepository(getDb()).listByProject(projectId)
      setExisting(documents.map((doc) => ({ id: doc.id, name: doc.name })))
      // Files already waiting in this dialog count as present too, so the same
      // file dropped twice is not uploaded (and analysed) twice.
      const queued = itemsRef.current
        .filter((item) => item.kind === 'file' && item.status !== 'skipped' && item.file)
        .map((item) => identityOfFile(item.file!))
      const created = createFileQueueItems(
        accepted,
        [...documents.map(identityOfDocument), ...queued],
        materialType,
        options,
      )
      setItems((prev) => [...prev, ...created])
      return created
    },
    [projectId],
  )

  const addText = useCallback(
    (input: {
      text: string
      name?: string
      materialType?: LearningMaterialType
    }): UploadQueueItem => {
      const item = createTextQueueItem(input)
      setItems((prev) => [...prev, item])
      return item
    },
    [],
  )

  const planned = useMemo(
    () => planQueue(items, { mergeOff, choices, existing }),
    [items, mergeOff, choices, existing],
  )
  const plannedRef = useRef(planned)
  plannedRef.current = planned

  /** Raw ids behind planned ids (a merged row stands for its photos). */
  const rawIds = useCallback((ids: string[]): Set<string> => {
    const out = new Set<string>()
    for (const id of ids) {
      const item = plannedRef.current.find((p) => p.id === id)
      for (const raw of item ? sourceIdsOf(item) : [id]) out.add(raw)
    }
    return out
  }, [])

  const removeItem = useCallback(
    (id: string) => {
      const remove = rawIds([id])
      setItems((prev) => prev.filter((item) => !remove.has(item.id)))
    },
    [rawIds],
  )

  const setMaterial = useCallback(
    (ids: string[], materialType: LearningMaterialType) => {
      const target = rawIds(ids)
      setItems((prev) =>
        prev.map((item) =>
          target.has(item.id) && (item.status === 'queued' || item.issue === 'duplicate')
            ? { ...item, materialType }
            : item,
        ),
      )
    },
    [rawIds],
  )

  const setMergeGroup = useCallback((key: string, merge: boolean) => {
    setMergeOff((prev) => {
      const next = new Set(prev)
      if (merge) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const setDuplicateChoice = useCallback((ids: string[], choice: DuplicateChoice) => {
    setChoices((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = choice
      return next
    })
  }, [])

  const setAllDuplicates = useCallback((choice: DuplicateChoice) => {
    setChoices((prev) => {
      const next = { ...prev }
      for (const item of plannedRef.current) {
        if (item.issue !== 'duplicate' || item.documentId) continue
        if (item.status !== 'queued' && item.status !== 'skipped') continue
        // 全部覆盖: a duplicate inside this selection has nothing to replace.
        next[item.id] = choice === 'replace' && !item.duplicateOf ? 'skip' : choice
      }
      return next
    })
  }, [])

  const run = useCallback(
    async (snapshot: UploadQueueItem[]) => {
      const queued = snapshot.filter((item) => item.status === 'queued')
      if (queued.length === 0) return

      const token = { cancelled: false }
      if (runRef.current) runRef.current.cancelled = true
      runRef.current = token
      setRunning(true)
      let completed = 0
      try {
        await runBatchQueue(snapshot, {
          onUpdate: (id, patch) => {
            if (patch.status === 'completed') completed += 1
            if (runRef.current === token) update(id, patch)
          },
          isCancelled: () => token.cancelled,
          worker: async (item, { report, setDocumentId, patch }) => {
            const isCancelled = () => token.cancelled
            const onStage = (stage: {
              phase: 'validating' | 'saving' | 'processing'
              progress?: number
              message?: string
            }) =>
              report({
                phase: stage.phase,
                ...(stage.progress !== undefined ? { progress: stage.progress } : {}),
                ...(stage.message !== undefined ? { message: stage.message } : {}),
              })

            // A retry of an item whose document row already exists (a file or
            // pasted text) re-processes that document instead of creating a
            // second one.
            if (item.documentId) {
              await reprocessDocument(item.documentId, { onStage, isCancelled })
              return
            }

            // 考卷照片合并: build the PDF from the photos (in page order) now.
            let file = item.file
            let photoPages: number | undefined
            if (item.mergeFiles && item.mergeFiles.length > 0) {
              report({ phase: 'saving', message: 'merging' })
              const { buildPhotoPdfFile } = await import('@/infrastructure/files/photoPdf')
              file = await buildPhotoPdfFile(item.mergeFiles, item.name)
              photoPages = item.mergeFiles.length
            }

            const input =
              item.kind === 'text'
                ? {
                    projectId,
                    type: 'text' as const,
                    materialType: item.materialType ?? 'textbook',
                    text: item.text ?? '',
                    name: item.name,
                  }
                : {
                    projectId,
                    type: item.type ?? 'text',
                    materialType: item.materialType ?? 'textbook',
                    file,
                    name: item.saveAs ?? item.name,
                    ...(item.folderPath ? { folderPath: item.folderPath } : {}),
                    ...(photoPages ? { photoPages } : {}),
                  }
            const pipeline = { isCancelled, onStage, onDocumentCreated: setDocumentId }

            // 覆盖: replace the stored file (falls back to 保留两份 when the old
            // file holds student work).
            if (item.duplicateChoice === 'replace' && item.duplicateOf && item.kind === 'file') {
              const result = await replaceDocumentFile(item.duplicateOf.documentId, input, pipeline)
              patch({
                outcome: result.outcome === 'replaced' ? 'replaced' : 'fallback-kept-both',
                ...(result.outcome === 'kept-both' ? { saveAs: result.document.name } : {}),
              })
              return
            }

            await uploadDocument(input, pipeline)
            if (item.duplicateChoice === 'keep') patch({ outcome: 'kept-both' })
          },
        })
      } finally {
        if (runRef.current === token) {
          runRef.current = null
          setRunning(false)
        }
        // Reuse the existing document store as the single source of truth. A
        // failed list refresh must not skip the analysis below.
        await refresh(projectId).catch((err: unknown) => {
          logger.warn('Document list refresh after upload failed', { error: String(err) })
        })
        // Persist the course analysis once the upload has produced ready
        // material. This is the *processing* flow's job: opening a Tutor page
        // only ever reads what is already stored. A no-op when the content is
        // fresh, when no AI provider is configured, or when nothing is ready.
        // Nothing new was processed, or the student paused / stopped the
        // analysis: an upload must not silently restart it.
        if (completed > 0 && !pausedCourseAnalysis(projectId)) {
          void new CourseContentService().ensureAnalyzed(projectId).catch((err: unknown) => {
            logger.debug('Automatic course analysis skipped', { error: String(err) })
          })
        }
      }
    },
    [projectId, refresh, update],
  )

  const addTextAndStart = useCallback(
    async (input: { text: string; name?: string; materialType?: LearningMaterialType }) => {
      const item = createTextQueueItem(input)
      const next = [...plannedRef.current, item]
      setItems(next)
      await run(next)
    },
    [run],
  )

  const start = useCallback(async () => {
    // Commit the plan: merged photo groups become one row, choices are applied.
    const next = plannedRef.current
    setItems(next)
    await run(next)
  }, [run])

  const retryFailed = useCallback(async () => {
    const next = retryableItems(itemsRef.current)
    setItems(next)
    await run(next)
  }, [run])

  const cancelRemaining = useCallback(() => {
    if (runRef.current) runRef.current.cancelled = true
  }, [])

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((item) => item.status !== 'completed'))
  }, [])

  const reset = useCallback(() => {
    // Stop the queue and detach it: the file being processed right now still
    // finishes in the background (and is kept), but the dialog starts clean.
    if (runRef.current) runRef.current.cancelled = true
    runRef.current = null
    setRunning(false)
    setItems([])
    setMergeOff(new Set())
    setChoices({})
  }, [])

  const summary = useMemo(() => summarizeBatch(planned), [planned])
  const photoGroups = useMemo(
    () => queuePhotoGroups(items).map((group) => ({ ...group, merge: !mergeOff.has(group.key) })),
    [items, mergeOff],
  )

  return {
    items: planned,
    photoGroups,
    setMergeGroup,
    setDuplicateChoice,
    setAllDuplicates,
    summary,
    running,
    addFiles,
    addText,
    addTextAndStart,
    removeItem,
    setMaterial,
    start,
    retryFailed,
    cancelRemaining,
    clearFinished,
    reset,
  }
}
