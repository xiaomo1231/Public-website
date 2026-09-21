import { useCallback, useMemo, useRef, useState } from 'react'
import { DocumentRepository } from '@/entities/document/repository'
import type { LearningMaterialType } from '@/entities/document/types'
import { getDb } from '@/infrastructure/db/database'
import { toast } from '@/features/toast/toastStore'
import { t } from '@/i18n'
import { useDocumentsStore } from './documentsStore'
import {
  createFileQueueItems,
  createTextQueueItem,
  identityOfDocument,
  MAX_BATCH_FILES,
  retryableItems,
  runBatchQueue,
  summarizeBatch,
  type UploadQueueItem,
} from './batchUpload'
import { reprocessDocument, uploadDocument } from './uploadPipeline'

export interface UseBatchUploadResult {
  items: UploadQueueItem[]
  summary: ReturnType<typeof summarizeBatch>
  running: boolean
  addFiles: (files: File[], materialType?: LearningMaterialType) => Promise<UploadQueueItem[]>
  addText: (input: { text: string; name?: string; materialType?: LearningMaterialType }) => UploadQueueItem
  /** Paste-text path: enqueue and immediately run, as a batch of one. */
  addTextAndStart: (input: {
    text: string
    name?: string
    materialType?: LearningMaterialType
  }) => Promise<void>
  removeItem: (id: string) => void
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
  const [items, setItems] = useState<UploadQueueItem[]>([])
  const [running, setRunning] = useState(false)
  const cancelledRef = useRef(false)
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
    ): Promise<UploadQueueItem[]> => {
      if (files.length === 0) return []

      let accepted = files
      const remaining = MAX_BATCH_FILES - itemsRef.current.length
      if (remaining <= 0) {
        toast({ variant: 'error', title: t('batch.tooMany', { max: MAX_BATCH_FILES }) })
        return []
      }
      if (files.length > remaining) {
        accepted = files.slice(0, remaining)
        toast({ variant: 'info', title: t('batch.tooMany', { max: MAX_BATCH_FILES }) })
      }

      const documents = await new DocumentRepository(getDb()).listByProject(projectId)
      const created = createFileQueueItems(
        accepted,
        documents.map(identityOfDocument),
        materialType,
      )
      setItems((prev) => [...prev, ...created])
      return created
    },
    [projectId],
  )

  const addText = useCallback(
    (input: { text: string; name?: string; materialType?: LearningMaterialType }): UploadQueueItem => {
      const item = createTextQueueItem(input)
      setItems((prev) => [...prev, item])
      return item
    },
    [],
  )

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const run = useCallback(
    async (snapshot: UploadQueueItem[]) => {
      const queued = snapshot.filter((item) => item.status === 'queued')
      if (queued.length === 0) return

      cancelledRef.current = false
      setRunning(true)
      try {
        await runBatchQueue(snapshot, {
          onUpdate: update,
          isCancelled: () => cancelledRef.current,
          worker: async (item, { report, setDocumentId }) => {
            const isCancelled = () => cancelledRef.current
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

            // A retry of a file whose document row already exists re-processes
            // that document instead of creating a second one.
            if (item.kind === 'file' && item.documentId) {
              await reprocessDocument(item.documentId, { onStage, isCancelled })
              return
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
                    file: item.file,
                    name: item.name,
                  }

            await uploadDocument(input, {
              isCancelled,
              onStage,
              onDocumentCreated: setDocumentId,
            })
          },
        })
      } finally {
        setRunning(false)
        // Reuse the existing document store as the single source of truth.
        await refresh(projectId)
      }
    },
    [projectId, refresh, update],
  )

  const addTextAndStart = useCallback(
    async (input: { text: string; name?: string; materialType?: LearningMaterialType }) => {
      const item = createTextQueueItem(input)
      const next = [...itemsRef.current, item]
      setItems(next)
      await run(next)
    },
    [run],
  )

  const start = useCallback(async () => {
    await run(itemsRef.current)
  }, [run])

  const retryFailed = useCallback(async () => {
    const next = retryableItems(itemsRef.current)
    setItems(next)
    await run(next)
  }, [run])

  const cancelRemaining = useCallback(() => {
    cancelledRef.current = true
  }, [])

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((item) => item.status !== 'completed'))
  }, [])

  const reset = useCallback(() => {
    cancelledRef.current = true
    setItems([])
  }, [])

  const summary = useMemo(() => summarizeBatch(items), [items])

  return {
    items,
    summary,
    running,
    addFiles,
    addText,
    addTextAndStart,
    removeItem,
    start,
    retryFailed,
    cancelRemaining,
    clearFinished,
    reset,
  }
}
