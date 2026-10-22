import type { ProcessingStatus } from '@/entities/document/types'

/**
 * One material group's summary state. A failed file is never "processing":
 * once nothing is still being read, the group reads as ready, partly failed
 * or failed.
 */
export type MaterialGroupStatus =
  | { kind: 'empty' }
  | { kind: 'processing' }
  | { kind: 'ready' }
  | { kind: 'failed'; failed: number }
  | { kind: 'partial'; failed: number }

export function materialGroupStatus(
  docs: ReadonlyArray<{ status: ProcessingStatus }>,
): MaterialGroupStatus {
  if (docs.length === 0) return { kind: 'empty' }
  if (docs.some((doc) => doc.status === 'processing' || doc.status === 'uploading')) {
    return { kind: 'processing' }
  }
  const failed = docs.filter((doc) => doc.status === 'failed').length
  if (failed === 0) return { kind: 'ready' }
  return failed === docs.length ? { kind: 'failed', failed } : { kind: 'partial', failed }
}
