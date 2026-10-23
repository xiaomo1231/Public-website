import type { UploadQueueItem } from '@/features/documents/batchUpload'
import type { UseTranslationResult } from '@/i18n'

/** Text helpers for the upload-queue extras (see `UploadQueueOptions.tsx`). */

/** What a duplicate row says (its plan or how it ended up), else null. */
export function duplicateStatusText(
  item: UploadQueueItem,
  t: UseTranslationResult['t'],
): string | null {
  if (item.outcome === 'replaced') return t('batch.duplicate.replaced')
  if (item.outcome === 'kept-both')
    return t('batch.duplicate.keptBoth', { name: item.saveAs ?? item.name })
  if (item.outcome === 'fallback-kept-both')
    return t('batch.duplicate.fallback', { name: item.saveAs ?? item.name })
  if (item.issue !== 'duplicate' || item.status !== 'queued') return null
  if (item.duplicateChoice === 'replace') return t('batch.duplicate.willReplace')
  if (item.duplicateChoice === 'keep')
    return t('batch.duplicate.willKeep', { name: item.saveAs ?? item.name })
  return null
}

/** Whether the row still waits for a duplicate decision (before the upload starts). */
export function isUndecidedDuplicate(item: UploadQueueItem): boolean {
  return (
    item.issue === 'duplicate' &&
    !item.documentId &&
    (item.status === 'skipped' || item.status === 'queued')
  )
}
